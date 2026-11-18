/**
 * Dates affichées en français (LAB-395) : une seule définition par format, partout dans l'application.
 * Valeur vide ou invalide : `fallback` (null par défaut ; « — » ou '' selon l'écran). `timeZone`
 * facultatif (par défaut, celui du navigateur) : PARIS_TIME_ZONE pour une date d'événement lue hors de France.
 * Format propre à un seul écran : `formatDateWith(value, options)` plutôt qu'un `toLocaleString` de plus.
 */

export const PARIS_TIME_ZONE = 'Europe/Paris';

// « 2026-11-16 » seul : lu à midi, pour ne pas changer de jour selon le fuseau.
function toDate(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format libre (options de `toLocaleString`), pour un affichage propre à un seul écran. */
export function formatDateWith(value, options = {}) {
  const date = toDate(value);
  return date ? date.toLocaleString('fr-FR', options) : null;
}

/** « 16/11/2026 » */
export function formatDate(value, { timeZone, fallback = null } = {}) {
  return formatDateWith(value, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }) ?? fallback;
}

/** « 16/11/2026 14:05 » */
export function formatDateTime(value, { timeZone, fallback = null } = {}) {
  return formatDateWith(value, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }) ?? fallback;
}

/** « 16 nov. 2026 » */
export function formatShortDate(value, { timeZone, fallback = null } = {}) {
  return formatDateWith(value, { day: 'numeric', month: 'short', year: 'numeric', timeZone }) ?? fallback;
}

/** « 14:05 » */
export function formatTime(value, { timeZone, fallback = null } = {}) {
  return formatDateWith(value, { hour: '2-digit', minute: '2-digit', timeZone }) ?? fallback;
}

/** « 16/11/2026 14:05 » à l'heure de Paris, '' si vide (cellules d'export, admin). */
export function formatParisDateTime(value) {
  return formatDateTime(value, { timeZone: PARIS_TIME_ZONE, fallback: '' });
}

/** « 16/11/2026 » à l'heure de Paris, '' si vide. */
export function formatParisDate(value) {
  return formatDate(value, { timeZone: PARIS_TIME_ZONE, fallback: '' });
}
