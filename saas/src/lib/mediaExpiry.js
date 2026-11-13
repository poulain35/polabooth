// Suppression des fichiers en ligne après expiration du lien photos & audio (LAB-212).
// La purge (fonction media-expiry) a lieu 30 jours après events.expires_at et note
// events.media_purged_at. Prolonger le lien ensuite ne restaure rien : ce module dit à la fiche
// événement quoi afficher.

export const PURGE_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/**
 * @returns {{ purgedAt: string|null, extendedAfterPurge: boolean }}
 *   purgedAt : date de la dernière suppression des fichiers (null si jamais purgé).
 *   extendedAfterPurge : l'expiration actuelle n'aurait pas déclenché cette purge (lien prolongé
 *   ou expiration retirée après coup) : les galeries sont de nouveau ouvertes, mais vides.
 */
export function mediaPurgeInfo(event) {
  const purged = ms(event?.media_purged_at);
  if (!Number.isFinite(purged)) return { purgedAt: null, extendedAfterPurge: false };
  const exp = ms(event?.expires_at);
  const extendedAfterPurge = !Number.isFinite(exp) || exp + PURGE_GRACE_DAYS * DAY_MS > purged;
  return { purgedAt: event.media_purged_at, extendedAfterPurge };
}
