// Met à jour src/data/googleFonts.json, le catalogue des polices Google proposé dans l'onglet
// Polices de la Bibliothèque (recherche, aperçu, import en un clic).
//
// Usage (depuis saas/) : node scripts/update-google-fonts.mjs
//
// Source : https://fonts.google.com/metadata/fonts (2,7 Mo, toutes libres). On ne garde que les
// familles avec l'alphabet latin, hors polices de marque, dont le nom passe la validation de la
// fonction google-font-file, et seulement les graisses droites (pas d'italique : google-font-file
// ne renvoie que la forme droite), de 100 à 900 par centaine (bornes de google-font-file).
// Ligne : [famille, catégorie, graisses], triées par popularité.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://fonts.google.com/metadata/fonts';
const OUT = fileURLToPath(new URL('../src/data/googleFonts.json', import.meta.url));
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/; // même règle que google-font-file/logic.ts

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Catalogue Google injoignable (${res.status})`);
const text = (await res.text()).replace(/^\)\]\}'\n?/, '');
const list = JSON.parse(text).familyMetadataList;
if (!Array.isArray(list) || list.length < 500) throw new Error('Catalogue Google inattendu');

const rows = list
  .filter((f) => f.isOpenSource !== false && !f.isBrandFont && f.subsets?.includes('latin') && FAMILY_RE.test(f.family))
  .sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9))
  .map((f) => [
    f.family,
    f.category,
    Object.keys(f.fonts ?? {}).filter((k) => /^[1-9]00$/.test(k)).map(Number).sort((a, b) => a - b),
  ])
  .filter((row) => row[2].length > 0);

writeFileSync(OUT, `${JSON.stringify(rows)}\n`);
console.log(`${rows.length} familles écrites dans ${OUT}`);
