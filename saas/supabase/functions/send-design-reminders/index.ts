/**
 * send-design-reminders — appelée par pg_cron une fois par jour (service_role).
 *
 * Pour chaque organisation ayant activé les relances (organizations.design_reminders.enabled),
 * parcourt ses événements actifs, calcule le nombre de jours restants avant end_date, et pour
 * chaque jalon configuré (« jours avant l'événement ») atteint et non encore envoyé, relance le
 * client si aucun de ses cadres (designs 'print', LAB-312) n'est soumis ou approuvé, ou (LAB-322)
 * s'il a plusieurs cadres et qu'un cadre créé reste à envoyer (brouillon, ou refusé pas renvoyé) :
 * le texte dit alors combien. Mêmes jalons et même trace pour les deux cas.
 *
 * Idempotence : un jalon n'est envoyé qu'une seule fois par événement (trace dans email_logs
 * avec type = 'design_reminder_j<N>').
 *
 * Opt-out : pas de relance si l'événement est archivé, sans client_email, ou si la relance est
 * désactivée en config.
 */

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { isFeatureEnabled } from '../_shared/features.ts';
import { sendDesignReminderEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSenderCache } from '../_shared/org-identity.ts';
import { reminderDaysLeft, reminderFramesLeft } from '../_shared/design-frames.ts';
import { clientTrackingUrl } from '../_shared/client-tracking.ts';

const DEFAULT_MILESTONES = [20, 10];

Deno.serve(async (req) => {
  const denied = cronOnly(req, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (denied) return denied;

  const db = adminClient();
  const now = Date.now();

  // 1. Organisations avec relances activées
  const { data: orgs, error: orgErr } = await db
    .from('organizations')
    .select('id, features, design_reminders')
    .eq('design_reminders->>enabled', 'true');

  if (orgErr) {
    console.error('send-design-reminders : lecture des organisations', orgErr);
    return jsonResponse(500, { error: 'Lecture des organisations impossible' });
  }
  if (!orgs?.length) return jsonResponse(200, { checked: 0, sent: 0 });

  let sent = 0;
  const senderOf = orgSenderCache(db);

  for (const org of orgs) {
    if (!isFeatureEnabled(org.features, 'client_design')) continue;
    const cfg = org.design_reminders ?? {};
    const milestones: number[] = Array.isArray(cfg.milestones) && cfg.milestones.length
      ? cfg.milestones
      : DEFAULT_MILESTONES;
    const templateId: number | undefined = cfg.brevo_template_id ?? undefined;

    // 2. Événements non archivés de cette org avec un email client et une date de fin
    const { data: events } = await db
      .from('events')
      .select('id, name, status, end_date, client_name, client_email, access_code, form_config')
      .eq('org_id', org.id)
      .neq('status', 'archived')
      .not('client_email', 'is', null)
      .not('end_date', 'is', null);

    for (const ev of events ?? []) {
      if (!ev.client_email) continue;

      const daysLeft = reminderDaysLeft(ev.end_date, now);
      // Date illisible, ou événement passé
      if (!Number.isFinite(daysLeft) || daysLeft < 0) continue;

      // Jalons dûs aujourd'hui : jour restant <= jalon (on ne rate pas un jalon si le cron
      // saute un jour), du plus proche au plus lointain
      const dueMilestones = milestones
        .filter((m) => Number.isFinite(m) && daysLeft <= m)
        .sort((a, b) => a - b);
      if (!dueMilestones.length) continue;

      // 3. Cadres du modèle photo : aucun envoyé (relance d'avant) ou cadres créés restant à envoyer
      const { data: frames, error: framesErr } = await db
        .from('client_designs')
        .select('id, slot, status')
        .eq('event_id', ev.id)
        .eq('kind', 'print');
      if (framesErr) { console.error('Lecture des cadres', ev.id, framesErr.message); continue; }
      const framesLeft = reminderFramesLeft(frames, ev.form_config);
      if (framesLeft === null) continue;

      // 4. Quels jalons ont déjà été envoyés pour cet événement ?
      const { data: logs } = await db
        .from('email_logs')
        .select('type')
        .eq('event_id', ev.id)
        .like('type', 'design_reminder_j%');
      const alreadySent = new Set((logs ?? []).map((l) => l.type));

      // On envoie au plus un jalon par exécution : le plus proche non encore envoyé
      const toSend = dueMilestones.find((m) => !alreadySent.has(`design_reminder_j${m}`));
      if (toSend === undefined) continue;

      try {
        const sentEmail = await sendDesignReminderEmail({
          to:         ev.client_email,
          clientName: ev.client_name ?? 'Client',
          eventName:  ev.name ?? '',
          accessCode: ev.access_code,
          daysLeft,
          framesLeft: framesLeft || undefined,
          templateId,
          sender:     await senderOf(org.id),
          trackingUrl: await clientTrackingUrl(db, ev.id),
        });
        await recordEmailLog(db, {
          scope: { eventId: ev.id }, recipient: ev.client_email, type: `design_reminder_j${toSend}`, ...sentEmail,
        });
        sent++;
      } catch (e) {
        console.error('Échec relance design', ev.id, toSend, e);
      }
    }
  }

  return jsonResponse(200, { checked: orgs.length, sent });
});
