import { inlineAttachments } from './email-attachments.ts';
import { deliveryAttachmentName, type DeliveryLink } from './delivery-links.ts';
import { applyEmailGuard, parseEmailGuardConfig, renderTemplateSubject } from './email-guard.ts';
// Rendu HTML (gabarit de marque, LAB-82) séparé de l'envoi pour être testé sous `node --test`.
import {
  renderAccessCodeEmail, renderApprovalEmail, renderDeliveryEmail, renderDesignReminderEmail, renderEventReportEmail,
  renderKioskAlertEmail, renderRejectionEmail, renderSubmitNotificationEmail, renderSupportNotificationEmail,
} from './saas-emails.ts';
import { identityDefaults } from './org-identity.ts';
import { applyEmailBrand, instanceBrandLoader } from './email-brand.ts';
import { appUrl } from './app-url.ts';
import { serviceSecret } from './service-secrets.ts';
import { resolveEmailProvider, type EmailProvider } from './email-provider.ts';
import { describeSmtpError, sendSmtp, smtpConfigFromEnv, smtpMessageFromPayload } from './smtp.ts';

// Clé Brevo : Paramètres > Clés, sinon secret BREVO_API_KEY (lot L6b), lue à chaque envoi (cache 60 s).
const brevoKey = () => serviceSecret('BREVO_API_KEY');
// Fournisseur (lot S2) : EMAIL_PROVIDER, sinon Brevo (SMTP s'il n'y a pas de clé Brevo et que SMTP_HOST est défini).
const emailProvider = () => resolveEmailProvider(brevoKey);
// Expéditeur par défaut (FROM_EMAIL / FROM_NAME) : celui des emails sans `sender`. Les fonctions passent
// l'expéditeur de l'organisation (Paramètres → Entreprise, _shared/org-identity.ts), qui y retombe s'il est vide.
const { senderEmail: FROM_EMAIL, senderName: FROM_NAME } = identityDefaults();
const APP_URL    = appUrl();
// Marque des emails (Paramètres → Entreprise, lot L7) : remplit les marqueurs du gabarit à l'envoi.
const instanceBrand = instanceBrandLoader();
const EMAIL_GUARD = parseEmailGuardConfig((k) => Deno.env.get(k));

/**
 * Pièce jointe Brevo : soit un fichier accessible par URL ({ url, name? }),
 * soit un contenu inline base64 ({ content, name }).
 */
export type BrevoAttachment =
  | { url: string; name?: string }
  | { content: string; name: string };

export interface EmailSender {
  email: string;
  name: string;
}

/**
 * Échec de l'envoi (Brevo : réponse non 2xx ; SMTP : erreur du serveur ou de connexion, `status` =
 * code de réponse SMTP, 0 sans réponse). Levée par sendBookingEmail pour que l'appelant ne trace pas
 * un email « sent » dans email_logs : les passes idempotentes (relances, rappels de créneaux) le
 * renverront au passage suivant.
 */
export class EmailSendError extends Error {
  readonly status: number;
  constructor(status: number, detail: string, provider: EmailProvider = 'brevo') {
    const head = provider === 'smtp' ? (status ? `SMTP ${status}` : 'SMTP') : `Brevo ${status}`;
    super(`${head} : ${detail.slice(0, 300)}`);
    this.name = 'EmailSendError';
    this.status = status;
  }
}

const templateSubjects = new Map<number, string | null>();

/** Objet d'un template Brevo (GET /v3/smtp/templates/{id}), mis en cache ; null si indisponible. */
async function fetchTemplateSubject(templateId: number, params: Record<string, unknown>): Promise<string | null> {
  if (!templateSubjects.has(templateId)) {
    let subject: string | null = null;
    try {
      const res = await fetch(`https://api.brevo.com/v3/smtp/templates/${templateId}`, {
        headers: { 'api-key': (await brevoKey()) ?? '', Accept: 'application/json' },
      });
      if (res.ok) subject = ((await res.json())?.subject as string) ?? null;
      else console.warn(`Objet du template Brevo ${templateId} indisponible (${res.status})`);
    } catch (e) {
      console.warn(`Objet du template Brevo ${templateId} indisponible :`, e);
    }
    templateSubjects.set(templateId, subject);
  }
  const subject = templateSubjects.get(templateId);
  return subject == null ? null : renderTemplateSubject(subject, params);
}

