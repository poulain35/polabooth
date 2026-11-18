/**
 * check-kiosk-alerts — appelée par pg_cron toutes les 5 min (service_role).
 *
 * Pour chaque organisation ayant activé les alertes (organizations.alert_config.enabled),
 * scanne ses bornes (kiosk_licenses.org_id, hors bornes retirées) et les événements EN COURS
 * auxquels elles sont assignées, et notifie (email + webhook) le compte de la borne en cas de :
 * machine hors ligne, problème imprimante, appareil photo débranché, quota d'impressions, papier bas,
 * et erreurs graves de la borne pendant un événement (LAB-329, lues dans kiosk_logs).
 *
 * Modèle ouvert/résolu : 1 alerte ouverte à la fois par (event × machine × type) ; email
 * d'ouverture puis email « rentré dans l'ordre » quand le problème disparaît.
 */

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { sendKioskAlertEmail } from '../_shared/email.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { isFeatureEnabled } from '../_shared/features.ts';
import { evaluateAlerts, heldAlertTypes, RESOLVE, type AlertType } from './evaluate.ts';
import { isEventInProgress } from './kiosk-errors.ts';
import { postWebhook } from './notify.ts';
import { EVENT_COLUMNS, reconcileKioskErrors } from './reconcile-errors.ts';
import { appUrl } from '../_shared/app-url.ts';

const APP_URL = appUrl();

