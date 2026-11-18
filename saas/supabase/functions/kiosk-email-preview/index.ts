/**
 * POST /functions/v1/kiosk-email-preview — aperçu et email de test de l'email de la borne (LAB-300, D10).
 *
 * Headers : Authorization: Bearer {admin_jwt} (verify_jwt = true)
 * Body    : { "event_id": "uuid", "action": "preview" | "test", "media": "photo" | "animation",
 *             "draft": { "email": {…}, "branding": {…} } }
 * Accès   : propriétaire de l'organisation de l'événement (403 sinon).
 *
 * Le brouillon (valeurs non enregistrées) passe par-dessus form_config, puis l'email est construit par
 * _shared/kiosk-email.ts, comme l'envoi réel de send-kiosk-photo : l'aperçu est l'email envoyé.
 * - preview → { subject, html } : HTML avec la marque de l'instance, tel qu'il part.
 * - test    → envoi à l'adresse du compte connecté seulement, objet « [Test] … », non compté
 *             (aucune ligne event_activity), 10 par heure et par compte. Marche même si l'événement est
 *             inactif ou l'envoi par email désactivé.
 * Photo d'exemple : la dernière de l'événement, sinon le PNG du design validé, sinon un cadre gris.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireOrgAccess } from '../_shared/admin-guard.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { brandEmailHtml, EmailSendError, sendHtmlEmail } from '../_shared/email.ts';
import { buildKioskEmail, mergeDraft, parsePreviewRequest, previewSample, testSubject } from '../_shared/kiosk-email.ts';
import { ANIMATED_MEDIA_TYPES } from '../_shared/kiosk-photo.ts';
import { getOrgIdentity, identityDefaults } from '../_shared/org-identity.ts';
import { publicAppUrl } from '../_shared/app-url.ts';

const APP_URL = publicAppUrl();

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }
  const request = parsePreviewRequest(body);
  if ('error' in request) return corsResponse(400, { error: request.error });

  const db = adminClient();
  const access = await requireOrgAccess(db, auth.user.id, { kind: 'event', id: request.eventId });
  if (access.response) return access.response;

  const to = auth.user.email ?? '';
  if (request.action === 'test') {
    if (!to) return corsResponse(400, { error: 'Votre compte n\'a pas d\'adresse email' });
    const guard = publicGuard('kiosk-email-preview', req, db, Deno.env.get('RATE_LIMIT_SALT'));
    const limited = await guard.check([[LIMITS.kioskEmailTestUser, auth.user.id]]);
    if (limited) return limited;
  }

  const { data: event, error: evErr } = await db
    .from('events')
    .select('id, org_id, name, access_code, start_date, client_name, form_config')
    .eq('id', request.eventId)
    .single();
  if (evErr || !event) return corsResponse(404, { error: 'Événement introuvable' });

  let photos = db.from('photos')
    .select('id, photo_url, thumbnail_url, media_type')
    .eq('event_id', event.id);
  photos = request.media === 'animation'
    ? photos.in('media_type', [...ANIMATED_MEDIA_TYPES])
    : photos.eq('media_type', 'photo');
  const { data: samples } = await photos.order('created_at', { ascending: false }).limit(1);
  const sampleRow = Array.isArray(samples) && samples[0]?.photo_url ? samples[0] : null;
  const { data: design } = sampleRow ? { data: null } : await db
    .from('client_designs')
    .select('final_png_url')
    .eq('event_id', event.id)
    .eq('kind', 'print')
    .eq('status', 'approved')
    .maybeSingle();
  const { photo, photoUrl } = previewSample({
    media: request.media,
    sample: sampleRow,
    designUrl: typeof design?.final_png_url === 'string' && design.final_png_url ? design.final_png_url : null,
  });

  const identity = await getOrgIdentity(db, event.org_id, { ...identityDefaults(), senderName: '' });
  const { subject, html, sender } = buildKioskEmail({
    event,
    email: mergeDraft(event.form_config?.kiosk?.email, request.draft.email),
    branding: mergeDraft(event.form_config?.branding, request.draft.branding),
    identity, photo, photoUrl, appUrl: APP_URL,
  });

  if (request.action === 'preview') {
    return corsResponse(200, { subject, html: await brandEmailHtml(html) });
  }

  let messageId: string | null;
  try {
    messageId = await sendHtmlEmail({ to, subject: testSubject(subject), html, sender });
  } catch (e) {
    if (e instanceof EmailSendError) return corsResponse(502, { error: `Erreur d'envoi : ${e.status}` });
    throw e;
  }
  if (!messageId) {
    return corsResponse(200, { sent: false, message: 'Aucun email envoyé : ni Brevo ni SMTP configuré, ou adresse hors EMAIL_ALLOWLIST' });
  }
  return corsResponse(200, { sent: true, to });
});
