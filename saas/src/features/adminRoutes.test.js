import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BORNES_TABS, SALES_TABS, SETTINGS_SECTIONS, pickTab, withParams } from './adminRoutes.js';

test('withParams : remplace, supprime, garde le fragment', () => {
  assert.equal(withParams('/p', '?a=1&b=2', '#h', { b: '3' }), '/p?a=1&b=3#h');
  assert.equal(withParams('/p', '?a=1&b=2', '', { a: null }), '/p?b=2');
  assert.equal(withParams('/p', '', '#h', {}, ''), '/p');
  assert.equal(withParams('/p'), '/p');
});

test('pickTab : onglet demandé s\'il existe, sinon le premier', () => {
  assert.equal(pickTab('devis', SALES_TABS), 'devis');
  assert.equal(pickTab('inconnu', ['devis', 'prospects']), 'devis');
  assert.equal(pickTab(null, BORNES_TABS), 'etat');
  assert.equal(pickTab('devis', []), null);
});

/** Fichiers source de src/ (hors tests), pour y relever les liens vers les Réglages. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

test('Réglages : chaque lien vers une section mène à une ancre du sommaire', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id);
  const anchors = new Set();
  for (const file of sourceFiles(fileURLToPath(new URL('..', import.meta.url)))) {
    for (const [, id] of readFileSync(file, 'utf8').matchAll(/\/admin\/reglages#([a-z-]+)/g)) anchors.add(id);
  }
  assert.ok(anchors.has('fonctionnalites') && anchors.has('services') && anchors.has('emails'), [...anchors].join(', '));
  for (const id of anchors) assert.ok(ids.includes(id), id);
});

test('Réglages et Bornes : sections et onglets du lot 4 (LAB-338)', () => {
  assert.deepEqual(SETTINGS_SECTIONS.map((s) => s.id),
    ['entreprise', 'offres', 'emails', 'editeur', 'galerie', 'fonctionnalites', 'services']);
  assert.deepEqual(BORNES_TABS, ['etat', 'ecrans', 'alertes', 'code', 'versions']);
});
