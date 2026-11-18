/**
 * Emails au client sur son écran d'accueil de la borne (LAB-290) : validé, ou à corriger avec le
 * motif. Rendu pur (testé par node --test) ; la marque de l'organisation est appliquée à l'envoi,
 * comme pour les autres emails (sender = orgSender).
 */
import { button, escapeHtml, layout, softBox, trackingLine } from '../_shared/email-layout.ts';

export interface HtmlEmail { subject: string; html: string }

/** `trackingUrl` : lien « Suivre ma réservation » (clientTrackingUrl) ; absent = email d'avant. */
export function renderHomeApprovalEmail(p: { clientName: string; eventName: string; trackingUrl?: string | null }): HtmlEmail {
  return {
    subject: `✅ Votre écran d'accueil a été validé — ${p.eventName}`,
    html: layout('✅ Écran d’accueil validé !', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>L'écran d'accueil de la borne pour l'événement <strong>${escapeHtml(p.eventName)}</strong> a été validé par notre équipe. 🎉</p>
    <p style="margin:0;">Vos invités le verront en arrivant devant la borne. Vous n'avez rien d'autre à faire.</p>${trackingLine(p.trackingUrl)}`),
  };
}

export function renderHomeRejectionEmail(p: {
  clientName: string;
  eventName: string;
  editorUrl: string;
  feedback: string;
  trackingUrl?: string | null;
}): HtmlEmail {
  return {
    subject: `🔄 Votre écran d'accueil nécessite des modifications — ${p.eventName}`,
    html: layout('🔄 Modifications demandées', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>L'écran d'accueil de la borne pour l'événement <strong>${escapeHtml(p.eventName)}</strong> nécessite quelques modifications avant validation.</p>
    ${softBox(`<strong>Retour de notre équipe :</strong><br>${escapeHtml(p.feedback)}`, { tone: 'warning', preWrap: true, margin: '20px 0 0' })}
    <p style="margin:20px 0 0;">Modifiez-le dans l'onglet « Mon écran d'accueil » de l'éditeur, puis renvoyez-le.</p>
    ${button(p.editorUrl, 'Modifier mon écran d’accueil →')}${trackingLine(p.trackingUrl)}`),
  };
}
