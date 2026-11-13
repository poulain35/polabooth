/**
 * POST /functions/v1/send-kiosk-photo
 *
 * Envoie la photo capturée par le kiosk à l'adresse email saisie par le visiteur.
 * Appelé depuis le kiosk avec la clé anon (pas d'authentification utilisateur).
 * Refusé si l'événement n'est pas actif ou si la photo n'a pas de ligne `photos` dans cet événement
 * (montage envoyé sur R2 puis enregistré par kiosk_record_photo, LAB-213) — voir _shared/kiosk-photo.ts.
 * Un envoi accepté par Brevo est compté dans event_activity ('kiosk_email', sans l'adresse, LAB-232).
 * GIF et boomerang (LAB-235) : affiche + bouton « Voir mon animation » vers la galerie, sans pièce jointe.
 *
 * Body: { "event_id": "uuid", "to": "email@example.com", "photo_url": "https://..." }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { EmailSendError, sendHtmlEmail } from '../_shared/email.ts';
import { renderKioskPhotoEmail } from '../_shared/saas-emails.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { isActiveEventStatus, kioskEmailMedia, verifyKioskPhoto } from '../_shared/kiosk-photo.ts';
import { sendKioskEmailAndCount } from '../_shared/event-activity.ts';
import { getOrgIdentity, identityDefaults } from '../_shared/org-identity.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
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
    .select('id, org_id, name, status, access_code, form_config')
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

  if (!(await serviceSecret('BREVO_API_KEY'))) {
    console.warn('BREVO_API_KEY non configurée — email non envoyé');
    return corsResponse(200, { message: 'Email simulé (BREVO_API_KEY manquante)' });
  }

  const subject     = (emailCfg.subject || 'Vos photos — {event_name}')
    .replace('{event_name}', event.name);
  // Identité de l'entreprise (Paramètres → Entreprise) : signature du message par défaut et expéditeur
  // (celui de l'événement, sinon celui de l'entreprise, sinon son nom avec l'adresse FROM_EMAIL).
  const identity = await getOrgIdentity(db, event.org_id, { ...identityDefaults(), senderName: '' });
  const message     = (emailCfg.message || `Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\n${identity.companyName}`.trimEnd())
    .replace('{event_name}', event.name)
    .replace('{photo_url}', photo_url);

  const media = kioskEmailMedia({ photo: photoCheck.photo, photoUrl: photo_url, appUrl: APP_URL, accessCode: event.access_code });
  const htmlBody = renderKioskPhotoEmail({ eventName: event.name, photoUrl: photo_url, message, media });

  const sender = {
    email: emailCfg.sender_email || identity.senderEmail,
    name:  emailCfg.sender_name  || identity.senderName || identity.companyName,
  };

  try {
    await sendKioskEmailAndCount(db, event.id, () =>
      sendHtmlEmail({ to, subject, html: htmlBody, sender }));
  } catch (e) {
    if (e instanceof EmailSendError) return corsResponse(502, { error: `Erreur Brevo : ${e.status}` });
    throw e;
  }

  return corsResponse(200, { message: 'Email envoyé avec succès' });
});
