/**
 * POST /functions/v1/review-design
 *
 * Approuve ou rejette un design soumis par un client.
 * Envoie un email de notification au client.
 *
 * Headers: Authorization: Bearer {admin_jwt}
 * Body:
 * {
 *   "design_id": "uuid",
 *   "action":    "approve" | "reject",
 *   "feedback":  "..." // obligatoire si action = "reject"
 * }
 *
 * Refus Brevo : la décision reste enregistrée, la réponse est un 502 avec le motif et
 * `reviewed: true` pour que l'admin voie le nouveau statut et sache que le client n'est pas prévenu.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { authenticate, forbiddenOrg } from '../_shared/admin-guard.ts';
import { sendApprovalEmail, sendRejectionEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { BREVO_REFUSED_STATUS, brevoRefusedBody } from '../send-delivery/manual-send.ts';
import { appUrl } from '../_shared/app-url.ts';

const APP_URL      = appUrl();

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  // Vérifier l'authentification admin
  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const user = auth.user;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { design_id, action, feedback } = body as {
    design_id?: string;
    action?:    string;
    feedback?:  string;
  };

  if (!design_id || !action || !['approve', 'reject'].includes(action)) {
    return corsResponse(400, { error: 'design_id et action (approve|reject) requis' });
  }
  if (action === 'reject' && !feedback?.trim()) {
    return corsResponse(400, { error: 'Un retour client est requis pour rejeter un template' });
  }

  const db = adminClient();

  // Récupérer le design
  const { data: design, error: dsErr } = await db
    .from('client_designs')
    .select('id, event_id, status')
    .eq('id', design_id)
    .single();

  if (dsErr || !design) return corsResponse(404, { error: 'Design introuvable' });
  if (design.status !== 'submitted') {
    return corsResponse(409, { error: 'Ce design n\'est pas en attente de validation' });
  }

  // Récupérer l'événement
  const { data: event } = await db
    .from('events')
    .select('id, name, org_id, client_email, client_name, access_code')
    .eq('id', design.event_id)
    .single();

  if (!event) return corsResponse(404, { error: 'Événement introuvable' });

  // Vérifier que l'utilisateur admin appartient à cet org
  const { data: org } = await db
    .from('organizations')
    .select('id')
    .eq('id', event.org_id)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!org) return forbiddenOrg();
  const disabled = await requireFeature(db, event.org_id, 'client_design');
  if (disabled) return disabled;

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  // Mettre à jour le design
  await db.from('client_designs').update({
    status:          newStatus,
    reviewed_at:     new Date().toISOString(),
    review_feedback: action === 'reject' ? (feedback ?? null) : null,
  }).eq('id', design_id);

  // En cas de refus, remettre l'événement en 'active' pour que le client puisse resoumettre
  if (action === 'reject') {
    await db.from('events').update({ status: 'active' }).eq('id', event.id);
  }

  // Envoyer email au client si email disponible
  if (event.client_email) {
    const editorUrl = `${APP_URL}/e/${event.access_code}`;
    const sender = await orgSender(db, org.id);
    const sentEmail = action === 'approve'
      ? await sendApprovalEmail({
        to:         event.client_email,
        clientName: event.client_name ?? 'Client',
        eventName:  event.name,
        sender,
      })
      : await sendRejectionEmail({
        to:         event.client_email,
        clientName: event.client_name ?? 'Client',
        eventName:  event.name,
        editorUrl,
        feedback:   feedback!,
        sender,
      });
    await recordEmailLog(db, {
      scope: { eventId: event.id }, recipient: event.client_email,
      type: action === 'approve' ? 'design_approved' : 'design_rejected', ...sentEmail,
    });
    if (sentEmail.error) {
      return corsResponse(BREVO_REFUSED_STATUS, {
        ...brevoRefusedBody(
          action === 'approve' ? "Template approuvé, mais l'email au client" : "Template refusé, mais l'email au client",
          sentEmail.error,
          'Prévenez le client directement.',
        ),
        reviewed: true,
      });
    }
  }

  return corsResponse(200, {
    message: action === 'approve' ? 'Template approuvé' : 'Template refusé',
  });
});
