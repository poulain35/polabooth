/**
 * send-access-emails — appelée par pg_cron une fois par jour (service_role).
 *
 * Pour chaque organisation ayant activé l'email d'accès automatique
 * (organizations.business_profile.access_email_auto.enabled), parcourt ses événements non
 * archivés disposant d'un client_email et d'une date d'événement (start_date de préférence,
 * sinon end_date). Dès que l'événement atteint J-`days_before` (défaut 30), envoie au client
 * l'email contenant son code d'accès à l'éditeur (/e/CODE).
 *
 * Idempotence : l'accès n'est envoyé qu'une seule fois par événement. La trace est un log
 * email_logs de type 'access_code' — le MÊME type que celui écrit par resend-access-email lors
 * d'un envoi manuel. On ne double donc jamais un envoi manuel déjà effectué : présence d'un log
 * 'access_code' ⇒ skip.
 *
 * Opt-out : pas d'envoi si l'événement est archivé, sans client_email, sans date, ou si l'option
 * est désactivée en config.
 */

import { adminClient } from '../_shared/auth.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { isFeatureEnabled } from '../_shared/features.ts';
import { sendAccessCodeEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSenderCache } from '../_shared/org-identity.ts';

const DEFAULT_DAYS_BEFORE = 30;

/** Jours entiers entre aujourd'hui (UTC minuit) et une date d'événement (UTC minuit). */
function daysBefore(eventDate: string, now: number): number {
  const target = new Date(eventDate).getTime();
  const targetDay = new Date(new Date(target).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const today = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((targetDay - today) / 86_400_000);
}

Deno.serve(async (req) => {
  const denied = cronOnly(req, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (denied) return denied;

  const db = adminClient();
  const now = Date.now();

  // 1. Organisations avec l'email d'accès automatique activé
  const { data: orgs, error: orgErr } = await db
    .from('organizations')
    .select('id, features, business_profile, brevo_access_template_id')
    .eq('business_profile->access_email_auto->>enabled', 'true');

  if (orgErr) return json(500, { error: orgErr.message });
  if (!orgs?.length) return json(200, { checked: 0, sent: 0 });

  let sent = 0;
  const senderOf = orgSenderCache(db);

  for (const org of orgs) {
    if (!isFeatureEnabled(org.features, 'client_design')) continue;
    const cfg = org.business_profile?.access_email_auto ?? {};
    const daysThreshold: number = Number.isFinite(Number(cfg.days_before))
      ? Number(cfg.days_before)
      : DEFAULT_DAYS_BEFORE;
    const templateId: number | undefined = org.brevo_access_template_id ?? undefined;

    // 2. Événements non archivés de cette org avec un email client et une date
    const { data: events } = await db
      .from('events')
      .select('id, name, status, start_date, end_date, client_name, client_email, access_code')
      .eq('org_id', org.id)
      .neq('status', 'archived')
      .not('client_email', 'is', null);

    for (const ev of events ?? []) {
      if (!ev.client_email) continue;

      const eventDate = ev.start_date ?? ev.end_date;
      if (!eventDate) continue;

      const remaining = daysBefore(eventDate, now);
      // Événement passé : plus rien à envoyer
      if (remaining < 0) continue;
      // Pas encore dans la fenêtre J-days_before
      if (remaining > daysThreshold) continue;

      // 3. Un accès a-t-il déjà été envoyé (manuel ou auto) ? Si oui, on ne double jamais.
      const { data: existing } = await db
        .from('email_logs')
        .select('id')
        .eq('event_id', ev.id)
        .eq('type', 'access_code')
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      try {
        const sentEmail = await sendAccessCodeEmail({
          to:         ev.client_email,
          clientName: ev.client_name ?? 'Client',
          eventName:  ev.name || 'votre événement',
          accessCode: ev.access_code,
          expiresAt:  ev.end_date ?? undefined,
          templateId,
          sender:     await senderOf(org.id),
        });
        await recordEmailLog(db, {
          scope: { eventId: ev.id }, recipient: ev.client_email, type: 'access_code', ...sentEmail,
        });
        sent++;
      } catch (e) {
        console.error('Échec envoi accès auto', ev.id, e);
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
