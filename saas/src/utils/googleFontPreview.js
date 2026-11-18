// Aperçu d'une police Google dans l'onglet Polices de la Bibliothèque, avant de l'ajouter.
// La feuille de Google est lue puis ses fichiers chargés sous un nom à part (`previewFamily`) :
// l'aperçu ne remplace jamais une police de l'éditeur qui porte le même nom. `text` : seulement ces
// caractères (liste des résultats, quelques Ko par police).
import { googlePreviewCssUrl, parseFontFaces, previewFamily } from '../lib/googleFonts';

const loads = new Map();

/** Charge l'aperçu et renvoie le nom de famille à utiliser en CSS ; rejette si Google ne répond pas. */
export function loadPreviewFont(family, weight, text = '') {
  const alias = previewFamily(family, weight, Boolean(text));
  const key = `${alias}|${text}`;
  if (!loads.has(key)) {
    const load = (async () => {
      const res = await fetch(googlePreviewCssUrl(family, weight, text));
      if (!res.ok) throw new Error(`Aperçu indisponible (${res.status})`);
      const faces = parseFontFaces(await res.text());
      if (faces.length === 0) throw new Error('Aperçu indisponible');
      for (const face of faces) {
        const descriptors = { weight: String(weight), display: 'swap' };
        if (face.unicodeRange) descriptors.unicodeRange = face.unicodeRange;
        document.fonts.add(new FontFace(alias, `url("${face.url}")`, descriptors));
      }
      await document.fonts.load(`${weight} 32px "${alias}"`, text || 'Aa');
      return alias;
    })();
    load.catch(() => loads.delete(key));
    loads.set(key, load);
  }
  return loads.get(key);
}
