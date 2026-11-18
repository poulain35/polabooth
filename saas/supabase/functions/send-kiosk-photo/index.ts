/**
 * POST /functions/v1/send-kiosk-photo
 *
 * Envoie la photo capturée par le kiosk à l'adresse email saisie par le visiteur.
 * Appelé depuis le kiosk avec la clé anon (pas d'authentification utilisateur).
 * Refusé si l'événement n'est pas actif ou si la photo n'a pas de ligne `photos` dans cet événement
 * (montage envoyé sur R2 puis enregistré par kiosk_record_photo, LAB-213) — voir _shared/kiosk-photo.ts.
 * Un envoi accepté (Brevo ou SMTP) est compté dans event_activity ('kiosk_email', sans l'adresse, LAB-232).
 * GIF et boomerang (LAB-235) : affiche + bouton « Voir mon animation » vers la galerie, sans pièce jointe.
 * Objet, titre, message, bouton, couleur et logo de l'événement (LAB-300) : _shared/kiosk-email.ts,
 * le même module que l'aperçu de l'admin (kiosk-email-preview). Aucun fournisseur configuré : « simulé ».
 *
 * Body: { "event_id": "uuid", "to": "email@example.com", "photo_url": "https://..." }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { EmailSendError, sendHtmlEmail } from '../_shared/email.ts';
import { buildKioskEmail } from '../_shared/kiosk-email.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { isActiveEventStatus, verifyKioskPhoto } from '../_shared/kiosk-photo.ts';
import { sendKioskEmailAndCount } from '../_shared/event-activity.ts';
import { getOrgIdentity, identityDefaults } from '../_shared/org-identity.ts';
import { publicAppUrl } from '../_shared/app-url.ts';

const APP_URL = publicAppUrl();

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { event_id, to, photo_url } = body as {
    event_id?: string;
    to?: string;
    photo_url?: string;
  };

  if (!event_id || !to || !photo_url)
    return corsResponse(400, { error: 'Paramètres manquants : event_id, to, photo_url' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    return corsResponse(400, { error: 'Adresse email invalide' });

  const db = adminClient();
  const guard = publicGuard('send-kiosk-photo', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([
    [LIMITS.kioskEmailIp, guard.ip],
    [LIMITS.kioskEmailTo, to.trim().toLowerCase()],
    [LIMITS.kioskEmailEvent, event_id],
  ]);
  if (limited) return limited;

  const { data: event, error: evErr } = await db
    .from('events')
    .select('id, org_id, name, status, access_code, start_date, client_name, form_config')
    .eq('id', event_id)
    .single();

  if (evErr || !event) return corsResponse(404, { error: 'Événement introuvable' });
  if (!isActiveEventStatus(event.status)) {
    return corsResponse(403, { error: "Cet événement n'est pas actif" });
  }

  const photoCheck = await verifyKioskPhoto({ db, eventId: event.id, photoUrl: photo_url });
  if (!photoCheck.ok) return corsResponse(photoCheck.status, { error: photoCheck.error });

  const emailCfg = event.form_config?.kiosk?.email ?? {};
  if (emailCfg.enabled === false) {
    return corsResponse(403, { error: 'Envoi par email désactivé pour cet événement' });
  }

  // Identité de l'entreprise (Paramètres → Entreprise) : signature du message par défaut et expéditeur.
  const identity = await getOrgIdentity(db, event.org_id, { ...identityDefaults(), senderName: '' });
  const { subject, html, sender } = buildKioskEmail({
    event, email: emailCfg, branding: event.form_config?.branding, identity,
    photo: photoCheck.photo, photoUrl: photo_url, appUrl: APP_URL,
  });

  let messageId: string | null;
  try {
    messageId = await sendKioskEmailAndCount(db, event.id, () =>
      sendHtmlEmail({ to, subject, html, sender }));
  } catch (e) {
    if (e instanceof EmailSendError) return corsResponse(502, { error: `Erreur d'envoi : ${e.status}` });
    throw e;
  }
  // Aucun fournisseur (ni clé Brevo ni SMTP) ou destinataire hors EMAIL_ALLOWLIST : rien n'est parti (D14).
  if (!messageId) return corsResponse(200, { message: 'Email simulé (aucun envoi)' });

  return corsResponse(200, { message: 'Email envoyé avec succès' });
});