Deno.serve(async (req) => {
  const denied = cronOnly(req, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (denied) return denied;

  const db = adminClient();
  const now = Date.now();
  const adminUrl = `${APP_URL}/admin/bornes`;

  // 1. Organisations avec alertes activées
  const { data: orgs, error: orgErr } = await db
    .from('organizations')
    .select('id, features, notify_email, webhook_url, alert_config')
    .eq('alert_config->>enabled', 'true');

  if (orgErr) {
    console.error('check-kiosk-alerts : lecture des organisations', orgErr);
    return jsonResponse(500, { error: 'Lecture des organisations impossible' });
  }
  if (!orgs?.length) return jsonResponse(200, { checked: 0, sent: 0, resolved: 0 });

  let sent = 0;
  let resolved = 0;

  for (const org of orgs) {
    if (!isFeatureEnabled(org.features, 'kiosk_alerts')) continue;
    const cfg = org.alert_config ?? {};
    const recipient = (cfg.recipient_email || org.notify_email || '').trim();
    const webhookUrl = org.webhook_url;
    if (!recipient && !webhookUrl) continue; // aucun canal de notification → on saute

    // 2. Bornes du compte, puis les événements auxquels elles sont assignées (LAB-242 : l'alerte
    //    part au compte de la borne, même si l'événement appartient à un autre compte).
    const { data: licenses } = await db
      .from('kiosk_licenses')
      .select('id, machine_id, label, last_seen_at, printer_status, camera_status, paper_capacity, paper_reset_at')
      .eq('org_id', org.id)
      .is('retired_at', null);
    if (!licenses?.length) continue;
    const sender = recipient ? await orgSender(db, org.id) : undefined;
    const licenseById = new Map(licenses.map((l) => [l.id, l]));

    const { data: events } = await db
      .from('events')
      .select(EVENT_COLUMNS)
      .in('photobooth_id', [...licenseById.keys()]);

    // En cours au jour près (Paris), jusqu'à 6 h le lendemain de la fin (LAB-333) : comparer les heures
    // laissait une fenêtre vide quand début = fin, et aucune alerte ne partait.
    const active = (events ?? []).filter((e) => isEventInProgress(e, now));

    for (const ev of active) {
      const lic = licenseById.get(ev.photobooth_id);
      if (!lic?.machine_id) continue;

      const machineName = lic.label || lic.machine_id || '—';
      const maxPrints = ev.form_config?.kiosk?.result?.max_prints_per_event ?? null;

      // Tirages (uniquement si l'alerte concernée est active, pour éviter des requêtes inutiles)
      let printsUsed = 0;
      if (cfg.print_quota_near?.enabled && maxPrints) {
        const { data: prints } = await db.from('print_logs').select('copies').eq('event_id', ev.id);
        printsUsed = (prints ?? []).reduce((s, p) => s + (p.copies ?? 0), 0);
      }
      let paperUsed = 0;
      if (cfg.paper_low?.enabled && lic.paper_capacity) {
        let pq = db.from('print_logs').select('copies').eq('machine_id', lic.machine_id);
        if (lic.paper_reset_at) pq = pq.gte('printed_at', lic.paper_reset_at);
        const { data: pp } = await pq;
        paperUsed = (pp ?? []).reduce((s, p) => s + (p.copies ?? 0), 0);
      }

      const inputs = {
        cfg, eventName: ev.name, machineName,
        lastSeenAt: lic.last_seen_at, printerStatus: lic.printer_status, cameraStatus: lic.camera_status,
        maxPrints, printsUsed, paperCapacity: lic.paper_capacity, paperUsed, now,
      };
      const candidates = evaluateAlerts(inputs);
      const held = new Set(heldAlertTypes(inputs)); // état inconnu : ni ouverture ni résolution

      // 3. Réconciliation ouvert/résolu (anti-spam : 1 alerte ouverte par event×machine×type)
      const triggering = new Map(candidates.map((c) => [c.type, c]));

      const { data: openRows } = await db
        .from('kiosk_alerts')
        .select('id, alert_type')
        .eq('event_id', ev.id)
        .eq('machine_id', lic.machine_id)
        .neq('alert_type', 'kiosk_errors') // réconciliées à part, sur les journaux (étape 4)
        .is('resolved_at', null);
      const openTypes = new Set((openRows ?? []).map((r) => r.alert_type as AlertType));

      // a) Nouveaux problèmes → notification + ouverture
      for (const [type, c] of triggering) {
        if (openTypes.has(type)) continue; // déjà ouvert → pas de relance
        try {
          if (recipient) {
            await sendKioskAlertEmail({
              to: recipient, subject: c.subject, heading: c.heading,
              eventName: ev.name, machineName, detail: c.detail, adminUrl, color: c.color, sender,
            });
          }
          await postWebhook(webhookUrl, {
            kind: 'kiosk_alert', status: 'open', alert_type: type,
            org_id: org.id, event_id: ev.id, event_name: ev.name,
            machine_id: lic.machine_id, machine_name: machineName,
            detail: c.detail.replace(/<[^>]+>/g, ''), at: new Date().toISOString(),
          });
          await db.from('kiosk_alerts').insert({
            org_id: org.id, event_id: ev.id, machine_id: lic.machine_id,
            alert_type: type, detail: c.detail.replace(/<[^>]+>/g, ''), recipient: recipient || null,
          });
          sent++;
        } catch (e) {
          console.error('Échec envoi alerte', type, ev.id, e);
        }
      }

      // b) Problèmes disparus → résolution + notification "rentré dans l'ordre"
      for (const row of (openRows ?? [])) {
        if (triggering.has(row.alert_type as AlertType)) continue; // toujours actif
        if (held.has(row.alert_type as AlertType)) continue;       // état inconnu (machine hors ligne)
        const r = RESOLVE[row.alert_type as AlertType];
        try {
          await db.from('kiosk_alerts').update({ resolved_at: new Date().toISOString() }).eq('id', row.id);
          if (recipient && r) {
            await sendKioskAlertEmail({
              to: recipient, subject: `${r.subject} — ${ev.name}`, heading: r.heading,
              eventName: ev.name, machineName, detail: r.detail(machineName), adminUrl, color: '#10b981', sender,
            });
          }
          await postWebhook(webhookUrl, {
            kind: 'kiosk_alert', status: 'resolved', alert_type: row.alert_type,
            org_id: org.id, event_id: ev.id, event_name: ev.name,
            machine_id: lic.machine_id, machine_name: machineName, at: new Date().toISOString(),
          });
          resolved++;
        } catch (e) {
          console.error('Échec résolution alerte', row.alert_type, ev.id, e);
        }
      }
    }

    // 4. Erreurs graves de la borne (LAB-329), sur les journaux de ses bornes.
    const errors = await reconcileKioskErrors({
      db, org, cfg, recipient, webhookUrl, sender, appUrl: APP_URL, now, licenses, events: events ?? [],
    });
    sent += errors.sent;
    resolved += errors.resolved;
  }

  return jsonResponse(200, { checked: orgs.length, sent, resolved });
});
