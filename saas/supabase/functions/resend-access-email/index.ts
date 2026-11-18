/**
 * POST /functions/v1/resend-access-email
 *
 * Renvoie l'email de code d'accès à un client (cas où l'email n'a pas été reçu).
 * Réservé aux admins authentifiés.
 *
 * Headers: Authorization: Bearer {admin_jwt}
 * Body:    { "event_id": "uuid" }
 *
 * Refus Brevo : 502 avec le motif (la ligne email_logs est écrite au statut « error »).
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { authenticate, requireOrgAccess } from '../_shared/admin-guard.ts';
import { sendAccessCodeEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { clientTrackingUrl } from '../_shared/client-tracking.ts';
import { BREVO_REFUSED_STATUS, brevoRefusedBody } from '../send-delivery/manual-send.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  // Vérifier l'authentification admin via JWT
  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const user = auth.user;

  // Parser le body
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { event_id } = body as { event_id?: string };
  if (!event_id) return corsResponse(400, { error: 'event_id requis' });

  const db = adminClient();

  // Propriétaire de l'organisation de l'événement (404 si l'événement n'existe pas, 403 sinon).
  const access = await requireOrgAccess(db, user.id, { kind: 'event', id: event_id });
  if (access.response) return access.response;
  const disabled = await requireFeature(db, access.orgId, 'client_design');
  if (disabled) return disabled;

  const [{ data: event, error: evErr }, { data: org, error: orgErr }] = await Promise.all([
    db.from('events')
      .select('id, name, org_id, client_name, client_email, access_code, end_date')
      .eq('id', event_id)
      .single(),
    db.from('organizations')
      .select('id, brevo_access_template_id')
      .eq('id', access.orgId)
      .single(),
  ]);
  if (evErr || orgErr || !event || !org) {
    console.error('resend-access-email : lecture impossible', evErr ?? orgErr);
    return corsResponse(500, { error: 'Lecture de l’événement impossible, réessayez.' });
  }

  // Vérifier qu'un email client est renseigné
  if (!event.client_email) {
    return corsResponse(422, { error: 'Aucun email client renseigné pour cet événement' });
  }

  // Envoyer l'email
  const sentEmail = await sendAccessCodeEmail({
    to:         event.client_email,
    clientName: event.client_name ?? 'Client',
    eventName:  event.name,
    accessCode: event.access_code,
    expiresAt:  event.end_date ?? undefined,
    templateId: org.brevo_access_template_id ?? undefined,
    sender:     await orgSender(db, org.id),
    trackingUrl: await clientTrackingUrl(db, event.id),
  });

  await recordEmailLog(db, {
    scope: { eventId: event.id }, recipient: event.client_email, type: 'access_code', ...sentEmail,
  });

  if (sentEmail.error) {
    return corsResponse(BREVO_REFUSED_STATUS, brevoRefusedBody(
      "L'email de code d'accès", sentEmail.error, "Vérifiez l'adresse du client puis réessayez.",
    ));
  }

  return corsResponse(200, { message: 'Email renvoyé avec succès' });
});
