// Contenu des emails HTML de l'éditeur et du parc kiosk (accès, validation des cadres, relances,
// livraison, alertes admin), au gabarit de marque (LAB-82). Rendu pur (sans Deno ni réseau) pour
// être testé sous `node --test` ; l'envoi (et le choix d'un template Brevo) reste dans _shared/email.ts.
// Toute donnée saisie (client, événement, message) est échappée.

import {
  BRAND_MARKS,
  BRAND, button, buttonRow, codeBox, detailsTable, escapeHtml, layout, mutedNote, panel, smallText, softBox,
  textLink, trackingLine, type Tone,
} from './email-layout.ts';

export interface HtmlEmail {
  subject: string;
  html: string;
}

/** Email client avec son code d'accès à l'éditeur. */
export function renderAccessCodeEmail(p: {
  clientName: string;
  eventName: string;
  accessCode: string;
  editorUrl: string;
  expiresAt?: string;
  /** Lien « Suivre ma réservation » (clientTrackingUrl) ; absent = email d'avant. */
  trackingUrl?: string | null;
}): HtmlEmail {
  const expiry = p.expiresAt
    ? mutedNote(`Ce lien est valable jusqu'au ${new Date(p.expiresAt).toLocaleDateString('fr-FR')}.`, '0')
    : '';
  return {
    subject: `Votre accès à l'éditeur photobooth — ${p.eventName}`,
    html: layout('🎉 Votre cadre photobooth', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Votre espace de création pour l'événement <strong>${escapeHtml(p.eventName)}</strong> est prêt !</p>
    <p style="margin:24px 0 0;">Votre code d'accès personnel :</p>
    ${codeBox(p.accessCode)}
    ${button(p.editorUrl, 'Ouvrir l\'éditeur →')}
    ${expiry}${trackingLine(p.trackingUrl)}`),
  };
}

/** Nom du cadre cité dans les emails de revue (LAB-312), entre guillemets ; vide sans nom. */
function framePart(frameLabel: string | null | undefined, html: boolean): string {
  if (!frameLabel) return '';
  return ` « ${html ? escapeHtml(frameLabel) : frameLabel} »`;
}

/** Email client : cadre validé. `frameLabel` : nom du cadre, quand l'événement en a plusieurs. */
export function renderApprovalEmail(p: {
  clientName: string;
  eventName: string;
  frameLabel?: string | null;
  trackingUrl?: string | null;
}): HtmlEmail {
  return {
    subject: `✅ Votre cadre${framePart(p.frameLabel, false)} a été validé — ${p.eventName}`,
    html: layout('✅ Cadre validé !', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Votre cadre photobooth${framePart(p.frameLabel, true)} pour l'événement <strong>${escapeHtml(p.eventName)}</strong> a été validé par notre équipe. 🎉</p>
    <p style="margin:0;">Tout est prêt pour le jour J. Vous n'avez rien d'autre à faire.</p>${trackingLine(p.trackingUrl)}`),
  };
}

