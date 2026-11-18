// LAB-358 : règles du stock de matériel, et accord avec le miroir de l'admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as server from './equipment.ts';
// @ts-ignore module JS de l'admin, sans types
import * as client from '../../../src/lib/equipment.js';

const TYPES = [
  { id: 't1', key: 'borne-photo', label: 'Borne photo', is_default: true, sort_order: 0, archived_at: null },
  { id: 't2', key: 'livre-or-audio', label: "Livre d'or audio", is_default: false, sort_order: 1, archived_at: null },
  { id: 't3', key: 'videobooth', label: 'Vidéobooth', is_default: false, sort_order: 2, archived_at: null },
  { id: 't4', key: 'ancien', label: 'Ancien', is_default: false, sort_order: 3, archived_at: '2026-01-01T00:00:00Z' },
];

const ITEMS = [
  { id: 'a', type_id: 't1', status: 'in_service', unavailable_from: null, unavailable_until: null },
  { id: 'b', type_id: 't1', status: 'in_service', unavailable_from: '2026-11-20', unavailable_until: '2026-11-24' },
  { id: 'c', type_id: 't1', status: 'in_service', unavailable_from: '2026-11-20', unavailable_until: null },
  { id: 'd', type_id: 't1', status: 'retired', unavailable_from: null, unavailable_until: null },
  { id: 'e', type_id: 't2', status: 'retired', unavailable_from: null, unavailable_until: null },
  { id: 'f', type_id: 't3', status: 'in_service', unavailable_from: null, unavailable_until: null },
  { id: 'g', type_id: 't3', status: 'in_service', unavailable_from: null, unavailable_until: null },
  { id: 'h', type_id: 't4', status: 'in_service', unavailable_from: null, unavailable_until: null },
];

test('slugifyTypeKey : minuscules sans accents, tirets, 40 caractères', () => {
  assert.equal(server.slugifyTypeKey('Borne photo'), 'borne-photo');
  assert.equal(server.slugifyTypeKey("Livre d'or audio"), 'livre-d-or-audio');
  assert.equal(server.slugifyTypeKey('  Vidéobooth  '), 'videobooth');
  assert.equal(server.slugifyTypeKey('Cœur & Âme — Été 2027'), 'coeur-ame-ete-2027');
  assert.equal(server.slugifyTypeKey('!!!'), '');
  assert.equal(server.slugifyTypeKey(42), '');
  const long = server.slugifyTypeKey('Caravane photobooth vintage avec éclairage néon intégré');
  assert.ok(long.length <= 40 && server.isValidTypeKey(long), long);
  for (const label of ['Borne photo', "Livre d'or audio", 'Cabine photo', 'Vidéobooth', 'Caravane photobooth']) {
    assert.ok(server.isValidTypeKey(server.slugifyTypeKey(label)), label);
  }
});

test('normalizeNeeds : entiers de 1 à 50, clés valides, filtre des clés connues', () => {
  assert.deepEqual(server.normalizeNeeds({ 'borne-photo': 2, 'livre-or-audio': '1' }), { 'borne-photo': 2, 'livre-or-audio': 1 });
  assert.deepEqual(server.normalizeNeeds({ 'borne-photo': 0 }), {});
  assert.deepEqual(server.normalizeNeeds({ 'borne-photo': 51, a: -1, b: 1.5, c: 'x', 'Pas Bon': 1 }), {});
  assert.deepEqual(server.normalizeNeeds({ 'borne-photo': 50 }), { 'borne-photo': 50 });
  assert.deepEqual(server.normalizeNeeds({ 'borne-photo': 1, ancien: 1 }, ['borne-photo']), { 'borne-photo': 1 });
  for (const v of [null, undefined, [], [1], 'x', 3]) assert.deepEqual(server.normalizeNeeds(v), {});
});

test('addNeeds : somme, avec un facteur', () => {
  assert.deepEqual(server.addNeeds({ 'borne-photo': 1 }, { 'borne-photo': 1, 'livre-or-audio': 1 }), { 'borne-photo': 2, 'livre-or-audio': 1 });
  assert.deepEqual(server.addNeeds({}, { 'borne-photo': 1 }, 2), { 'borne-photo': 2 });
  assert.deepEqual(server.addNeeds(null, { 'borne-photo': 1 }, 0), {});
  assert.deepEqual(server.addNeeds({ 'borne-photo': 3 }, null), { 'borne-photo': 3 });
});

