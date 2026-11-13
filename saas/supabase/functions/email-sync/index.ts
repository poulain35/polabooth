/**
 * POST /functions/v1/email-sync — resynchronise le suivi d'UN email depuis l'API Brevo (LAB-123).
 *
 * Secours du webhook brevo-webhook (webhook non déclaré, en panne, ou emails envoyés avant sa mise
 * en place) : GET /v3/smtp/statistics/events?messageId=… puis même logique que le webhook
 * (_shared/email-tracking.ts) : historique dédoublonné, statut recalculé.
 *
 * Headers : Authorization: Bearer {admin_jwt} (verify_jwt = true)
 * Body    : { "email_log_id": "uuid" }
 * Accès   : propriétaire de l'organisation du lead, de l'événement ou du prospect de la ligne email_logs.
 *           20 resynchros / 10 min par admin (quota de l'API Brevo partagé avec les envois).
 * SMTP (lot S2) : aucun suivi à resynchroniser, réponse 200 { skipped: true } sans rien lire.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireOrgAccess } from '../_shared/admin-guard.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
import { resolveEmailProvider } from '../_shared/email-provider.ts';
import { applyBrevoEvents, messageIdVariants, parseStatisticsEvents } from '../_shared/email-tracking.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_COLUMNS = 'id, lead_id, event_id, prospect_id, recipient, type, subject, sent_at, status, provider_message_id, '
  + 'delivered_at, opened_at, clicked_at, bounced_at, open_count, click_count, last_event, last_event_at, error_reason, updated_at';
// Profondeur maximale de l'API statistics/events.
const LOOKBACK_DAYS = 90;
const BREVO_TIMEOUT_MS = 10_000;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const provider = await resolveEmailProvider(() => serviceSecret('BREVO_API_KEY'));
  if (provider !== 'brevo') {
    return corsResponse(200, {
      skipped: true,
      provider,
      message: "Suivi indisponible avec SMTP : aucun événement de réception, d'ouverture ou de clic à resynchroniser.",
    });
  }

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;

  let body: { email_log_id?: unknown };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }
  const emailLogId = typeof body?.email_log_id === 'string' ? body.email_log_id : '';
  if (!UUID.test(emailLogId)) return corsResponse(400, { error: 'email_log_id requis' });

  const db = adminClient();
  const { data: log, error: logErr } = await db.from('email_logs')
    .select('id, lead_id, event_id, prospect_id, provider_message_id').eq('id', emailLogId).maybeSingle();
  if (logErr) return corsResponse(500, { error: 'Lecture du suivi impossible' });
  if (!log) return corsResponse(404, { error: 'Email introuvable' });

  const access = await requireOrgAccess(db, auth.user.id, log.lead_id
    ? { kind: 'lead', id: log.lead_id }
    : log.prospect_id
      ? { kind: 'prospect', id: log.prospect_id }
      : { kind: 'event', id: log.event_id });
  if (access.response) return access.response;

  const guard = publicGuard('email-sync', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.emailSyncUser, auth.user.id]]);
  if (limited) return limited;

  if (!log.provider_message_id) {
    return corsResponse(422, { error: 'Aucun identifiant Brevo pour cet email : suivi impossible' });
  }
  const apiKey = await serviceSecret('BREVO_API_KEY');
  if (!apiKey) return corsResponse(503, { error: 'BREVO_API_KEY non configurée' });

  // Brevo indexe le message-id avec chevrons, tel que renvoyé à l'envoi.
  const messageId = messageIdVariants(log.provider_message_id)[0];
  const url = new URL('https://api.brevo.com/v3/smtp/statistics/events');
  url.searchParams.set('messageId', messageId);
  url.searchParams.set('days', String(LOOKBACK_DAYS));
  url.searchParams.set('limit', '500');
  url.searchParams.set('sort', 'asc');

  let payload: unknown;
  try {
    const res = await fetch(url, {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`email-sync : Brevo ${res.status}`, (await res.text().catch(() => '')).slice(0, 300));
      return corsResponse(502, { error: `Brevo indisponible (${res.status})` });
    }
    payload = await res.json();
  } catch (e) {
    console.error('email-sync : appel Brevo', e instanceof Error ? e.message : e);
    return corsResponse(502, { error: 'Brevo injoignable' });
  }

  // On ne garde que les événements de cet email (l'API filtre déjà, garde-fou si elle l'ignorait).
  const wanted = new Set(messageIdVariants(messageId));
  const events = parseStatisticsEvents(payload).filter((e) => wanted.has(e.messageId));

  try {
    await applyBrevoEvents(db, messageId, events, 'sync', new Date().toISOString());
  } catch (e) {
    console.error('email-sync :', e instanceof Error ? e.message : e);
    return corsResponse(500, { error: 'Mise à jour du suivi impossible' });
  }

  const { data: updated } = await db.from('email_logs').select(LOG_COLUMNS).eq('id', log.id).maybeSingle();
  return corsResponse(200, { email_log: updated, events: events.length });
});