/** Email client : cadre refusé avec retour. `frameLabel` : nom du cadre, quand l'événement en a plusieurs. */
export function renderRejectionEmail(p: {
  clientName: string;
  eventName: string;
  editorUrl: string;
  feedback: string;
  frameLabel?: string | null;
  trackingUrl?: string | null;
}): HtmlEmail {
  return {
    subject: `🔄 Votre cadre${framePart(p.frameLabel, false)} nécessite des modifications — ${p.eventName}`,
    html: layout('🔄 Modifications demandées', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Votre cadre photobooth${framePart(p.frameLabel, true)} pour l'événement <strong>${escapeHtml(p.eventName)}</strong> nécessite quelques modifications avant validation.</p>
    ${softBox(`<strong>Retour de notre équipe :</strong><br>${escapeHtml(p.feedback)}`, { tone: 'warning', preWrap: true, margin: '20px 0 0' })}
    ${button(p.editorUrl, 'Modifier mon cadre →')}${trackingLine(p.trackingUrl)}`),
  };
}

/** Couleur d'en-tête historique des alertes kiosk (check-kiosk-alerts) → ton sémantique de la marque. */
function toneFromColor(color: string | undefined): Tone {
  switch ((color ?? '').toLowerCase()) {
    case '#ef4444': return 'danger';
    case '#f59e0b': return 'warning';
    case '#10b981': return 'success';
    default: return 'neutral';
  }
}

/**
 * Alerte de monitoring parc kiosk (admin). `detail` est du HTML construit par check-kiosk-alerts
 * (balises <strong>) : il n'est pas échappé. `color` choisit le ton de l'encadré.
 */
export function renderKioskAlertEmail(p: {
  subject: string;
  heading: string;
  eventName: string;
  machineName: string;
  detail: string;
  adminUrl: string;
  color?: string;
}): HtmlEmail {
  return {
    subject: p.subject,
    html: layout(p.heading, `
    ${softBox(p.detail, { tone: toneFromColor(p.color ?? '#ef4444'), margin: '0 0 16px' })}
    ${detailsTable([['Événement', escapeHtml(p.eventName)], ['Machine', escapeHtml(p.machineName)]])}
    ${button(p.adminUrl, 'Voir le parc kiosk →')}
    ${mutedNote(`Alerte automatique · ${BRAND_MARKS.name}`, '0')}`, { audience: 'admin' }),
  };
}

/** Notification au loueur quand l'assistant de dépannage n'a pas résolu un problème client (admin). */
export function renderSupportNotificationEmail(p: {
  eventName: string;
  clientName: string;
  clientPhone: string;
  message: string;
  urgency: string;
}): HtmlEmail {
  const blocking = p.urgency === 'blocking';
  const heading = blocking ? '🚨 Photobooth bloqué — client à rappeler' : '💬 Message d\'un client en location';
  const rows: Array<[string, string]> = [
    ['Événement', escapeHtml(p.eventName || '—')],
    ['Client', escapeHtml(p.clientName || '—')],
  ];
  if (p.clientPhone) rows.push(['Téléphone', textLink(`tel:${p.clientPhone}`, p.clientPhone)]);
  return {
    subject: `${blocking ? '🚨 URGENT' : '💬'} Demande d'aide — ${p.eventName || 'location'}`,
    html: layout(heading, `
    ${softBox(escapeHtml(p.message), { tone: blocking ? 'danger' : 'neutral', preWrap: true, margin: '0 0 16px' })}
    ${detailsTable(rows)}
    ${mutedNote(`Assistant de dépannage · ${BRAND_MARKS.name}`, '24px 0 0')}`, { audience: 'admin' }),
  };
}

/** Relance client : le cadre n'a pas encore été soumis. */
export function renderDesignReminderEmail(p: {
  clientName: string;
  eventName: string;
  accessCode: string;
  editorUrl: string;
  daysLeft: number;
  /** Cadres créés restant à envoyer quand d'autres sont déjà envoyés (LAB-322) ; absent = relance d'avant. */
  framesLeft?: number;
  trackingUrl?: string | null;
}): HtmlEmail {
  const hasName = p.eventName.trim().length > 0;
  const deadline = p.daysLeft > 1
    ? `Il vous reste environ <strong>${escapeHtml(p.daysLeft)} jours</strong> avant votre événement.`
    : `Votre événement approche à grands pas.`;
  if (p.framesLeft && p.framesLeft > 0) {
    const n = p.framesLeft;
    const count = n > 1 ? `${n} cadres` : '1 cadre';
    return {
      subject: `⏳ Il vous reste ${count} à envoyer${hasName ? ` — ${p.eventName}` : ''}`,
      html: layout('⏳ Vos cadres vous attendent', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Nous avons bien reçu une partie de vos cadres pour ${hasName ? `votre événement <strong>${escapeHtml(p.eventName)}</strong>` : `votre prochain événement`}, mais il vous reste <strong>${count}</strong> à envoyer.</p>
    <p>${deadline} Terminez ${n > 1 ? 'ces cadres' : 'ce cadre'} dans l'éditeur, puis cliquez sur « Envoyer mes cadres ».</p>
    <p style="margin:24px 0 0;">Votre code d'accès :</p>
    ${codeBox(p.accessCode)}
    ${button(p.editorUrl, 'Envoyer mes cadres →')}${trackingLine(p.trackingUrl)}`),
    };
  }
  return {
    subject: `⏳ Pensez à finaliser votre cadre photobooth${hasName ? ` — ${p.eventName}` : ''}`,
    html: layout('⏳ Votre cadre vous attend', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Nous n'avons pas encore reçu le cadre photobooth pour ${hasName ? `votre événement <strong>${escapeHtml(p.eventName)}</strong>` : `votre prochain événement`}.</p>
    <p>${deadline} Prenez quelques minutes pour le personnaliser et le soumettre.</p>
    <p style="margin:24px 0 0;">Votre code d'accès :</p>
    ${codeBox(p.accessCode)}
    ${button(p.editorUrl, 'Finaliser mon cadre →')}${trackingLine(p.trackingUrl)}`),
  };
}

/** Notification admin quand un client envoie son design. */
export function renderSubmitNotificationEmail(p: { eventName: string; clientName: string; adminUrl: string }): HtmlEmail {
  return {
    subject: `✅ Design envoyé — ${p.eventName}`,
    html: layout('✅ Nouveau design reçu', `
    <p style="margin:0;"><strong>${escapeHtml(p.clientName)}</strong> vient d'envoyer son design pour l'événement
    <strong>${escapeHtml(p.eventName)}</strong>.</p>
    ${button(p.adminUrl, 'Voir et télécharger →')}`, { audience: 'admin' }),
  };
}

/**
 * Email de livraison post-événement : photos (galerie externe), livre d'or audio, demande d'avis
 * Google, facture jointe. `brand` : nom commercial du profil (à défaut, FROM_NAME).
 */
export function renderDeliveryEmail(p: {
  clientName: string;
  eventName: string;
  brand: string;
  photoGalleryUrl: string;
  /** Liens fournis par les fonctionnalités (events.delivery_links, déjà validés). */
  links?: ReadonlyArray<{ label: string; url: string }>;
  reviewUrl?: string;
  hasAttachment: boolean;
  trackingUrl?: string | null;
}): HtmlEmail {
  const linkBlocks = (p.links ?? []).map((l) => button(l.url, `${l.label} →`)).join('');
  const reviewBlock = p.reviewUrl
    ? panel(`${smallText('Vous avez aimé notre prestation ? Un avis nous aide énormément 🙏', { margin: '0' })}
        ${buttonRow([{ url: p.reviewUrl, label: '⭐ Laisser un avis Google →' }], { align: 'center', margin: '16px auto 0' })}`, { align: 'center' })
    : '';
  const attachmentBlock = p.hasAttachment ? mutedNote('📎 Un document est joint à cet email.', '0') : '';
  return {
    subject: `📸 Vos souvenirs sont prêts — ${p.eventName}`,
    html: layout('📸 Vos souvenirs sont prêts !', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Merci d'avoir choisi <strong>${escapeHtml(p.brand)}</strong> pour votre événement <strong>${escapeHtml(p.eventName)}</strong> !</p>
    <p style="margin:0;">Retrouvez toutes vos photos ci-dessous :</p>
    ${button(p.photoGalleryUrl, '📷 Voir toutes les photos →')}
    ${linkBlocks}
    ${reviewBlock}
    ${attachmentBlock}${trackingLine(p.trackingUrl)}`),
  };
}

/**
 * Email client du bilan d'événement (LAB-238, spec LAB-209) : court, un bouton vers /rapport/{token}.
 * Aucun chiffre dans l'email : un chiffre envoyé ne se corrige plus, la page reste la seule source.
 */
export function renderEventReportEmail(p: {
  clientName: string;
  eventName: string;
  brand: string;
  reportUrl: string;
  expiresAt?: string | null;
  trackingUrl?: string | null;
}): HtmlEmail {
  const expiry = p.expiresAt && !Number.isNaN(new Date(p.expiresAt).getTime())
    ? mutedNote(`Ce lien est valable jusqu'au ${new Date(p.expiresAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}.`, '0')
    : '';
  return {
    subject: `Le bilan de votre événement — ${p.eventName}`,
    html: layout('Le bilan de votre événement', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Merci d'avoir choisi <strong>${escapeHtml(p.brand)}</strong> pour <strong>${escapeHtml(p.eventName)}</strong>.</p>
    <p style="margin:0;">Nous avons préparé le bilan de l'animation photobooth. Vous pouvez le consulter, l'imprimer ou le transmettre.</p>
    ${button(p.reportUrl, 'Voir le bilan de votre événement')}
    ${expiry}${trackingLine(p.trackingUrl)}`),
  };
}

/**
 * Email photo envoyé par le kiosk à un invité (send-kiosk-photo) : message configuré, bouton, aperçu.
 * LAB-235 : pour un GIF ou un boomerang (`media` donné par kioskEmailMedia, _shared/kiosk-photo.ts),
 * l'aperçu est l'affiche, cliquable, et le bouton « Voir mon animation » ouvre la galerie. Aucune
 * pièce jointe : le MP4 n'est jamais mis dans l'email.
 * Habillage (LAB-300) : titre et bouton saisis par l'admin, couleurs et logo de l'événement ; message
 * en texte brut avec `**gras**`. Sans ces options, HTML inchangé.
 */
export function renderKioskPhotoEmail(p: {
  eventName: string;
  photoUrl: string;
  message: string;
  media?: { mediaType: string; imageUrl: string | null; viewUrl: string; buttonLabel: string };
  title?: string;
  buttonLabel?: string;
  theme?: { accent: string; accentText: string; titleColor: string } | null;
  logoUrl?: string | null;
}): string {
  const htmlMessage = escapeHtml(p.message).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const imgStyle = `display:block;width:100%;max-width:536px;height:auto;margin:0 auto;border:1px solid ${BRAND.border};border-radius:8px;`;
  const theme = p.theme ?? undefined;
  const opts = {
    theme,
    headerHtml: p.logoUrl
      ? `<img src="${escapeHtml(p.logoUrl)}" width="300" alt="${escapeHtml(p.eventName)}" class="pola-logo" style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto;border:0;">`
      : undefined,
  };
  const cta = (url: string, label: string) =>
    buttonRow([{ url, label: p.buttonLabel ?? label, color: theme?.accent, textColor: theme?.accentText }], { align: 'center' });
  const media = p.media;
  if (media && media.mediaType !== 'photo') {
    const poster = media.imageUrl
      ? `<a href="${escapeHtml(media.viewUrl)}" target="_blank" style="display:block;text-decoration:none;"><img src="${escapeHtml(media.imageUrl)}" alt="Aperçu de votre animation" width="536" style="${imgStyle}"></a>`
      : '';
    return layout(p.title ?? `🎞️ ${p.eventName}`, `
    <p style="margin:0;">${htmlMessage}</p>
    ${cta(media.viewUrl, media.buttonLabel)}
    ${poster}`, opts);
  }
  return layout(p.title ?? `📷 ${p.eventName}`, `
    <p style="margin:0;">${htmlMessage}</p>
    ${cta(p.photoUrl, 'Voir ma photo →')}
    <img src="${escapeHtml(p.photoUrl)}" alt="Votre photo" width="536" style="${imgStyle}">`, opts);
}
