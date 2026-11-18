// Images du bucket kiosk-backgrounds (LAB-282) : fond d'accueil d'un événement et fond de l'écran
// de saisie du code. Règles pures (pas de réseau ni de DOM), testées dans kioskBackground.test.js.
// Le bucket n'accepte que PNG, JPEG (et le JSON de setup_config), 10 Mo au maximum.
import { NETWORK_ERROR_MESSAGE, isFetchFailure } from './networkError.js';

export const KIOSK_BG_MAX_BYTES = 10 * 1024 * 1024;
export const KIOSK_BG_ACCEPT = 'image/png,image/jpeg';

const BG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const BG_EXTENSIONS = { png: 'png', jpg: 'jpg', jpeg: 'jpg' };

/** Extension du fichier rangé (png ou jpg), ou null si le format n'est pas accepté. */
export function kioskBackgroundExtension(file) {
  if (!file) return null;
  if (file.type) return BG_TYPES[file.type] ?? null;
  const ext = String(file.name ?? '').split('.').pop().toLowerCase();
  return BG_EXTENSIONS[ext] ?? null;
}

/** Type MIME envoyé à Storage pour une extension acceptée. */
export function kioskBackgroundContentType(ext) {
  return ext === 'png' ? 'image/png' : 'image/jpeg';
}

/** Message d'erreur à montrer à l'admin, ou null si le fichier est accepté. */
export function kioskBackgroundProblem(file) {
  if (!file) return 'Aucun fichier choisi.';
  if (!kioskBackgroundExtension(file)) {
    return 'Format non accepté : choisissez une image PNG ou JPG.';
  }
  if (file.size > KIOSK_BG_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return `Image trop lourde (${mb} Mo) : 10 Mo au maximum. Réduisez sa taille et réessayez.`;
  }
  return null;
}

/** Chemin du fond d'accueil d'un événement. */
export function eventBackgroundPath(eventId, ext) {
  return `${eventId}/background.${ext}`;
}

/** Chemin du fond de l'écran de saisie du code (commun à toutes les bornes, admin plateforme). */
export function setupBackgroundPath(ext) {
  return `default/setup_background.${ext}`;
}

/**
 * Message clair pour une erreur renvoyée par Storage sur ce bucket (droits, type, taille).
 * Les autres erreurs gardent leur message.
 */
export function kioskStorageErrorMessage(error) {
  const raw = String(error?.message ?? error ?? '');
  const status = String(error?.statusCode ?? error?.status ?? '');
  if (/row-level security|unauthorized|not authorized|permission/i.test(raw) || status === '403') {
    return "Envoi refusé : ce compte n'a pas le droit de modifier cette image.";
  }
  if (/mime type|invalid_mime_type/i.test(raw) || status === '415') {
    return 'Format non accepté : choisissez une image PNG ou JPG.';
  }
  if (/exceeded the maximum allowed size|entity too large|payload too large/i.test(raw) || status === '413') {
    return 'Image trop lourde : 10 Mo au maximum. Réduisez sa taille et réessayez.';
  }
  if (isFetchFailure(error)) return NETWORK_ERROR_MESSAGE;
  return raw || "L'envoi a échoué. Réessayez.";
}
