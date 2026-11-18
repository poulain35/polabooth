import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES } from './catalog.js';
import { moduleRequestMailto, onDemandModules } from './onDemandModules.js';
import { VENDOR_EMAIL } from '../lib/vendorRequest.js';

const PRIVATE_IDS = FEATURES.filter((f) => f.visibility === 'private').map((f) => f.id);

test('liste : fonctionnalités privées non installées, ni socle ni ouvertes', () => {
  const none = onDemandModules(new Set());
  assert.deepEqual(none.map((f) => f.id), PRIVATE_IDS);
  assert.ok(none.length > 0);
  assert.ok(none.every((f) => !f.core && f.visibility === 'private'));
  assert.ok(none.some((f) => f.id === 'ai_visuals') && none.some((f) => f.id === 'assistant'));

  const some = onDemandModules(new Set(['ai_visuals', 'assistant']));
  assert.deepEqual(some.map((f) => f.id), PRIVATE_IDS.filter((id) => !['ai_visuals', 'assistant'].includes(id)));
});

test('liste : vide quand tous les modules sont installés (groupe masqué)', () => {
  assert.deepEqual(onDemandModules(new Set(PRIVATE_IDS)), []);
});

test('liste : catalogue fourni (socle privé exclu)', () => {
  const features = [
    { id: 'a', core: false, visibility: 'private' },
    { id: 'b', core: true, visibility: 'private' },
    { id: 'c', core: false, visibility: 'open' },
  ];
  assert.deepEqual(onDemandModules(new Set(), features).map((f) => f.id), ['a']);
});

test('lien : mailto du module, sujet et texte de la demande', () => {
  const feature = FEATURES.find((f) => f.id === 'ai_visuals');
  const link = moduleRequestMailto(feature, { origin: 'https://photobooth.exemple.fr', version: 'abc1234' });
  const [head, query] = link.split('?');
  assert.equal(head, `mailto:${VENDOR_EMAIL}`);
  const params = new URLSearchParams(query.replace(/\+/g, '%2B'));
  assert.equal(params.get('subject'), 'Polabooth : demande du module IA visuelle');
  assert.equal(params.get('body'), [
    'Outil demandé : IA visuelle',
    'Sujet : module ai_visuals',
    'Message : (aucun)',
    'Instance : https://photobooth.exemple.fr',
    'Version : abc1234',
  ].join('\r\n'));
});