test('eventNeeds : null = 1 du type par défaut, {} = rien', () => {
  assert.deepEqual(server.eventNeeds({ equipment_needs: null }, 'borne-photo'), { 'borne-photo': 1 });
  assert.deepEqual(server.eventNeeds({}, 'borne-photo'), { 'borne-photo': 1 });
  assert.deepEqual(server.eventNeeds({ equipment_needs: null }, null), {});
  assert.deepEqual(server.eventNeeds({ equipment_needs: {} }, 'borne-photo'), {});
  assert.deepEqual(server.eventNeeds({ equipment_needs: { 'livre-or-audio': 1 } }, 'borne-photo'), { 'livre-or-audio': 1 });
  assert.equal(server.defaultTypeKey(TYPES), 'borne-photo');
  assert.equal(server.defaultTypeKey([{ ...TYPES[0], archived_at: '2026-01-01' }]), null);
});

test('stockOn : période du 20/11 au 24/11 comprise, bornes comprises', () => {
  const item = { type_key: 'x', status: 'in_service', unavailable_from: '2026-11-20', unavailable_until: '2026-11-24' };
  assert.equal(server.stockOn([item], 'x', '2026-11-19'), 1);
  for (const d of ['2026-11-20', '2026-11-22', '2026-11-24']) assert.equal(server.stockOn([item], 'x', d), 0, d);
  assert.equal(server.stockOn([item], 'x', '2026-11-25'), 1);
});

test('stockOn : à partir du 20/11 sans fin, jamais compté ensuite, même en 2027', () => {
  const item = { type_key: 'x', status: 'in_service', unavailable_from: '2026-11-20', unavailable_until: null };
  assert.equal(server.stockOn([item], 'x', '2026-11-19'), 1);
  for (const d of ['2026-11-20', '2026-12-31', '2027-06-12', '2030-01-01']) assert.equal(server.stockOn([item], 'x', d), 0, d);
});

test('stockOn : retirés jamais comptés, clé par type_id, horodatage accepté', () => {
  assert.equal(server.stockOn(ITEMS, 'borne-photo', '2026-11-19', TYPES), 3);
  assert.equal(server.stockOn(ITEMS, 'borne-photo', '2026-11-22', TYPES), 1);
  assert.equal(server.stockOn(ITEMS, 'borne-photo', '2026-11-25T10:00:00Z', TYPES), 2);
  assert.equal(server.stockOn(ITEMS, 'livre-or-audio', '2026-11-19', TYPES), 0);
  assert.equal(server.stockOn(ITEMS, 'videobooth', '2026-11-19', TYPES), 2);
  assert.equal(server.stockOn(null, 'borne-photo', '2026-11-19'), 0);
});

test('trackedTypes : non archivés avec au moins un matériel non retiré', () => {
  assert.deepEqual(server.trackedTypes(TYPES, ITEMS).map((t) => t.key), ['borne-photo', 'videobooth']);
  assert.deepEqual(server.trackedTypes(TYPES, []), []);
  assert.deepEqual(server.trackedTypes([], ITEMS), []);
});

test("accord avec le miroir de l'admin", () => {
  assert.equal(server.TYPE_KEY_PATTERN.source, client.TYPE_KEY_PATTERN.source);
  assert.equal(server.TYPE_KEY_MAX_LENGTH, client.TYPE_KEY_MAX_LENGTH);
  assert.equal(server.MAX_NEED_QUANTITY, client.MAX_NEED_QUANTITY);
  for (const label of ['Borne photo', "Livre d'or audio", 'Cœur & Âme — Été', '', '---', 'Ça marche à 100 %']) {
    assert.equal(server.slugifyTypeKey(label), client.slugifyTypeKey(label), label);
  }
  const needs = [null, {}, { 'borne-photo': 2, x: 51, 'Pas Bon': 1, y: '3' }, [1]];
  for (const n of needs) {
    assert.deepEqual(server.normalizeNeeds(n), client.normalizeNeeds(n));
    assert.deepEqual(server.eventNeeds({ equipment_needs: n }, 'borne-photo'), client.eventNeeds({ equipment_needs: n }, 'borne-photo'));
    assert.deepEqual(server.addNeeds(n, { 'borne-photo': 1 }, 3), client.addNeeds(n, { 'borne-photo': 1 }, 3));
  }
  for (const d of ['2026-11-19', '2026-11-20', '2026-11-24', '2026-11-25', '2027-06-12']) {
    for (const t of TYPES) {
      assert.equal(server.stockOn(ITEMS, t.key, d, TYPES), client.stockOn(ITEMS, t.key, d, TYPES), `${t.key} ${d}`);
    }
  }
  assert.deepEqual(server.trackedTypes(TYPES, ITEMS), client.trackedTypes(TYPES, ITEMS));
});