/**
 * Envoi par le fournisseur (`provider`, choisi avant de construire le payload : un modèle Brevo
 * n'existe pas en SMTP). Retourne le messageId (ou null si BREVO_API_KEY / SMTP_HOST absent :
 * environnement de dev, rien n'est envoyé ; idem si le garde-fou EMAIL_ALLOWLIST bloque un destinataire).
 * Marque, pièces jointes et garde-fou s'appliquent de la même façon aux deux fournisseurs.
 * Lève EmailSendError si l'envoi est refusé.
 */
async function postEmail(provider: EmailProvider, payload: Record<string, unknown>, label: string): Promise<string | null> {
  if (provider === 'smtp') return await postSmtp(payload, label);
  return await postBrevo(payload, label);
}

async function prepare(payload: Record<string, unknown>, provider: EmailProvider) {
  if (typeof payload.htmlContent === 'string') {
    payload = { ...payload, htmlContent: applyEmailBrand(payload.htmlContent, await instanceBrand()) };
  }
  if (Array.isArray(payload.attachment)) {
    const attachment = await inlineAttachments(payload.attachment as BrevoAttachment[], fetch);
    payload = { ...payload, attachment: attachment.length ? attachment : undefined };
  }
  // Objet d'un modèle : Brevo seulement (en SMTP, le payload est toujours HTML, avec son objet).
  const guarded = await applyEmailGuard(payload, EMAIL_GUARD, provider === 'brevo' ? fetchTemplateSubject : undefined);
  if (guarded.action === 'block') {
    console.warn(`EMAIL_ALLOWLIST : destinataire(s) hors liste, email non envoyé — ${guarded.blocked.join(', ')}`);
    return null;
  }
  return guarded.payload;
}

async function postSmtp(payload: Record<string, unknown>, label: string): Promise<string | null> {
  const config = smtpConfigFromEnv();
  if (!config) {
    console.warn('SMTP_HOST non configuré — email non envoyé');
    return null;
  }
  const ready = await prepare(payload, 'smtp');
  if (!ready) return null;
  try {
    return await sendSmtp(config, smtpMessageFromPayload(ready));
  } catch (e) {
    const { status, detail } = describeSmtpError(e);
    console.error(`Erreur SMTP${label}:`, detail);
    throw new EmailSendError(status, detail, 'smtp');
  }
}

/** POST Brevo (inchangé par S2 : même payload, mêmes en-têtes). */
async function postBrevo(payload: Record<string, unknown>, label: string): Promise<string | null> {
  const apiKey = await brevoKey();
  if (!apiKey) {
    console.warn('BREVO_API_KEY non configurée — email non envoyé');
    return null;
  }
  const ready = await prepare(payload, 'brevo');
  if (!ready) return null;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ready),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`Erreur Brevo${label}:`, err);
    throw new EmailSendError(res.status, err);
  }
  const data = await res.json().catch(() => null);
  return (data?.messageId as string) ?? null;
}

function htmlPayload(
  to: string, subject: string, html: string, attachment?: BrevoAttachment[], sender?: EmailSender,
  headers?: Record<string, string>,
) {
  const payload: Record<string, unknown> = {
    sender:      sender ?? { email: FROM_EMAIL, name: FROM_NAME },
    to:          [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachment?.length) payload.attachment = attachment;
  if (headers && Object.keys(headers).length) payload.headers = headers;
  return payload;
}

function templatePayload(to: string, templateId: number, params: Record<string, string>, attachment?: BrevoAttachment[], sender?: EmailSender) {
  const payload: Record<string, unknown> = {
    sender:     sender ?? { email: FROM_EMAIL, name: FROM_NAME },
    to:         [{ email: to }],
    templateId,
    params,
  };
  if (attachment?.length) payload.attachment = attachment;
  return payload;
}

/** Échec Brevo → null (emails historiques : l'appelant ne distingue pas l'échec). */
async function swallowBrevoError(p: Promise<string | null>): Promise<string | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof EmailSendError) return null;
    throw e;
  }
}

/**
 * Résultat d'un email client journalisé dans email_logs (LAB-123) : l'objet est tracé, et un refus
 * Brevo est rendu (error) au lieu d'être avalé, pour écrire une ligne au statut « error ».
 * messageId null sans error : BREVO_API_KEY absente ou garde-fou EMAIL_ALLOWLIST (rien d'envoyé).
 */
export interface SentEmail {
  messageId: string | null;
  subject: string;
  error: string | null;
}

async function settle(subject: string, p: Promise<string | null>): Promise<SentEmail> {
  try {
    return { messageId: await p, subject, error: null };
  } catch (e) {
    if (e instanceof EmailSendError) return { messageId: null, subject, error: e.message };
    throw e;
  }
}

