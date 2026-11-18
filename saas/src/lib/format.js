/**
 * Petits outils de texte et de nombres (LAB-395), une seule définition pour toute l'application.
 * Français : le pluriel commence à 2 (« 0 borne », « 1 borne », « 2 bornes »).
 */

/** Mot au singulier ou au pluriel : `plural(n, 'borne')`, `plural(n, 'invité a répondu', 'invités ont répondu')`. */
export function plural(n, one, many = `${one}s`) {
  return n > 1 ? many : one;
}

/** Nombre suivi du mot accordé : « 3 jours », « 1 action masquée ». */
export function countLabel(n, one, many) {
  return `${n} ${plural(n, one, many)}`;
}

/** Borne une valeur entre `min` et `max`. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Durée en secondes → « 1:05 ». Vide, nulle ou invalide : `fallback`. */
export function formatDuration(seconds, fallback = '0:00') {
  const n = Number(seconds);
  if (!n || !Number.isFinite(n)) return fallback;
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
