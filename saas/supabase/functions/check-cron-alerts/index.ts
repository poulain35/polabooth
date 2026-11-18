/**
 * check-cron-alerts — appelée par pg_cron toutes les 15 min (service_role), LAB-102.
 *
 * Lit public.cron_health_snapshot() (exécutions pg_cron + réponses net.http_post tracées par
 * public.cron_http_post), en déduit les jobs en anomalie (evaluate.ts) et prévient l'admin par
 * email Brevo, au plus une fois par job et par 24 h. État persistant : public.cron_job_alerts.
 *
 * Le relevé est retenté une fois après une erreur transitoire (timeout SQL, connexion), LAB-122. Ses
 * propres appels sont tracés par la commande du job pg_cron (cron_http_calls) : un échec isolé est
 * toléré, l'alerte part à partir de 2 passages consécutifs en échec (HTTP_FAILURE_STREAK).
 *
 * verify_jwt = true (défaut) + rôle service_role exigé. Destinataire : notify_email (à défaut
 * contact_email) de l'organisation de l'instance (la plus ancienne, décision D1 de l'open core) :
 * la surveillance des tâches fait partie du socle et ne dépend pas de la réservation (BOOKING_ORG_ID).
 */

import { adminClient } from '../_shared/auth.ts';
import { corsResponse } from '../_shared/cors.ts';
import { isServiceRoleJwt } from '../_shared/admin-guard.ts';
import { sendHtmlEmail } from '../_shared/email.ts';
import {
  HTTP_FAILURE_STREAK, HTTP_HISTORY_LIMIT, planCronAlerts,
  type CronAlertState, type CronHttpCall, type CronJobSnapshot,
} from './evaluate.ts';
import { retryOnceIfTransient } from './retry.ts';
import { renderCronAlertEmail } from './email.ts';

type Db = ReturnType<typeof adminClient>;

async function adminRecipient(db: Db): Promise<string | null> {
  const { data, error } = await db.from('organizations').select('notify_email, contact_email')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`organisation : ${error.message}`);
  return (data?.notify_email || data?.contact_email || '').trim() || null;
}

/** Relevé, retenté une seule fois (après 2 s) sur erreur transitoire : logique testée dans retry.test.ts. */
function healthSnapshot(db: Db) {
  return retryOnceIfTransient(
    () => db.rpc('cron_health_snapshot'),
    (error) => console.warn('check-cron-alerts snapshot, nouvel essai :', error.message),
  );
}

/** Appels récents des jobs de HTTP_FAILURE_STREAK ; un job illisible est omis (échec tenu pour isolé). */
async function httpHistory(db: Db): Promise<Record<string, CronHttpCall[]>> {
  const out: Record<string, CronHttpCall[]> = {};
  for (const jobName of Object.keys(HTTP_FAILURE_STREAK)) {
    const { data, error } = await db.from('cron_http_calls')
      .select('request_id, requested_at, timeout_ms, status_code, timed_out, error_msg, response_excerpt, responded_at')
      .eq('job_name', jobName)
      .order('requested_at', { ascending: false })
      .limit(HTTP_HISTORY_LIMIT);
    if (error) console.error('check-cron-alerts historique', jobName, error.message);
    else out[jobName] = (data ?? []) as CronHttpCall[];
  }
  return out;
}

function dashboardUrl(): string | null {
  const ref = (Deno.env.get('SUPABASE_URL') ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  return ref ? `https://supabase.com/dashboard/project/${ref}/integrations/cron/jobs` : null;
}

Deno.serve(async (req) => {
  if (!isServiceRoleJwt(req.headers.get('Authorization'))) {
    return corsResponse(403, { error: 'interdit', message: 'Réservé au cron (service_role).' });
  }

  const db = adminClient();
  const now = Date.now();

  const { data: jobs, error: snapErr } = await healthSnapshot(db);
  if (snapErr) {
    console.error('check-cron-alerts snapshot :', snapErr.message);
    return corsResponse(500, { error: 'Lecture de l’état des tâches impossible' });
  }
  const { data: previous, error: stateErr } = await db.from('cron_job_alerts').select('*');
  if (stateErr) {
    console.error('check-cron-alerts état :', stateErr.message);
    return corsResponse(500, { error: 'Lecture des alertes impossible' });
  }

  const plan = planCronAlerts((jobs ?? []) as CronJobSnapshot[], (previous ?? []) as CronAlertState[], now, await httpHistory(db));

  // État enregistré AVANT les envois : si l'écriture échoue, aucun email ne part (pas de rafale toutes
  // les 15 min sur une table cassée).
  if (plan.states.length) {
    const updatedAt = new Date(now).toISOString();
    const { error } = await db.from('cron_job_alerts')
      .upsert(plan.states.map((s) => ({ ...s, updated_at: updatedAt })), { onConflict: 'job_name' });
    if (error) {
      console.error('check-cron-alerts enregistrement :', error.message);
      return corsResponse(500, { error: 'Enregistrement des alertes impossible' });
    }
  }

  let sent = 0;
  if (plan.notify.length) {
    const recipient = await adminRecipient(db);
    if (!recipient) console.warn('check-cron-alerts : aucun email admin, alertes non envoyées');
    for (const n of recipient ? plan.notify : []) {
      try {
        const { subject, html } = renderCronAlertEmail({ ...n, dashboardUrl: dashboardUrl() });
        await sendHtmlEmail({ to: recipient!, subject, html });
        sent++;
        const { error } = await db.from('cron_job_alerts')
          .update({ last_notified_at: new Date(now).toISOString(), last_recipient: recipient })
          .eq('job_name', n.jobName);
        if (error) console.error('check-cron-alerts last_notified_at', n.jobName, error.message);
      } catch (e) {
        console.error('check-cron-alerts email', n.jobName, e);
      }
    }
  }

  const summary = { jobs: jobs?.length ?? 0, failing: plan.states.filter((s) => s.failing_since).map((s) => s.job_name), opened: plan.opened, resolved: plan.resolved, sent };
  console.log('check-cron-alerts', JSON.stringify(summary));
  return corsResponse(200, { ok: true, ...summary });
});
