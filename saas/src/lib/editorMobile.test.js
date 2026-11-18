// LAB-351, LAB-353 : éditeur sur téléphone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitButtonLabels, isCompactViewport, defaultStickerCategory, zoomAnchorFraction, zoomScrollDelta,
} from './editorMobile.js';

test('submitButtonLabels : modèle photo = « Valider » sur téléphone, « Valider mon design » ailleurs', () => {
  assert.deepEqual(submitButtonLabels({}), { full: 'Valider mon design', short: 'Valider' });
});

test("submitButtonLabels : écran d'accueil = « Envoyer »", () => {
  assert.deepEqual(submitButtonLabels({ homeMode: true }), { full: 'Envoyer mon écran', short: 'Envoyer' });
});

test('submitButtonLabels : plusieurs cadres = libellé donné, « Envoyer » sur téléphone', () => {
  assert.deepEqual(submitButtonLabels({ submitLabel: 'Envoyer mes cadres' }), { full: 'Envoyer mes cadres', short: 'Envoyer' });
});

test('submitButtonLabels : pendant l’envoi, « Envoi… » partout', () => {
  assert.deepEqual(submitButtonLabels({ isSubmitting: true, homeMode: true }), { full: 'Envoi…', short: 'Envoi…' });
});

// LAB-353 : panneaux, aperçu et zoom sur téléphone.

test('isCompactViewport : téléphone et petite tablette sous 768 px', () => {
  assert.equal(isCompactViewport(390), true);
  assert.equal(isCompactViewport(767), true);
  assert.equal(isCompactViewport(768), false);
});

const CATS = [{ id: 'vide', items: [] }, { id: 'fete', items: [{ id: 'a' }] }, { id: 'coeurs', items: [{ id: 'b' }] }];

test('defaultStickerCategory : « Mes stickers » pendant le chargement ou s’il a du contenu', () => {
  assert.equal(defaultStickerCategory(null, CATS, 'mine'), 'mine');
  assert.equal(defaultStickerCategory([{ id: 1 }], CATS, 'mine'), 'mine');
});

test('defaultStickerCategory : « Mes stickers » vide → première catégorie non vide', () => {
  assert.equal(defaultStickerCategory([], CATS, 'mine'), 'fete');
  assert.equal(defaultStickerCategory([], [{ id: 'vide', items: [] }], 'mine'), 'mine');
});

test('zoom ancré au centre : le centre du modèle reste au centre de la zone', () => {
  const center = { x: 195, y: 400 };
  const before = { left: 45, top: 250, width: 300, height: 300 };
  const fraction = zoomAnchorFraction(center, before);
  assert.deepEqual(fraction, { x: 0.5, y: 0.5 });
  // Après un zoom x2 non recentré (modèle collé à gauche, défilement à 0)
  const after = { left: 8, top: 100, width: 600, height: 600 };
  assert.deepEqual(zoomScrollDelta(center, fraction, after), { x: 113, y: 0 });
});

test('zoom ancré sur un point (pincement, molette) : le point reste sous les doigts', () => {
  const point = { x: 100, y: 100 };
  const fraction = zoomAnchorFraction(point, { left: 0, top: 0, width: 400, height: 400 });
  const delta = zoomScrollDelta(point, fraction, { left: 0, top: 0, width: 800, height: 800 });
  assert.deepEqual(delta, { x: 100, y: 100 });
  assert.deepEqual(zoomAnchorFraction(point, { left: 0, top: 0, width: 0, height: 0 }), { x: 0.5, y: 0.5 });
});
