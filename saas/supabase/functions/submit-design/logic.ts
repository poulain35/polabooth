// Règles pures de submit-design selon le design envoyé (LAB-289), sans import Deno/esm.sh :
// testables sous `node --test`. 'print' = modèle photo, 'home' = écran d'accueil de la borne.

import { button, escapeHtml, layout } from '../_shared/email-layout.ts';
import type { DesignKind } from '../_shared/design-kind.ts';

/**
 * Chemin du PNG dans le bucket `designs` : l'écran d'accueil a son propre dossier ; un cadre ajouté
 * (slot > 1, LAB-312) porte son numéro, pour que deux cadres envoyés la même seconde ne s'écrasent pas.
 */
export function designPngPath(eventId: string, kind: DesignKind, timestamp: string, slot = 1): string {
  if (kind === 'home') return `${eventId}/home/${timestamp}.png`;
  return slot > 1 ? `${eventId}/${timestamp}_slot${slot}.png` : `${eventId}/${timestamp}.png`;
}

/** Seul le modèle photo fait passer l'événement en `submitted`. */
export function submitUpdatesEventStatus(kind: DesignKind): boolean {
  return kind === 'print';
}

/** Nom de l'événement envoyé au webhook de l'organisation. */
export function submitWebhookEvent(kind: DesignKind): string {
  return kind === 'home' ? 'home_design.submitted' : 'design.submitted';
}

export function submitSuccessMessage(kind: DesignKind): string {
  return kind === 'home' ? "Écran d'accueil envoyé avec succès" : 'Design envoyé avec succès';
}

/**
 * Notification admin « écran d'accueil envoyé » : même gabarit que celle du modèle photo
 * (renderSubmitNotificationEmail), libellé distinct.
 */
export function renderHomeSubmitNotificationEmail(p: { eventName: string; clientName: string; adminUrl: string }) {
  return {
    subject: `✅ Écran d'accueil envoyé — ${p.eventName}`,
    html: layout("✅ Nouvel écran d'accueil reçu", `
    <p style="margin:0;"><strong>${escapeHtml(p.clientName)}</strong> vient d'envoyer l'écran d'accueil de la borne pour l'événement
    <strong>${escapeHtml(p.eventName)}</strong>.</p>
    ${button(p.adminUrl, 'Voir et valider →')}`, { audience: 'admin' }),
  };
}

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG ; null si ce n'est pas un PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const HOME_PNG_WIDTH = 1920;
const HOME_PNG_HEIGHT = 1080;

/** L'écran d'accueil doit faire exactement 1920×1080 ; le modèle photo n'est pas vérifié ici. */
export function pngFitsKind(kind: DesignKind, bytes: Uint8Array): boolean {
  if (kind !== 'home') return true;
  const size = pngSize(bytes);
  return size?.width === HOME_PNG_WIDTH && size?.height === HOME_PNG_HEIGHT;
}
