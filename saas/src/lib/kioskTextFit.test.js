import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_FACTOR,
  fitFontSize,
  fitScreenText,
  layoutLines,
  lineHeightFor,
  minFontSizeFor,
  roundHalfEven,
} from './kioskTextFit.js';

// Police à chasse fixe pour les tests : chaque caractère fait 0,5 × la taille.
const mono = (text, size) => Array.from(text).length * size * 0.5;

test('Math.Round de .NET : arrondi au pair', () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, 2.4, 2.6].map(roundHalfEven), [0, 2, 2, 4, 0, -2, 2, 3]);
});

test('taille minimale : Max(8, Math.Round(size × 0,4)), arrondi au pair', () => {
  assert.equal(minFontSizeFor(40), 16);
  assert.equal(minFontSizeFor(10), 8);
  assert.equal(minFontSizeFor(55), 22);
  assert.equal(minFontSizeFor(65), 26);
  assert.equal(minFontSizeFor(36.25), 14); // 14,5 → 14 (au pair)
  assert.equal(minFontSizeFor(38.75), 16); // 15,5 → 16 (au pair)
});

test('hauteur de ligne : Math.Round(size × 1,16)', () => {
  assert.equal(lineHeightFor(40), 46);
  assert.equal(lineHeightFor(50), 58);
  assert.equal(lineHeightFor(25), 29);
  assert.equal(lineHeightFor(96, 0.98), 94);
});

test('découpage : coupure après une espace, une espace fine ou un tiret ; mot le plus large', () => {
  assert.deepEqual(layoutLines('Camille & Thomas', 10, 45, mono), { lines: ['Camille &', 'Thomas'], minWidth: 35 });
  assert.deepEqual(layoutLines('Jean-Pierre', 10, 30, mono).lines, ['Jean-', 'Pierre']);
  assert.deepEqual(layoutLines('L\u2009é\u2009a', 10, 10, mono).lines, ['L', 'é', 'a']);
  // Les espaces insécables ne coupent pas.
  assert.deepEqual(layoutLines('14\u00a0juin', 10, 20, mono), { lines: ['14\u00a0juin'], minWidth: 35 });
  assert.deepEqual(layoutLines('a\nb', 10, 100, mono).lines, ['a', 'b']);
});

test('FitFontSize : texte vide → taille maximale', () => {
  const args = { maxSize: 40, minSize: 16, lineFactor: LINE_FACTOR, width: 10, maxLines: 1, measure: mono };
  assert.equal(fitFontSize({ ...args, text: '' }), 40);
  assert.equal(fitFontSize({ ...args, text: '   ' }), 40);
});

test('FitFontSize : de 2 en 2 jusqu’à ce que le texte tienne', () => {
  // « Camille & Thomas » = 16 caractères ; sur une ligne de 300 px : 16 × 0,5 × size ≤ 300 → size ≤ 37,5.
  const args = { text: 'Camille & Thomas', minSize: 16, lineFactor: LINE_FACTOR, width: 300, maxLines: 1, measure: mono };
  assert.equal(fitFontSize({ ...args, maxSize: 40 }), 36);
  assert.equal(fitFontSize({ ...args, maxSize: 41 }), 37);
  // Deux lignes permises : « Camille & » (9 car.) et « Thomas » → 40 tient.
  assert.equal(fitFontSize({ ...args, maxSize: 40, maxLines: 2 }), 40);
});

test('FitFontSize : un mot trop large fait descendre la taille, même avec des lignes en plus', () => {
  // « Anticonstitutionnellement » = 25 caractères dans 250 px → size ≤ 20.
  const args = { text: 'Anticonstitutionnellement', minSize: 8, lineFactor: LINE_FACTOR, width: 250, maxLines: 3, measure: mono };
  assert.equal(fitFontSize({ ...args, maxSize: 40 }), 20);
});

test('FitFontSize : la hauteur de la boîte limite aussi', () => {
  // Sans hauteur : deux lignes à 40 suffisent. Hauteur 60 : à 26, deux lignes de 30 = 60 ≤ 60,5.
  // Hauteur 40 : à 24, le texte tient sur une ligne de 28. Hauteur 20 : rien ne tient, 16.
  const args = { text: 'Camille & Thomas', minSize: 16, lineFactor: LINE_FACTOR, width: 200, maxLines: 2, measure: mono };
  assert.equal(fitFontSize({ ...args, maxSize: 40 }), 40);
  assert.equal(fitFontSize({ ...args, maxSize: 40, maxHeight: 60 }), 26);
  assert.equal(fitFontSize({ ...args, maxSize: 40, maxHeight: 40 }), 24);
  assert.equal(fitFontSize({ ...args, maxSize: 40, maxHeight: 20 }), 16);
});

test('FitFontSize : rien ne tient → taille minimale, jamais essayée dans la boucle', () => {
  const calls = [];
  const spy = (text, size) => {
    calls.push(size);
    return mono(text, size);
  };
  const size = fitFontSize({
    text: 'Un texte beaucoup trop long pour sa place', maxSize: 30, minSize: 22,
    lineFactor: LINE_FACTOR, width: 50, maxLines: 1, measure: spy,
  });
  assert.equal(size, 22);
  assert.deepEqual([...new Set(calls)], [30, 28, 26, 24]);
});

test('fitScreenText : réglage d’un texte vivant comme DesignedScreen.Fit', () => {
  const spec = { size: 40, w: 300, h: 50, max_lines: 2 };
  assert.deepEqual(fitScreenText('Camille & Thomas', spec, mono), { fontSize: 36, lineHeight: 42, maxHeight: 84 });
  // Ne tient nulle part : 40 % de la taille, coupé ensuite avec « … ».
  assert.deepEqual(fitScreenText('x'.repeat(200), spec, mono), { fontSize: 16, lineHeight: 19, maxHeight: 38 });
});
