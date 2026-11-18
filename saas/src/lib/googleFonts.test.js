import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalogEntry, defaultWeight, googleFontStatus, googlePreviewCssUrl, importedFileName, importedFontName,
  parseFontFaces, previewFamily, searchGoogleFonts,
} from './googleFonts.js';
import { EDITOR_FONTS } from '../utils/editorFonts.js';

const ROWS = [
  ['Roboto', 'Sans Serif', [100, 400, 700]],
  ['Great Vibes', 'Handwriting', [400]],
  ['Playfair Display', 'Serif', [400, 700, 900]],
  ['Vibes', 'Display', [400]],
  ['Bodoni Moda', 'Serif', [400, 500]],
  ['Thin Only', 'Display', [100, 200, 600]],
  ['bad'],
];

test('catalogEntry lit une ligne et rejette une ligne illisible', () => {
  assert.deepEqual(catalogEntry(ROWS[1]), {
    family: 'Great Vibes', category: 'Handwriting', categoryLabel: 'Écriture', weights: [400],
  });
  assert.equal(catalogEntry(['bad']), null);
  assert.equal(catalogEntry(null), null);
  assert.equal(catalogEntry(['X', 'Serif', []]), null);
});

test('searchGoogleFonts : tout le catalogue sans recherche, dans l’ordre de popularité', () => {
  assert.deepEqual(searchGoogleFonts(ROWS).map((e) => e.family),
    ['Roboto', 'Great Vibes', 'Playfair Display', 'Vibes', 'Bodoni Moda', 'Thin Only']);
});

test('searchGoogleFonts : exact, puis début du nom, puis le reste', () => {
  assert.deepEqual(searchGoogleFonts(ROWS, { query: 'vibes' }).map((e) => e.family), ['Vibes', 'Great Vibes']);
  assert.deepEqual(searchGoogleFonts(ROWS, { query: 'GREATVIBES' }).map((e) => e.family), ['Great Vibes']);
  assert.deepEqual(searchGoogleFonts(ROWS, { query: '  play ' }).map((e) => e.family), ['Playfair Display']);
  assert.deepEqual(searchGoogleFonts(ROWS, { query: 'bodôni' }).map((e) => e.family), ['Bodoni Moda']);
  assert.deepEqual(searchGoogleFonts(ROWS, { query: 'zzz' }), []);
});

test('searchGoogleFonts : filtre par catégorie', () => {
  assert.deepEqual(searchGoogleFonts(ROWS, { category: 'Serif' }).map((e) => e.family), ['Playfair Display', 'Bodoni Moda']);
  assert.deepEqual(searchGoogleFonts(ROWS, { query: 'vibes', category: 'Handwriting' }).map((e) => e.family), ['Great Vibes']);
  assert.deepEqual(searchGoogleFonts(null), []);
});

test('defaultWeight : 400, sinon la plus proche', () => {
  assert.equal(defaultWeight([100, 400, 700]), 400);
  assert.equal(defaultWeight([100, 200, 600]), 200);
  assert.equal(defaultWeight([300, 500]), 300);
  assert.equal(defaultWeight([900]), 900);
  assert.equal(defaultWeight([]), 400);
});

test('importedFontName : la famille en normal, sinon la graisse en plus', () => {
  assert.equal(importedFontName('Montserrat', 400), 'Montserrat');
  assert.equal(importedFontName('Montserrat', 700), 'Montserrat Bold');
  assert.equal(importedFontName(' Bodoni Moda ', 500), 'Bodoni Moda Medium');
  assert.equal(importedFontName('X', 450), 'X');
});

