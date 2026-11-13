// LAB-253 : fond de l'écran de saisie du code, fond Pola ou image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSetupConfig, setupConfigToSave } from './kioskSetupScreen.js';

test('sans réglage : fond Pola, pas d\'image', () => {
  assert.deepEqual(normalizeSetupConfig(null), { bg_type: 'cream', bg_image_url: null });
  assert.deepEqual(normalizeSetupConfig({}), { bg_type: 'cream', bg_image_url: null });
});

test('anciens dégradé et couleur unie : affichés comme fond Pola', () => {
  for (const bg_type of ['gradient', 'solid']) {
    const cfg = { bg_type, bg_color_from: '#7c3aed', bg_color_to: '#3b82f6', bg_color: '#7c3aed', text_color: '#FFFFFF' };
    assert.equal(normalizeSetupConfig(cfg).bg_type, 'cream');
  }
});

test('image déjà enregistrée : reste choisie', () => {
  const cfg = { bg_type: 'image', bg_image_url: 'https://x/setup_background.jpg' };
  assert.deepEqual(normalizeSetupConfig(cfg), cfg);
});

test('enregistrement : plus aucun champ de couleur', () => {
  const saved = setupConfigToSave({ bg_type: 'gradient', bg_color_from: '#7c3aed', text_color: '#FFFFFF', bg_image_url: '' });
  assert.deepEqual(saved, { bg_type: 'cream', bg_image_url: null });
});

test('enregistrement : l\'image est gardée même avec le fond Pola choisi', () => {
  // Repasser sur « Image » plus tard retrouve l'image déjà envoyée.
  const saved = setupConfigToSave({ bg_type: 'cream', bg_image_url: 'https://x/a.jpg' });
  assert.deepEqual(saved, { bg_type: 'cream', bg_image_url: 'https://x/a.jpg' });
});
