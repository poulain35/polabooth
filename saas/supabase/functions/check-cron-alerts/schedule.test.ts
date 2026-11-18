// Tests du planning pg_cron : déclenchements prévus manqués (LAB-102, LAB-121, LAB-122).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSED_FIRES_CAP, missedFires } from './schedule.ts';
import { H, MIN, NOW } from './cron.fixture.ts';

test('déclenchements manqués : toutes les 5 min, horaire de jour, quotidien, hebdo, macro', () => {
  const since = Date.parse('2026-10-23T11:00:30Z');
  assert.equal(missedFires('*/5 * * * *', since, NOW), 12); // 11:05 → 12:00 (12:05 encore dans la grâce)
  assert.equal(missedFires('20 5-20 * * *', since, NOW), 1); // 11:20
  assert.equal(missedFires('0 8 * * *', since, NOW), 0);
  assert.equal(missedFires('0 8 * * *', Date.parse('2026-10-21T08:00:05Z'), NOW), 2); // 22 et 23 à 08:00
  assert.equal(missedFires('0 0 * * 1', Date.parse('2026-10-05T00:00:05Z'), NOW), 2); // lundis 12 et 19
  assert.equal(missedFires('@hourly', since, NOW), 1); // 12:00
});

test('déclenchements manqués : marge de grâce pour la latence de pg_cron', () => {
  const since = Date.parse('2026-10-23T11:00:05Z');
  assert.equal(missedFires('0 * * * *', since, Date.parse('2026-10-23T12:04:00Z')), 0);
  assert.equal(missedFires('0 * * * *', since, Date.parse('2026-10-23T12:05:00Z')), 1);
});

test('déclenchements manqués : syntaxe « N seconds » (intervalles écoulés après la grâce)', () => {
  assert.equal(missedFires('30 seconds', NOW - 6 * MIN, NOW), 2);
  assert.equal(missedFires('30 seconds', NOW - 5 * MIN - 59_000, NOW), 1);
  assert.equal(missedFires('30 seconds', NOW - 5 * MIN, NOW), 0);
});

test('déclenchements manqués : décompte plafonné, planning illisible → null', () => {
  assert.equal(missedFires('* * * * *', NOW - 30 * 24 * H, NOW), MISSED_FIRES_CAP);
  assert.equal(missedFires('n importe quoi', NOW - H, NOW), null);
  assert.equal(missedFires('61 * * * *', NOW - H, NOW), null);
});

// ── Planning décalé « 3-59/15 » (étude LAB-122) ─────────────────────────────

test('planning 3-59/15 : déclenchements à :03, :18, :33, :48', () => {
  const since = Date.parse('2026-10-23T11:00:30Z');
  assert.equal(missedFires('3-59/15 * * * *', since, NOW), 4); // 11:03, 11:18, 11:33, 11:48 (12:03 dans la grâce)
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-23T12:07:59Z')), 4);
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-23T12:08:00Z')), 5); // + 12:03
  // Écriture abrégée acceptée par evaluate.ts avec le même sens (pg_cron : préférer la forme explicite).
  assert.equal(missedFires('3/15 * * * *', since, NOW), 4);
});

test('planning 3-59/15 : passage d\'heure et de jour (23:48 → 00:03 → 00:18)', () => {
  const since = Date.parse('2026-10-23T23:48:01Z');
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-24T00:22:59Z')), 1); // 00:03
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-24T00:23:00Z')), 2); // 00:03, 00:18
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-24T00:07:59Z')), 0);
});