test('googleFontStatus : déjà importée, déjà dans l’éditeur, nouvelle', () => {
  const ctx = { customNames: ['great vibes', 'Montserrat Bold'], editorFonts: ['Roboto', 'Great Vibes'] };
  assert.equal(googleFontStatus({ family: 'Great Vibes', name: 'Great Vibes', weight: 400 }, ctx), 'imported');
  assert.equal(googleFontStatus({ family: 'Montserrat', name: 'Montserrat Bold', weight: 700 }, ctx), 'imported');
  assert.equal(googleFontStatus({ family: 'Roboto', name: 'Roboto', weight: 400 }, ctx), 'editor');
  assert.equal(googleFontStatus({ family: 'Roboto', name: 'Roboto Thin', weight: 100 }, ctx), 'new');
  assert.equal(googleFontStatus({ family: 'Bodoni Moda', name: 'Bodoni Moda', weight: 400 }, ctx), 'new');
  assert.equal(googleFontStatus({ family: 'Bodoni Moda', name: 'Bodoni Moda', weight: 400 }), 'new');
});

test('googlePreviewCssUrl : famille, graisse et sous-ensemble de caractères', () => {
  assert.equal(googlePreviewCssUrl('Great Vibes', 400),
    'https://fonts.googleapis.com/css2?family=Great+Vibes:wght@400&display=swap');
  assert.equal(googlePreviewCssUrl('Exo 2', 700, 'Exo & 2'),
    'https://fonts.googleapis.com/css2?family=Exo+2:wght@700&text=Exo%20%26%202&display=swap');
});

test('parseFontFaces : fichiers gstatic et plages unicode', () => {
  const css = `/* latin-ext */
@font-face {
  font-family: 'Great Vibes';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/greatvibes/v1/a.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Great Vibes';
  src: url('https://fonts.gstatic.com/s/greatvibes/v1/b.woff2') format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Ailleurs';
  src: url(https://exemple.invalid/c.woff2) format('woff2');
}
@font-face {
  font-family: 'Sous-ensemble';
  src: url(https://fonts.gstatic.com/l/font?kit=abc&skey=1) format('woff2');
}`;
  assert.deepEqual(parseFontFaces(css), [
    { url: 'https://fonts.gstatic.com/s/greatvibes/v1/a.woff2', unicodeRange: 'U+0100-02BA, U+1E00-1EFF' },
    { url: 'https://fonts.gstatic.com/s/greatvibes/v1/b.woff2', unicodeRange: 'U+0000-00FF' },
    { url: 'https://fonts.gstatic.com/l/font?kit=abc&skey=1' },
  ]);
  assert.deepEqual(parseFontFaces(''), []);
  assert.deepEqual(parseFontFaces(null), []);
});

test('previewFamily ne reprend jamais le nom de la police', () => {
  assert.equal(previewFamily('Great Vibes', 400), 'Apercu Great Vibes 400');
  assert.equal(previewFamily('Great Vibes', 400, true), 'Apercu Great Vibes 400 titre');
});

test('importedFileName : nom propre et extension selon le type', () => {
  assert.equal(importedFileName('Bodoni Moda Medium', 'font/ttf'), 'bodoni-moda-medium.ttf');
  assert.equal(importedFileName('Écriture', 'font/otf'), 'ecriture.otf');
  assert.equal(importedFileName('***', null), 'police.ttf');
});

test('catalogue livré : lignes lisibles, noms acceptés par google-font-file, éditeur couvert', () => {
  const rows = JSON.parse(readFileSync(new URL('../data/googleFonts.json', import.meta.url), 'utf8'));
  assert.ok(rows.length > 1000);
  const families = new Set();
  for (const row of rows) {
    const entry = catalogEntry(row);
    assert.ok(entry, JSON.stringify(row));
    assert.match(entry.family, /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/);
    assert.ok(entry.weights.every((w) => Number.isInteger(w) && w >= 100 && w <= 900));
    families.add(entry.family);
  }
  assert.equal(families.size, rows.length);
  // La plupart des polices Google de l'éditeur sont dans le catalogue (ITC Eras n'est pas Google).
  const missing = EDITOR_FONTS.filter((f) => !families.has(f));
  assert.ok(missing.length <= 3, missing.join(', '));
});
