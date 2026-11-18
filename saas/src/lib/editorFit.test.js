import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { centeredScroll, fitZoom, FIT_MARGIN, MAX_FIT_ZOOM } from './editorFit.js';

// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');

const portrait  = { canvasWidth: 400, canvasHeight: 600 };
const landscape = { canvasWidth: 600, canvasHeight: 400 };

test('fitZoom : le modèle et sa marge remplissent la zone, sans la zone de débord', () => {
  // Zone de 900 × 600 : portrait limité par la hauteur, 600 / (600 + 48).
  assert.equal(fitZoom({ areaW: 900, areaH: 600, ...portrait }), 0.92);
  // Paysage limité par la largeur sur une zone étroite : 700 / (600 + 48).
  assert.equal(fitZoom({ areaW: 700, areaH: 900, ...landscape }), 1.08);
});

test('fitZoom : dépasse 100 % quand la place le permet, plafonné à MAX_FIT_ZOOM', () => {
  assert.ok(fitZoom({ areaW: 1400, areaH: 1000, ...landscape }) > 1);
  assert.equal(fitZoom({ areaW: 10000, areaH: 10000, ...portrait }), MAX_FIT_ZOOM);
});

test('fitZoom : arrondi au centième inférieur, jamais sous 0,1', () => {
  const z = fitZoom({ areaW: 333, areaH: 777, ...portrait });
  assert.equal(z, Math.floor((333 / (400 + FIT_MARGIN * 2)) * 100) / 100);
  assert.equal(fitZoom({ areaW: 10, areaH: 10, ...portrait }), 0.1);
});

test('fitZoom : zone ou format sans taille → 1', () => {
  assert.equal(fitZoom({ areaW: 0, areaH: 600, ...portrait }), 1);
  assert.equal(fitZoom({ areaW: 600, areaH: -5, ...portrait }), 1);
  assert.equal(fitZoom({ areaW: 600, areaH: 600, canvasWidth: 0, canvasHeight: 600 }), 1);
});

test('centeredScroll : centre le contenu, jamais négatif', () => {
  assert.deepEqual(centeredScroll({ scrollWidth: 1000, scrollHeight: 800, clientWidth: 600, clientHeight: 500 }), { left: 200, top: 150 });
  assert.deepEqual(centeredScroll({ scrollWidth: 300, scrollHeight: 300, clientWidth: 600, clientHeight: 500 }), { left: 0, top: 0 });
});

test('Editor.jsx : les trois calculs du zoom d’ajustement passent par fitZoom', () => {
  const src = readEditor();
  assert.match(src, /import \{ centeredScroll, fitZoom \} from '(\.\.\/)+lib\/editorFit'/);
  // Chargement du modèle, sheet du téléphone, zone de travail redimensionnée.
  assert.equal((src.match(/fitZoom\(\{/g) ?? []).length, 3);
  assert.match(src, /new ResizeObserver\(/);
  assert.doesNotMatch(src, /Math\.min\(1, areaW \/ \(fmt\.canvasWidth \+ CANVAS_OVERFLOW_PAD/);
});
