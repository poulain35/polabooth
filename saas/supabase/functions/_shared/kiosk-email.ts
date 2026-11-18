// Email de la photo envoyé par la borne (LAB-300) : objet, HTML et expéditeur, construits à partir de
// l'événement, de form_config.kiosk.email et de form_config.branding. Partagé par send-kiosk-photo
// (envoi réel) et kiosk-email-preview (aperçu, email de test) : l'aperçu est l'email envoyé.
// Pur (sans Deno ni réseau) : testé sous `node --test`.

import { renderKioskPhotoEmail } from './saas-emails.ts';
import { kioskEmailMedia, type KioskPhotoRow } from './kiosk-photo.ts';
import {
  eventTheme, fillVariables, formatEventDate, readBranding, TEXT_LIMITS, truncate, type EmailVariable,
} from './event-branding.ts';

export const DEFAULT_KIOSK_SUBJECT = 'Vos photos — {event_name}';

/** Message par défaut (D5), signé du nom du loueur. */
export function defaultKioskMessage(companyName: string): string {
  return `Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\n${companyName}`.trimEnd();
}

export interface KioskEmailEvent {
  name: string;
  access_code?: string | null;
  start_date?: string | null;
  client_name?: string | null;
}

export interface KioskEmailInput {
  event: KioskEmailEvent;
  /** form_config.kiosk.email (ou le brouillon de l'admin). */
  email: Record<string, unknown> | null | undefined;
  /** form_config.branding brut : vérifié ici. */
  branding: unknown;
  identity: { companyName: string; senderName: string; senderEmail: string };
  photo: KioskPhotoRow | null;
  photoUrl: string;
  appUrl?: string | null;
}

export interface KioskEmail {
  subject: string;
  html: string;
  sender: { email: string; name: string };
}

type CustomField = 'subject' | 'title' | 'message' | 'button_label';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function buildKioskEmail(p: KioskEmailInput): KioskEmail {
  const email = p.email ?? {};
  const values: Record<EmailVariable, string> = {
    event_name: p.event.name,
    event_date: formatEventDate(p.event.start_date),
    client_name: text(p.event.client_name),
    company_name: p.identity.companyName,
    photo_url: p.photoUrl,
  };
  // Champ saisi : variables remplacées puis coupé ; vide (ou blanc) : undefined, défaut d'aujourd'hui.
  const custom = (key: CustomField): string | undefined => {
    const v = text(email[key]);
    return v.trim() ? truncate(fillVariables(v, values), TEXT_LIMITS[key].server) : undefined;
  };
  const branding = readBranding(p.branding);
  const media = kioskEmailMedia({ photo: p.photo, photoUrl: p.photoUrl, appUrl: p.appUrl, accessCode: p.event.access_code });
  const html = renderKioskPhotoEmail({
    eventName: p.event.name,
    photoUrl: p.photoUrl,
    message: custom('message') ?? defaultKioskMessage(p.identity.companyName),
    media,
    title: custom('title'),
    buttonLabel: custom('button_label'),
    theme: eventTheme(branding.color),
    logoUrl: branding.logoUrl,
  });
  return {
    subject: custom('subject') ?? fillVariables(DEFAULT_KIOSK_SUBJECT, values),
    html,
    // Expéditeur de l'événement, puis de l'entreprise, puis son nom (adresse FROM_EMAIL en dernier recours).
    sender: {
      email: text(email.sender_email) || p.identity.senderEmail,
      name: text(email.sender_name) || p.identity.senderName || p.identity.companyName,
    },
  };
}

// ── Aperçu (kiosk-email-preview) ─────────────────────────────────────────────────────────────

export type PreviewMedia = 'photo' | 'animation';

/** Cadre gris « Votre photo ici » quand l'événement n'a ni photo ni design validé. */
export const PREVIEW_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="536" height="402" viewBox="0 0 536 402">'
  + '<rect width="536" height="402" fill="#e5e5e5"/>'
  + '<text x="268" y="210" font-family="Arial, sans-serif" font-size="24" fill="#6b6b6b" text-anchor="middle">Votre photo ici</text></svg>',
)}`;

/**
 * Média de l'aperçu : la dernière photo (ou animation) de l'événement, sinon le PNG du design validé,
 * sinon le cadre gris. Une animation sans exemple montre l'image en affiche.
 */
export function previewSample(p: {
  media: PreviewMedia;
  sample: { id: string | null; photo_url: string; thumbnail_url: string | null; media_type: string } | null;
  designUrl: string | null;
}): { photo: KioskPhotoRow; photoUrl: string } {
  if (p.sample) {
    return {
      photo: { id: p.sample.id, media_type: p.sample.media_type, thumbnail_url: p.sample.thumbnail_url },
      photoUrl: p.sample.photo_url,
    };
  }
  const image = p.designUrl ?? PREVIEW_PLACEHOLDER;
  return {
    photo: p.media === 'animation'
      ? { id: null, media_type: 'gif', thumbnail_url: image }
      : { id: null, media_type: 'photo', thumbnail_url: null },
    photoUrl: image,
  };
}

/** Objet de l'email de test. */
export function testSubject(subject: string): string {
  return `[Test] ${subject}`;
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Brouillon de l'admin par-dessus les réglages enregistrés (champ absent du brouillon : valeur enregistrée). */
export function mergeDraft(stored: unknown, draft: unknown): Record<string, unknown> {
  return { ...record(stored), ...record(draft) };
}

export interface PreviewRequest {
  eventId: string;
  action: 'preview' | 'test';
  media: PreviewMedia;
  draft: { email: unknown; branding: unknown };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps de kiosk-email-preview : `{ event_id, action, media?, draft? }`, ou un message d'erreur. */
export function parsePreviewRequest(body: unknown): PreviewRequest | { error: string } {
  const b = record(body);
  if (typeof b.event_id !== 'string' || !UUID.test(b.event_id)) return { error: 'event_id requis' };
  if (b.action !== 'preview' && b.action !== 'test') return { error: "action attendue : 'preview' ou 'test'" };
  const draft = record(b.draft);
  return {
    eventId: b.event_id,
    action: b.action,
    media: b.media === 'animation' ? 'animation' : 'photo',
    draft: { email: draft.email, branding: draft.branding },
  };
}
