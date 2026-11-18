// Polices Google dans l'onglet Polices de la Bibliothèque : chercher dans le catalogue
// (src/data/googleFonts.json, scripts/update-google-fonts.mjs), voir l'aperçu, ajouter la police
// aux polices perso en un clic (fichier TTF par la fonction google-font-file). Règles pures, testées.

/** Catégories du catalogue Google, dans l'ordre des filtres. */
export const GOOGLE_FONT_CATEGORIES = [
  { id: 'all', label: 'Toutes' },
  { id: 'Handwriting', label: 'Écriture' },
  { id: 'Serif', label: 'Serif' },
  { id: 'Sans Serif', label: 'Sans serif' },
  { id: 'Display', label: 'Fantaisie' },
  { id: 'Monospace', label: 'Machine à écrire' },
];

export const WEIGHT_NAMES = {
  100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
};

const categoryLabel = (id) => GOOGLE_FONT_CATEGORIES.find((c) => c.id === id)?.label ?? id;

const normalize = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Ligne du catalogue `[famille, catégorie, graisses]` → objet ; null si la ligne est illisible. */
export function catalogEntry(row) {
  if (!Array.isArray(row) || typeof row[0] !== 'string' || !Array.isArray(row[2]) || row[2].length === 0) return null;
  return { family: row[0], category: row[1], categoryLabel: categoryLabel(row[1]), weights: row[2] };
}

/**
 * Familles du catalogue qui répondent à la recherche, dans l'ordre : nom exact, nom qui commence
 * par la recherche, puis le reste ; à rang égal, la popularité (ordre du catalogue). La recherche
 * ignore accents, majuscules et espaces (« greatvibes » trouve « Great Vibes »).
 */
export function searchGoogleFonts(rows, { query = '', category = 'all' } = {}) {
  const q = normalize(query);
  const qCompact = q.replace(/ /g, '');
  const found = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const entry = catalogEntry(row);
    if (!entry) return;
    if (category !== 'all' && entry.category !== category) return;
    if (!q) { found.push({ entry, rank: 2, index }); return; }
    const name = normalize(entry.family);
    const compact = name.replace(/ /g, '');
    let rank;
    if (name === q || compact === qCompact) rank = 0;
    else if (name.startsWith(q) || compact.startsWith(qCompact)) rank = 1;
    else if (name.includes(q) || compact.includes(qCompact)) rank = 2;
    else return;
    found.push({ entry, rank, index });
  });
  return found.sort((a, b) => a.rank - b.rank || a.index - b.index).map((f) => f.entry);
}

/** Graisse proposée d'abord : 400 si la famille l'a, sinon la plus proche (la plus fine à égalité). */
export function defaultWeight(weights) {
  const list = (Array.isArray(weights) ? weights : []).filter(Number.isInteger);
  if (list.length === 0) return 400;
  return list.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best));
}

/**
 * Nom de la police importée (celui du sélecteur de l'éditeur) : la famille pour la graisse
 * normale, « Montserrat Bold » pour une autre graisse (une police perso = un seul fichier).
 */
export function importedFontName(family, weight) {
  const name = String(family ?? '').trim();
  if (!name || weight === 400 || !WEIGHT_NAMES[weight]) return name;
  return `${name} ${WEIGHT_NAMES[weight]}`;
}

/**
 * Où en est cette police : `imported` si une police perso porte déjà ce nom (sans tenir compte
 * des majuscules), `editor` si la famille est déjà dans la liste Google de l'éditeur à la graisse
 * normale (rien à importer), sinon `new`.
 */
export function googleFontStatus({ family, name, weight }, { customNames = [], editorFonts = [] } = {}) {
  const key = normalize(name);
  if (key && customNames.some((n) => normalize(n) === key)) return 'imported';
  if (weight === 400 && editorFonts.some((f) => normalize(f) === normalize(family))) return 'editor';
  return 'new';
}

/** Feuille CSS de Google pour l'aperçu dans le navigateur ; `text` = seulement ces caractères (léger). */
export function googlePreviewCssUrl(family, weight, text = '') {
  const name = encodeURIComponent(String(family).trim()).replace(/%20/g, '+');
  const subset = text ? `&text=${encodeURIComponent(text)}` : '';
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${weight}${subset}&display=swap`;
}

/**
 * Blocs `@font-face` d'une feuille Google → `[{ url, unicodeRange }]` (fichiers sur
 * fonts.gstatic.com seulement). Sert à charger l'aperçu sous un nom à part, sans toucher aux
 * polices de l'éditeur qui portent le même nom de famille.
 */
export function parseFontFaces(css) {
  const faces = [];
  for (const block of String(css ?? '').match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const url = block.match(/url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)\1\)/)?.[2];
    if (!url) continue;
    const range = block.match(/unicode-range:\s*([^;}]+)/)?.[1]?.trim();
    faces.push(range ? { url, unicodeRange: range } : { url });
  }
  return faces;
}

/** Nom de famille de l'aperçu (jamais celui de la police elle-même). */
export function previewFamily(family, weight, subset = false) {
  return `Apercu ${String(family).trim()} ${weight}${subset ? ' titre' : ''}`;
}

/** Nom du fichier envoyé dans le bucket fonts. */
export function importedFileName(name, contentType) {
  const ext = /otf/i.test(String(contentType ?? '')) ? 'otf' : 'ttf';
  const base = normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'police';
  return `${base}.${ext}`;
}
