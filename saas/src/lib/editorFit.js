// Zoom d'ajustement de l'éditeur : règle pure, testée dans editorFit.test.js.
//
// Le canvas a une zone de débord autour du modèle (CANVAS_OVERFLOW_PAD dans Editor.jsx) pour voir
// les objets qui dépassent. Le zoom d'ajustement ne la compte plus : seul le modèle, avec une petite
// marge, remplit la zone de travail. Le débord reste accessible en défilant.

/** Marge visible autour du modèle au zoom d'ajustement, en pixels du modèle. */
export const FIT_MARGIN = 24;
/** Zoom d'ajustement maximal : au-delà, le modèle serait flou sans rien montrer de plus. */
export const MAX_FIT_ZOOM = 2.5;
const MIN_FIT_ZOOM = 0.1;

/**
 * Zoom qui fait tenir le modèle (`canvasWidth` × `canvasHeight`) et sa marge dans la zone
 * `areaW` × `areaH` (pixels écran, sans le padding de la zone). Arrondi au centième inférieur.
 */
export function fitZoom({ areaW, areaH, canvasWidth, canvasHeight, margin = FIT_MARGIN, max = MAX_FIT_ZOOM }) {
  if (!(areaW > 0) || !(areaH > 0) || !(canvasWidth > 0) || !(canvasHeight > 0)) return 1;
  const scale = Math.min(areaW / (canvasWidth + margin * 2), areaH / (canvasHeight + margin * 2));
  return Math.min(max, Math.max(MIN_FIT_ZOOM, Math.floor(scale * 100) / 100));
}

/** Défilement qui centre le contenu (`scrollWidth` × `scrollHeight`) dans la zone visible. */
export function centeredScroll({ scrollWidth, scrollHeight, clientWidth, clientHeight }) {
  return {
    left: Math.max(0, (scrollWidth - clientWidth) / 2),
    top: Math.max(0, (scrollHeight - clientHeight) / 2),
  };
}
