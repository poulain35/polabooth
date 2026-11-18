// Réconciliation des alertes kiosk_errors d'une organisation (LAB-329) : lectures, écritures et envois.
// Règles pures dans kiosk-errors.ts (planKioskErrors), testées dans kiosk-errors.test.ts.

import type { adminClient } from '../_shared/auth.ts';
import { sendKioskAlertEmail } from '../_shared/email.ts';
import type { orgSender } from '../_shared/org-identity.ts';
import { RESOLVE, KIOSK_ERRORS_QUIET_MIN } from './evaluate.ts';
import { planKioskErrors, detailText, kioskLogsUrl } from './kiosk-errors.ts';
import { postWebhook } from './notify.ts';

/** Colonnes lues des événements (boucle par événement d'index.ts et événements des journaux). */
export const EVENT_COLUMNS = 'id, name, org_id, photobooth_id, status, start_date, end_date, form_config';

/**
 * Alertes kiosk_errors d'une organisation : plantage ou erreurs d'appareil photo répétées pendant un
 * événement en cours (règles dans planKioskErrors). L'alerte est insérée avant l'email : l'index
 * unique uniq_kiosk_alerts_open (événement, borne, type) refuse une 2e alerte ouverte, donc un seul
 * email même si deux passages se chevauchent. Résolution : mise à jour conditionnelle, même garantie.
 */
export async function reconcileKioskErrors(p: {
  db: ReturnType<typeof adminClient>;
  org: { id: string };
  cfg: Record<string, any>;
  recipient: string;
  webhookUrl: string | null | undefined;
  sender: Awaited<ReturnType<typeof orgSender>> | undefined;
  appUrl: string;
  now: number;
  licenses: { id: string; machine_id: string; label: string | null; last_seen_at: string | null }[];
  events: any[];
}): Promise<{ sent: number; resolved: number }> {
  const { db, org, cfg, recipient, webhookUrl, sender, now } = p;
  const orgId = org.id; // alertes du compte de la borne (les événements, eux, ne sont pas filtrés par compte)
  const out = { sent: 0, resolved: 0 };

  const { data: openAlerts, error: openErr } = await db
    .from('kiosk_alerts')
    .select('id, event_id, machine_id')
    .eq('org_id', orgId)
    .eq('alert_type', 'kiosk_errors')
    .is('resolved_at', null);
  if (openErr) { console.error('Lecture des alertes kiosk_errors', openErr.message); return out; }
  if (!cfg.kiosk_errors?.enabled && !openAlerts?.length) return out;

  const licenses = p.licenses.filter((l) => l.machine_id);
  if (!licenses.length) return out;
  const { data: logs, error: logErr } = await db
    .from('kiosk_logs')
    .select('machine_id, event_id, level, context, message, occurred_at')
    .in('machine_id', licenses.map((l) => l.machine_id))
    .eq('level', 'error')
    .gte('occurred_at', new Date(now - KIOSK_ERRORS_QUIET_MIN * 60_000).toISOString())
    .order('occurred_at', { ascending: false })
    .limit(2000);
  // Journaux illisibles : ni ouverture ni résolution (une alerte ne se résout pas faute de lecture).
  if (logErr) { console.error('Lecture des journaux de la borne', logErr.message); return out; }

  const events = new Map(p.events.map((e) => [e.id, e]));
  const missing = [...new Set([...(logs ?? []).map((l) => l.event_id), ...(openAlerts ?? []).map((a) => a.event_id)])]
    .filter((id): id is string => !!id && !events.has(id));
  if (missing.length) {
    const { data: more } = await db.from('events').select(EVENT_COLUMNS).in('id', missing);
    for (const e of more ?? []) events.set(e.id, e);
  }

  const plan = planKioskErrors({
    cfg, orgId: org.id, licenses, events: [...events.values()], logs: logs ?? [], openAlerts: openAlerts ?? [], now,
  });

  for (const o of plan.open) {
    const c = o.candidate;
    const { data: row, error: insErr } = await db.from('kiosk_alerts').insert({
      org_id: org.id, event_id: o.eventId, machine_id: o.machineId,
      alert_type: 'kiosk_errors', detail: detailText(c.detail), recipient: recipient || null,
    }).select('id').maybeSingle();
    if (insErr || !row) {
      if (insErr?.code !== '23505') console.error('Ouverture alerte kiosk_errors', o.eventId, insErr?.message);
      continue; // 23505 : déjà ouverte par un autre passage
    }
    out.sent++;
    try {
      if (recipient) {
        await sendKioskAlertEmail({
          to: recipient, subject: c.subject, heading: c.heading, eventName: o.eventName,
          machineName: o.machineName, detail: c.detail, adminUrl: kioskLogsUrl(p.appUrl, o.eventId), color: c.color, sender,
        });
      }
    } catch (e) {
      console.error('Échec email alerte kiosk_errors', o.eventId, e);
    }
    await postWebhook(webhookUrl, {
      kind: 'kiosk_alert', status: 'open', alert_type: 'kiosk_errors',
      org_id: org.id, event_id: o.eventId, event_name: o.eventName,
      machine_id: o.machineId, machine_name: o.machineName,
      detail: detailText(c.detail), at: new Date().toISOString(),
    });
  }

  const r = RESOLVE.kiosk_errors;
  for (const a of plan.resolve) {
    const { data: row, error: updErr } = await db.from('kiosk_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', a.alertId)
      .is('resolved_at', null)
      .select('id')
      .maybeSingle();
    if (updErr || !row) {
      if (updErr) console.error('Résolution alerte kiosk_errors', a.alertId, updErr.message);
      continue;
    }
    out.resolved++;
    try {
      if (recipient) {
        await sendKioskAlertEmail({
          to: recipient, subject: `${r.subject} — ${a.eventName}`, heading: r.heading, eventName: a.eventName,
          machineName: a.machineName, detail: r.detail(a.machineName),
          adminUrl: kioskLogsUrl(p.appUrl, a.eventId), color: '#10b981', sender,
        });
      }
    } catch (e) {
      console.error('Échec email résolution kiosk_errors', a.alertId, e);
    }
    await postWebhook(webhookUrl, {
      kind: 'kiosk_alert', status: 'resolved', alert_type: 'kiosk_errors',
      org_id: org.id, event_id: a.eventId, event_name: a.eventName,
      machine_id: a.machineId, machine_name: a.machineName, at: new Date().toISOString(),
    });
  }
  return out;
}
