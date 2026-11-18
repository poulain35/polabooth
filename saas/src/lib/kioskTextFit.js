// Réduction des textes comme la borne, pour l'aperçu (spec docs/specs/apercu-borne.md). Module
// miroir pur de kiosk/PolaKiosk/Views/TextFit.cs (FitFontSize) et du réglage des textes vivants de
// kiosk/PolaKiosk/Views/DesignedScreen.xaml.cs (Fit : MinSizeRatio, LineFactor, hauteur de ligne).
//
// La borne mesure avec FormattedText (WPF). Le navigateur n'a pas ce moteur : la mesure d'une
// chaîne est injectée (`measure(text, fontSize)` → largeur en px), par exemple celle d'un canvas
// 2D. Le découpage en lignes suit WPF : coupure après une espace (U+0020, U+2009) ou un tiret ;
// un mot plus large que la boîte ne tient pas (FormattedText.MinWidth).

/** DesignedScreen.MinSizeRatio : un texte vivant ne descend pas sous 40 % de sa taille. */
const MIN_SIZE_RATIO = 0.4;
/** DesignedScreen.LineFactor : hauteur de ligne des textes vivants. */
export const LINE_FACTOR = 1.16;
/** DesignedScreen : taille minimale absolue. */
const MIN_FONT_SIZE = 8;
/** TextFit : pas de réduction. */
const FIT_STEP = 2;

/** Math.Round de .NET (arrondi au pair, MidpointRounding.ToEven). */
export function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Hauteur de ligne de la borne : Math.Round(size * lineFactor). */
export const lineHeightFor = (size, lineFactor = LINE_FACTOR) => roundHalfEven(size * lineFactor);

/** DesignedScreen.Fit : Max(8, Math.Round(size * 0.4)). */
export const minFontSizeFor = (size) => Math.max(MIN_FONT_SIZE, roundHalfEven(size * MIN_SIZE_RATIO));

// Coupures permises après ces caractères (classes SP, BA et HY de l'UAX 14 utiles ici). L'espace
// insécable (U+00A0) et l'espace fine insécable (U+202F) ne coupent pas.
const BREAK_AFTER = new Set([' ', '\u2009', '-', '\u2010', '\t']);
const TRAILING_SPACES = /[ \u2009\t]+$/;

/** Segments insécables du texte, chacun avec ses espaces de fin. */
function segmentsOf(paragraph) {
  const segments = [];
  let current = '';
  const chars = Array.from(paragraph);
  for (let i = 0; i < chars.length; i++) {
    current += chars[i];
    const next = chars[i + 1];
    // Une suite d'espaces reste collée au segment qui la précède.
    if (BREAK_AFTER.has(chars[i]) && next !== undefined && !(next === ' ' || next === '\u2009' || next === '\t')) {
      segments.push(current);
      current = '';
    }
  }
  if (current !== '') segments.push(current);
  return segments;
}

/**
 * Lignes du texte à cette taille dans cette largeur (retour à la ligne glouton), et largeur minimale
 * (le segment insécable le plus large, espaces de fin exclues), comme FormattedText.MinWidth.
 * Un segment trop large occupe sa propre ligne.
 */
export function layoutLines(text, fontSize, width, measure) {
  const widthOf = (s) => measure(s.replace(TRAILING_SPACES, ''), fontSize);
  const lines = [];
  let minWidth = 0;
  for (const paragraph of String(text).split(/\r\n|\r|\n/)) {
    let line = '';
    for (const segment of segmentsOf(paragraph)) {
      minWidth = Math.max(minWidth, widthOf(segment));
      const candidate = line + segment;
      if (line !== '' && widthOf(candidate) > width) {
        lines.push(line.replace(TRAILING_SPACES, ''));
        line = segment;
      } else {
        line = candidate;
      }
    }
    lines.push(line.replace(TRAILING_SPACES, ''));
  }
  return { lines, minWidth };
}

/**
 * TextFit.FitFontSize : plus grande taille, de `maxSize` à `minSize` de 2 en 2, où le texte tient
 * en `maxLines` lignes dans la largeur sans couper un mot et, si `maxHeight` est donné, dans cette
 * hauteur. Sinon `minSize` (jamais essayée dans la boucle) : la borne coupe alors avec « … ».
 */
export function fitFontSize({ text, maxSize, minSize, lineFactor, width, maxLines, maxHeight = null, measure }) {
  if (typeof text !== 'string' || text.trim().length === 0) return maxSize;

  for (let size = maxSize; size > minSize; size -= FIT_STEP) {
    const lineHeight = lineHeightFor(size, lineFactor);
    const { lines, minWidth } = layoutLines(text, size, width, measure);
    const height = lines.length * lineHeight;
    const wordsFit = minWidth <= width;
    const linesFit = height <= maxLines * lineHeight + 0.5;
    const heightFit = maxHeight == null || Math.min(height, maxLines * lineHeight) <= maxHeight + 0.5;
    if (wordsFit && linesFit && heightFit) return size;
  }
  return minSize;
}

/**
 * DesignedScreen.Fit : taille, hauteur de ligne et hauteur maximale d'un texte vivant du plan
 * (`spec` normalisé par kioskScreenLayout : size, w, h, max_lines). `text` est le texte déjà passé
 * par displayText (majuscules, espacement).
 */
export function fitScreenText(text, spec, measure) {
  const fontSize = fitFontSize({
    text,
    maxSize: spec.size,
    minSize: minFontSizeFor(spec.size),
    lineFactor: LINE_FACTOR,
    width: spec.w,
    maxLines: spec.max_lines,
    maxHeight: spec.h,
    measure,
  });
  const lineHeight = lineHeightFor(fontSize, LINE_FACTOR);
  // Au-delà, le texte est coupé avec « … ».
  return { fontSize, lineHeight, maxHeight: spec.max_lines * lineHeight };
}

/**
 * Mesure par un contexte canvas 2D (navigateur), police CSS des textes vivants. `fontFamily` est la
 * famille CSS chargée (ensureKioskFonts), `fontWeight` le poids du plan.
 */
export function canvasMeasure(context, fontFamily, fontWeight = 400) {
  return (text, fontSize) => {
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    return context.measureText(text).width;
  };
}
