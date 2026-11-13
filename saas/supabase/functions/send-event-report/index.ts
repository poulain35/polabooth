/**
 * send-event-report — envoi du bilan d'événement au client (LAB-238, spec LAB-209 SAAS-2).
 *
 * Authorization: Bearer {admin_jwt}, body { "event_id": "uuid", "photo_ids"?: ["uuid", …] (6 au plus) }.
 *
 * Étapes (ordre fixé par logic.ts) :
 *   1. JWT admin, propriétaire de l'organisation de l'événement (forbiddenOrg sinon) ;
 *   2. build_event_report(p_event_id, p_freeze => true) sous le JWT de l'admin (jamais service_role :
 *      auth.uid() y serait vide, 42501). La RPC refuse si une borne n'a pas tout envoyé (P0001) ;
 *   3. photos choisies (selected_photo_ids) sous le même JWT ;
 *   4. e-mail à events.client_email (Brevo, garde d'envoi de _shared/email.ts : aucun e-mail réel en dev) ;
 *   5. sent_at (client service_role : authenticated n'a pas ce droit) + email_logs type 'event_report'.
 * Brevo refuse : ligne email_logs « error », pas de sent_at, réponse 502 ; un premier envoi repasse en
 * brouillon (le lien n'est pas en ligne sans e-mail), un renvoi garde son lien.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { authenticate, forbiddenOrg, isServiceRoleRequest } from '../_shared/admin-guard.ts';
import { sendEventReportEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { getOrgIdentity, identitySender } from '../_shared/org-identity.ts';
import { brevoRefusedBody } from '../send-delivery/manual-send.ts';
import { adminJwtCalls } from './admin-jwt.ts';
import { INVALID_PHOTOS, REPORT_EMAIL_TYPE, parsePhotoIds, sendEventReport, type PreviousReport } from './logic.ts';
import { appUrl } from '../_shared/app-url.ts';

const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL        = appUrl().replace(/\/$/, '');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return corsResponse(401, { error: 'Non autorisé' });
  // Réservé à l'admin : sous service_role, build_event_report n'a pas d'utilisateur (42501).
  if (isServiceRoleRequest(authHeader, serviceRoleKey)) {
    return corsResponse(403, { error: "Envoi du bilan réservé à l'admin de l'événement" });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps invalide : refusé ci-dessous */ }
  const eventId = typeof body.event_id === 'string' ? body.event_id : '';
  if (!UUID_RE.test(eventId)) return corsResponse(400, { error: 'event_id manquant ou invalide' });
  const photoIds = parsePhotoIds(body.photo_ids);
  if (photoIds === false) return corsResponse(400, { error: INVALID_PHOTOS, code: 'invalid_photos' });

  const auth = await authenticate(authHeader, sessionUser);
  if (auth.response) return auth.response;
  const user = auth.user;

  const db = adminClient();
  const { data: event, error: evErr } = await db
    .from('events')
    .select('id, name, org_id, client_name, client_email')
    .eq('id', eventId)
    .maybeSingle();
  if (evErr || !event) return corsResponse(404, { error: 'Événement introuvable' });

  const { data: org } = await db
    .from('organizations')
    .select('id')
    .eq('id', event.org_id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!org) return forbiddenOrg();
  const disabled = await requireFeature(db, event.org_id, 'event_report');
  if (disabled) return disabled;

  const { data: previous, error: prevErr } = await db
    .from('event_reports')
    .select('status, frozen_at, expires_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (prevErr) {
    console.error('event_reports (lecture avant envoi)', eventId, prevErr.message);
    return corsResponse(500, { error: 'Le bilan n’a pas pu être lu, réessayez.' });
  }

  // Sous le JWT de l'admin (admin-jwt.ts) : la RPC et la sélection passent par ses droits et le garde de statut.
  const asAdmin = adminJwtCalls(authHeader, eventId);

  // Signature : nom commercial du profil, sinon fiche contact, sinon nom de l'organisation (org-identity.ts).
  const identity = await getOrgIdentity(db, org.id);
  const recipient = String(event.client_email ?? '').trim();

  const result = await sendEventReport({
    freeze: asAdmin.freeze,
    saveSelection: asAdmin.saveSelection,
    sendEmail: ({ reportUrl, expiresAt }) => sendEventReportEmail({
      to: recipient,
      clientName: event.client_name || 'Madame, Monsieur',
      eventName: event.name || 'votre événement',
      companyName: identity.companyName,
      reportUrl,
      expiresAt,
      sender: identitySender(identity),
    }),
    logEmail: (sent) => recordEmailLog(db, { scope: { eventId }, recipient, type: REPORT_EMAIL_TYPE, ...sent }),
    markSent: (reportId, sentAt) => db.from('event_reports').update({ sent_at: sentAt }).eq('id', reportId),
    rollback: (reportId, patch) => db.from('event_reports').update(patch).eq('id', reportId),
    now: () => new Date(),
    logError: (message, detail) => console.error(message, eventId, detail ?? ''),
  }, {
    appUrl: APP_URL,
    previous: (previous as PreviousReport | null) ?? null,
    photoIds,
    brevoRefused: (error) => brevoRefusedBody(
      "L'e-mail du bilan", error, 'Corrigez si besoin puis cliquez à nouveau sur « Envoyer au client ».',
    ),
  });

  return corsResponse(result.status, result.body);
});
