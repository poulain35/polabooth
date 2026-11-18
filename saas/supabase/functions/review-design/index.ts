/**
 * POST /functions/v1/review-design
 *
 * Approuve ou rejette un design soumis par un client : modèle photo (kind = 'print') ou écran
 * d'accueil de la borne (kind = 'home', LAB-290). Envoie un email de notification au client.
 * Un design validé (écran d'accueil, ou cadre du modèle photo depuis LAB-294) peut être refusé
 * (« Rouvrir pour correction ») : le client peut de nouveau le modifier. L'écran d'accueil ne touche
 * jamais events.status. Plusieurs cadres (LAB-312) : chacun se valide seul ; l'email cite le nom du cadre
 * quand l'événement a le choix du cadre ou que c'est un cadre ajouté. Règles : ./logic.ts.
 *
 * Un email par événement (LAB-322) : avec plusieurs cadres, le client n'est prévenu que quand plus
 * aucun cadre envoyé n'attend de décision, par un seul email qui résume les cadres validés et refusés
 * (motifs compris). Avant cela, la réponse porte `client_notified: false` et `pending_frames` (cadres
 * encore à traiter). Un seul cadre : email d'avant. Règles : ../_shared/design-frames.ts.
 *
 * Headers: Authorization: Bearer {admin_jwt}
 * Body:
 * {
 *   "design_id": "uuid",
 *   "action":    "approve" | "reject",
 *   "feedback":  "..." // obligatoire si action = "reject"
 * }
 *
 * Réponse : { message, client_notified, pending_frames }.
 *
 * Refus Brevo : la décision reste enregistrée, la réponse est un 502 avec le motif et
 * `reviewed: true` pour que l'admin voie le nouveau statut et sache que le client n'est pas prévenu.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { authenticate, forbiddenOrg, requireOrgAccess } from '../_shared/admin-guard.ts';
import { EmailSendError, sendApprovalEmail, sendHtmlEmail, sendRejectionEmail, type EmailSender, type SentEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { BREVO_REFUSED_STATUS, brevoRefusedBody } from '../send-delivery/manual-send.ts';
import { appUrl } from '../_shared/app-url.ts';
import { canReview, resetsEventStatus, reviewEmailLogType, reviewFrameLabel, reviewMessage, type ReviewAction } from './logic.ts';
import { frameChoiceConfig } from '../_shared/design-kind.ts';
import { renderHomeApprovalEmail, renderHomeRejectionEmail } from './home-emails.ts';
import { allFramesApproved, openFrames, renderFramesReviewEmail, reviewOutcome, type FrameRow } from '../_shared/design-frames.ts';
import { clientTrackingUrl } from '../_shared/client-tracking.ts';

const APP_URL      = appUrl();

/** Email HTML au client (écran d'accueil, bilan des cadres) : refus du fournisseur rendu dans `error`, comme les autres emails client. */
async function sendClientReviewEmail(to: string, email: { subject: string; html: string }, sender: EmailSender): Promise<SentEmail> {
  try {
    const messageId = await sendHtmlEmail({ to, subject: email.subject, html: email.html, sender });
    return { messageId, subject: email.subject, error: null };
  } catch (e) {
    if (e instanceof EmailSendError) return { messageId: null, subject: email.subject, error: e.message };
    throw e;
  }
}

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
    return corsResponse(400, { error: 'Un retour client est requis pour refuser un design' });
  }

  const db = adminClient();

  // Droits d'abord (LAB-392) : propriétaire de l'organisation de l'événement du design. Un design
  // inconnu donne 404, celui d'une autre organisation 403, avant toute autre lecture ou refus (409).
  const access = await requireOrgAccess(db, user.id, { kind: 'design', id: design_id });
  if (access.response) return access.response;

  // Récupérer le design
  const { data: design, error: dsErr } = await db
    .from('client_designs')
    .select('id, event_id, kind, status, slot, label')
    .eq('id', design_id)
    .single();

  if (dsErr || !design) return corsResponse(404, { error: 'Design introuvable' });
  const reviewAction = action as ReviewAction;
  const isHome = design.kind === 'home';
  if (!canReview(design.kind, design.status, reviewAction)) {
    return corsResponse(409, { error: 'Ce design n\'est pas en attente de validation' });
  }

  // Récupérer l'événement
  const { data: event } = await db
    .from('events')
    .select('id, name, org_id, client_email, client_name, access_code, form_config')
    .eq('id', design.event_id)
    .single();

  if (!event) return corsResponse(404, { error: 'Événement introuvable' });
  if (event.org_id !== access.orgId) return forbiddenOrg();
  const disabled = await requireFeature(db, event.org_id, 'client_design');
  if (disabled) return disabled;

  const newStatus = reviewAction === 'approve' ? 'approved' : 'rejected';

  // Mettre à jour le design
  await db.from('client_designs').update({
    status:          newStatus,
    reviewed_at:     new Date().toISOString(),
    review_feedback: action === 'reject' ? (feedback ?? null) : null,
  }).eq('id', design_id);

  // En cas de refus, remettre l'événement en 'active' pour que le client puisse resoumettre.
  // Seul le modèle photo pilote events.status (pas l'écran d'accueil).
  if (resetsEventStatus(design.kind, reviewAction)) {
    await db.from('events').update({ status: 'active' }).eq('id', event.id);
  }

  // Plusieurs cadres : un seul email au client, quand plus aucun cadre envoyé n'attend de décision.
  let outcome: ReturnType<typeof reviewOutcome> = { mode: 'single', pending: 0 };
  let frames: FrameRow[] = [];
  if (!isHome && event.client_email) {
    const { data: rows } = await db
      .from('client_designs')
      .select('id, slot, label, format, status, review_feedback')
      .eq('event_id', event.id)
      .eq('kind', 'print');
    frames = openFrames(rows, event.form_config, design.id);
    outcome = reviewOutcome(frames);
  }

  // Envoyer email au client si email disponible
  if (event.client_email && outcome.mode !== 'wait') {
    const editorUrl = `${APP_URL}/e/${event.access_code}`;
    const sender = await orgSender(db, access.orgId);
    const clientName = event.client_name ?? 'Client';
    const frameLabel = reviewFrameLabel(design, frameChoiceConfig(event.form_config).enabled);
    const summary = outcome.mode === 'summary';
    // Lien « Suivre ma réservation » : null sans demande ni booking (jamais d'exception).
    const trackingUrl = await clientTrackingUrl(db, event.id);
    const sentEmail = isHome
      ? await sendClientReviewEmail(event.client_email, reviewAction === 'approve'
        ? renderHomeApprovalEmail({ clientName, eventName: event.name, trackingUrl })
        : renderHomeRejectionEmail({ clientName, eventName: event.name, editorUrl, feedback: feedback!, trackingUrl }), sender)
      : summary
      ? await sendClientReviewEmail(event.client_email,
        renderFramesReviewEmail({ clientName, eventName: event.name, editorUrl, frames, trackingUrl }), sender)
      : reviewAction === 'approve'
      ? await sendApprovalEmail({
        to:         event.client_email,
        clientName: event.client_name ?? 'Client',
        eventName:  event.name,
        frameLabel,
        sender,
        trackingUrl,
      })
      : await sendRejectionEmail({
        to:         event.client_email,
        clientName: event.client_name ?? 'Client',
        eventName:  event.name,
        editorUrl,
        feedback:   feedback!,
        frameLabel,
        sender,
        trackingUrl,
      });
    const logAction: ReviewAction = summary ? (allFramesApproved(frames) ? 'approve' : 'reject') : reviewAction;
    await recordEmailLog(db, {
      scope: { eventId: event.id }, recipient: event.client_email,
      type: reviewEmailLogType(design.kind, logAction), ...sentEmail,
    });
    if (sentEmail.error) {
      return corsResponse(BREVO_REFUSED_STATUS, {
        ...brevoRefusedBody(
          `${reviewMessage(design.kind, reviewAction)}, mais l'email au client`,
          sentEmail.error,
          'Prévenez le client directement.',
        ),
        reviewed: true,
      });
    }
  }

  return corsResponse(200, {
    message:         reviewMessage(design.kind, reviewAction),
    client_notified: Boolean(event.client_email) && outcome.mode !== 'wait',
    pending_frames:  outcome.pending,
  });
});
