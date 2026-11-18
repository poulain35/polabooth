// Polices dont un état d'éditeur a besoin (LAB-347). Les polices importées ne sont plus téléchargées
// d'avance : avant d'afficher ou d'exporter un modèle, on ne charge que celles de ses textes.

const TEXT_TYPES = new Set(['i-text', 'text', 'textbox']);

/** Objets d'un état d'éditeur, groupes ouverts (les textes rangés dans un groupe comptent). */
export function flattenObjects(objects) {
  if (!Array.isArray(objects)) return [];
  return objects.flatMap((o) => (
    o?.type === 'group' && Array.isArray(o.objects) ? [o, ...flattenObjects(o.objects)] : [o]
  ));
}

/**
 * Descripteurs `document.fonts.load` des textes d'un état d'éditeur, sans doublon :
 * `[italic ]<graisse> 16px "<famille>"`. Textes des groupes compris (boutons de la borne, LAB-324).
 */
export function fontDescriptorsOf(objects) {
  const descriptors = new Set();
  for (const o of flattenObjects(objects)) {
    if (!o || !TEXT_TYPES.has(o.type) || !o.fontFamily) continue;
    const style = o.fontStyle === 'italic' ? 'italic ' : '';
    const weight = o.fontWeight || 400;
    descriptors.add(`${style}${weight} 16px "${o.fontFamily}"`);
  }
  return [...descriptors];
}

/** Charge les polices des textes d'un état d'éditeur (échecs ignorés : police de secours). */
export async function loadFontsOf(objects) {
  const descriptors = fontDescriptorsOf(objects);
  if (descriptors.length === 0 || typeof document === 'undefined' || !document.fonts) return;
  await Promise.allSettled(descriptors.map((d) => document.fonts.load(d)));
}
