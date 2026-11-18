// Email client « pensez à télécharger vos souvenirs » (LAB-212). Rendu pur, testé sous `node --test`.

import { buttonRow, escapeHtml, layout, mutedNote, trackingLine } from '../_shared/email-layout.ts';

const longDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

export function renderMediaExpiryReminderEmail(p: {
  clientName: string | null;
  eventName: string | null;
  expiresAt: string;
  photosUrl?: string;
  audioUrl?: string;
  /** Lien « Suivre ma réservation » (clientTrackingUrl) ; absent = email d'avant. */
  trackingUrl?: string | null;
}): { subject: string; html: string } {
  const eventName = (p.eventName ?? '').trim();
  const clientName = (p.clientName ?? '').trim();
  const what = p.photosUrl && p.audioUrl
    ? 'Les photos et les messages du livre d\'or audio'
    : p.photosUrl ? 'Les photos' : 'Les messages du livre d\'or audio';
  const ofEvent = eventName ? `de votre événement <strong>${escapeHtml(eventName)}</strong>` : 'de votre événement';
  const buttons = [
    ...(p.photosUrl ? [{ url: p.photosUrl, label: '📷 Télécharger les photos →' }] : []),
    ...(p.audioUrl ? [{ url: p.audioUrl, label: '🎙️ Télécharger le livre d\'or audio →' }] : []),
  ];
  return {
    subject: `⏳ Pensez à télécharger vos souvenirs${eventName ? ` — ${eventName}` : ''}`,
    html: layout('⏳ Pensez à télécharger vos souvenirs', `
    <p>${clientName ? `Bonjour <strong>${escapeHtml(clientName)}</strong>,` : 'Bonjour,'}</p>
    <p>${what} ${ofEvent} sont toujours en ligne, et le lien expire le <strong>${escapeHtml(longDate.format(new Date(p.expiresAt)))}</strong>.</p>
    <p style="margin:0;">Après cette date, vous ne pourrez plus y accéder et les fichiers seront supprimés de nos serveurs. Pensez à tout télécharger dès maintenant pour garder vos souvenirs.</p>
    ${buttons.map((b) => buttonRow([b])).join('')}
    ${mutedNote('Le bouton « Tout télécharger » de la galerie récupère tous les fichiers en une seule fois.', '0')}${trackingLine(p.trackingUrl)}`),
  };
}
