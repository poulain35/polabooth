/**
 * send-design-reminders — appelée par pg_cron une fois par jour (service_role).
 *
 * Pour chaque organisation ayant activé les relances (organizations.design_reminders.enabled),
 * parcourt ses événements actifs, calcule le nombre de jours restants avant end_date, et pour
 * chaque jalon configuré (« jours avant l'événement ») atteint et non encore envoyé, relance le
 * client si son design n'est ni soumis ni approuvé.
 *
 * Idempotence : un jalon n'est envoyé qu'une seule fois par événement (trace dans email_logs
 * avec type = 'design_reminder_j<N>').
 *
 * Opt-out : pas de relance si l'événement est archivé, sans client_email, ou si la relance est
 * désactivée en config.
 */

import { adminClient } from '../_shared/auth.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { isFeatureEnabled } from '../_shared/features.ts';
import { sendDesignReminderEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSenderCache } from '../_shared/org-identity.ts';

const DEFAULT_MILESTONES = [20, 10];

/** Jours entiers restants entre aujourd'hui (UTC minuit) et une date de fin (incluse). */
function daysUntil(endDate: string, now: number): number {
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const today = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((end - today) / 86_400_000);
}

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

  if (orgErr) return json(500, { error: orgErr.message });
  if (!orgs?.length) return json(200, { checked: 0, sent: 0 });

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
      .select('id, name, status, end_date, client_name, client_email, access_code')
      .eq('org_id', org.id)
      .neq('status', 'archived')
      .not('client_email', 'is', null)
      .not('end_date', 'is', null);

    for (const ev of events ?? []) {
      if (!ev.client_email) continue;

      const daysLeft = daysUntil(ev.end_date, now);
      // L'événement est passé ou n'est pas encore dans la fenêtre de relance
      if (daysLeft < 0) continue;

      // Jalons dûs aujourd'hui : jour restant <= jalon (on ne rate pas un jalon si le cron
      // saute un jour), du plus proche au plus lointain
      const dueMilestones = milestones
        .filter((m) => Number.isFinite(m) && daysLeft <= m)
        .sort((a, b) => a - b);
      if (!dueMilestones.length) continue;

      // 3. Le design est-il déjà soumis / approuvé ? (dernier design de l'événement)
      const { data: design } = await db
        .from('client_designs')
        .select('status')
        .eq('event_id', ev.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (design && (design.status === 'submitted' || design.status === 'approved')) continue;

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
          templateId,
          sender:     await senderOf(org.id),
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

  return json(200, { checked: orgs.length, sent });
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