/** Email HTML, par le fournisseur configuré. */
async function postHtml(
  to: string, subject: string, html: string, attachment?: BrevoAttachment[], sender?: EmailSender,
  headers?: Record<string, string>,
): Promise<string | null> {
  return await postEmail(await emailProvider(), htmlPayload(to, subject, html, attachment, sender, headers), '');
}

/**
 * Modèle Brevo s'il est configuré et que le fournisseur est Brevo, sinon le HTML de l'app (en SMTP,
 * les modèles Brevo sont ignorés).
 */
async function postTemplateOrHtml(
  templateId: number | null | undefined,
  to: string,
  rendered: { subject: string; html: string; headers?: Record<string, string> },
  params: Record<string, string>,
  sender?: EmailSender,
  attachment?: BrevoAttachment[],
): Promise<string | null> {
  const provider = await emailProvider();
  if (templateId && provider === 'brevo') {
    return await postEmail(provider, templatePayload(to, templateId, params, attachment, sender), ' (template)');
  }
  return await postEmail(provider, htmlPayload(to, rendered.subject, rendered.html, attachment, sender, rendered.headers), '');
}

const sendClientHtml = (to: string, subject: string, html: string, attachment?: BrevoAttachment[], sender?: EmailSender) =>
  settle(subject, postHtml(to, subject, html, attachment, sender));

// Objet tracé = objet rendu par l'app : celui d'un template Brevo configuré peut différer.
const sendClientTemplate = (
  to: string, rendered: { subject: string; html: string }, templateId: number | undefined, params: Record<string, string>,
  sender?: EmailSender,
) => settle(rendered.subject, postTemplateOrHtml(templateId, to, { subject: rendered.subject, html: rendered.html }, params, sender));

/** Envoie un email par le fournisseur configuré. Retourne le messageId (ou null, échec compris). */
function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachment?: BrevoAttachment[],
  sender?: EmailSender,
): Promise<string | null> {
  return swallowBrevoError(postHtml(to, subject, html, attachment, sender));
}

/** Email HTML brut (ex. photo kiosk). Lève EmailSendError si l'envoi est refusé. */
export function sendHtmlEmail(params: { to: string; subject: string; html: string; sender?: EmailSender }): Promise<string | null> {
  return postHtml(params.to, params.subject, params.html, undefined, params.sender);
}

/** Email envoyé au client avec son code d'accès. */
export async function sendAccessCodeEmail(params: {
  to: string;
  clientName: string;
  eventName: string;
  accessCode: string;
  expiresAt?: string;
  templateId?: number;
  sender?: EmailSender;
}): Promise<SentEmail> {
  const { to, clientName, eventName, accessCode, expiresAt, templateId, sender } = params;
  const editorUrl = `${APP_URL}/e/${accessCode}`;
  const rendered = renderAccessCodeEmail({ clientName, eventName, accessCode, editorUrl, expiresAt });

  return await sendClientTemplate(to, rendered, templateId, {
    CLIENT_NAME:  clientName,
    EVENT_NAME:   eventName,
    ACCESS_CODE:  accessCode,
    EDITOR_URL:   editorUrl,
    EXPIRES_DATE: expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : '',
  }, sender);
}

/** Email client : template approuvé. */
export async function sendApprovalEmail(params: {
  to: string;
  clientName: string;
  eventName: string;
  sender?: EmailSender;
}): Promise<SentEmail> {
  const { subject, html } = renderApprovalEmail(params);
  return await sendClientHtml(params.to, subject, html, undefined, params.sender);
}

/** Email client : template refusé avec retour. */
export async function sendRejectionEmail(params: {
  to: string;
  clientName: string;
  eventName: string;
  editorUrl: string;
  feedback: string;
  sender?: EmailSender;
}): Promise<SentEmail> {
  const { subject, html } = renderRejectionEmail(params);
  return await sendClientHtml(params.to, subject, html, undefined, params.sender);
}

/** Alerte de monitoring parc kiosk (machine hors ligne, imprimante, quota). */
export async function sendKioskAlertEmail(params: {
  to: string;
  subject: string;
  heading: string;
  eventName: string;
  machineName: string;
  detail: string;
  adminUrl: string;
  color?: string;
  sender?: EmailSender;
}) {
  const { subject, html } = renderKioskAlertEmail(params);
  await sendEmail(params.to, subject, html, undefined, params.sender);
}

/** Notification au loueur quand l'assistant de dépannage n'a pas résolu un problème client. */
export async function sendSupportNotificationEmail(params: {
  to: string;
  eventName: string;
  clientName: string;
  clientPhone: string;
  message: string;
  urgency: string; // 'blocking' | 'normal'
  sender?: EmailSender;
}) {
  const { subject, html } = renderSupportNotificationEmail(params);
  await sendEmail(params.to, subject, html, undefined, params.sender);
}

