// Éditeur sur téléphone (LAB-351) : règles pures, testées dans editorMobile.test.js.

/**
 * Libellés du bouton d'envoi : `full` sur grand écran, `short` sur téléphone (repris par la carte
 * d'accueil, qui doit nommer le bouton tel qu'il s'affiche).
 */
export function submitButtonLabels({ isSubmitting = false, submitLabel = null, homeMode = false } = {}) {
  if (isSubmitting) return { full: 'Envoi…', short: 'Envoi…' };
  const short = submitLabel || homeMode ? 'Envoyer' : 'Valider';
  const full = submitLabel ?? (homeMode ? 'Envoyer mon écran' : 'Valider mon design');
  return { full, short };
}

// ── LAB-353 : panneaux, aperçu et zoom sur téléphone ─────────────────────────

/** Écran étroit de l'éditeur (même seuil que `md` de Tailwind) : panneaux en plein écran. */
export function isCompactViewport(width) {
  return width < 768;
}

/**
 * Onglet ouvert par défaut dans le panneau des décorations : « Mes stickers » s'il a du contenu
 * (ou pendant le chargement, `null`), sinon la première catégorie qui en a.
 */
export function defaultStickerCategory(decorations, categories, myStickersId) {
  if (decorations === null || decorations === undefined || decorations.length > 0) return myStickersId;
  return categories.find((c) => c.items?.length > 0)?.id ?? myStickersId;
}

/**
 * Zoom ancré : position relative (0 à 1) du point `point` (coordonnées écran) dans le rectangle
 * du modèle `rect` avant le zoom.
 */
export function zoomAnchorFraction(point, rect) {
  return {
    x: rect.width ? (point.x - rect.left) / rect.width : 0.5,
    y: rect.height ? (point.y - rect.top) / rect.height : 0.5,
  };
}

/**
 * Défilement à ajouter après le zoom pour que le même endroit du modèle revienne sous `point`
 * (`rect` = rectangle du modèle après le zoom). Le navigateur borne le résultat.
 */
export function zoomScrollDelta(point, fraction, rect) {
  return {
    x: rect.left + fraction.x * rect.width - point.x,
    y: rect.top + fraction.y * rect.height - point.y,
  };
}