/** Relance client : le design du template n'a pas encore été soumis. */
export async function sendDesignReminderEmail(params: {
  to: string;
  clientName: string;
  eventName: string;
  accessCode: string;
  daysLeft: number;
  templateId?: number;
  sender?: EmailSender;
}): Promise<SentEmail> {
  const { to, clientName, eventName, accessCode, daysLeft, templateId, sender } = params;
  const editorUrl = `${APP_URL}/e/${accessCode}`;
  const rendered = renderDesignReminderEmail({ clientName, eventName, accessCode, editorUrl, daysLeft });

  return await sendClientTemplate(to, rendered, templateId, {
    CLIENT_NAME: clientName,
    EVENT_NAME:  eventName,
    ACCESS_CODE: accessCode,
    EDITOR_URL:  editorUrl,
    DAYS_LEFT:   String(daysLeft),
  }, sender);
}

/** Notification admin quand un client soumet son template. */
export async function sendSubmitNotificationEmail(params: {
  to: string;
  eventName: string;
  clientName: string;
  adminUrl: string;
  sender?: EmailSender;
}) {
  const { subject, html } = renderSubmitNotificationEmail(params);
  await sendEmail(params.to, subject, html, undefined, params.sender);
}

/**
 * Email de livraison post-événement : photos (galerie externe), livre d'or audio,
 * demande d'avis Google, et facture en pièce jointe (si fournie).
 */
export async function sendDeliveryEmail(params: {
  to: string;
  clientName: string;
  eventName: string;
  companyName: string;
  photoGalleryUrl: string;
  /** Liens validés par deliveryLinks (_shared/delivery-links.ts). */
  links?: ReadonlyArray<DeliveryLink>;
  reviewUrl?: string;
  /** Document joint (events.delivery_attachment_url). */
  attachmentUrl?: string;
  sender?: EmailSender;
}): Promise<SentEmail> {
  const { to, clientName, eventName, companyName, photoGalleryUrl, links, reviewUrl, attachmentUrl, sender } = params;
  const attachment = attachmentUrl ? [{ url: attachmentUrl, name: deliveryAttachmentName(attachmentUrl) }] : undefined;
  const { subject, html } = renderDeliveryEmail({
    clientName, eventName, brand: companyName || FROM_NAME, photoGalleryUrl, links, reviewUrl, hasAttachment: !!attachmentUrl,
  });
  return await sendClientHtml(to, subject, html, attachment, sender);
}

/** Email client du bilan d'événement (LAB-238) : lien /rapport/{token}, aucun chiffre. */
export async function sendEventReportEmail(params: {
  to: string;
  clientName: string;
  eventName: string;
  companyName: string;
  reportUrl: string;
  expiresAt?: string | null;
  sender?: EmailSender;
}): Promise<SentEmail> {
  const { to, clientName, eventName, companyName, reportUrl, expiresAt, sender } = params;
  const { subject, html } = renderEventReportEmail({ clientName, eventName, brand: companyName || FROM_NAME, reportUrl, expiresAt });
  return await sendClientHtml(to, subject, html, undefined, sender);
}

/**
 * Emails de la réservation en ligne (spec reservation-facturation §5.7) : contenu rendu par
 * _shared/modules/booking/booking-emails.ts, template Brevo si booking_config.brevo_template_ids.<clé> est renseigné
 * et que le fournisseur est Brevo.
 *
 * Lève EmailSendError si l'envoi est refusé : l'appel logEmail qui suit n'est alors pas exécuté,
 * aucune ligne « sent » n'est écrite dans email_logs et les passes idempotentes réessaient.
 */
export async function sendBookingEmail(params: {
  to: string;
  rendered: { subject: string; html: string; params: Record<string, string> };
  templateId: number | null;
  sender?: EmailSender;
  /** PDF du devis ou de la facture (URL fraîche du logiciel de facturation, téléchargée puis envoyée en base64 à l'envoi). */
  attachment?: BrevoAttachment[];
  /** En-têtes ajoutés à l'email HTML (ex. List-Unsubscribe de la relance des prospects). */
  headers?: Record<string, string>;
}): Promise<string | null> {
  const { to, rendered, templateId, sender, attachment, headers } = params;
  return await postTemplateOrHtml(templateId, to, { subject: rendered.subject, html: rendered.html, headers }, rendered.params, sender, attachment);
}
