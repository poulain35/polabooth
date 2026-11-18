// LAB-395 : outils partagés (pluriel, bornage, dates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural, countLabel, clamp, formatDuration } from './format.js';
import { formatDate, formatDateTime, formatShortDate, formatTime, formatDateWith, PARIS_TIME_ZONE } from './dates.js';

test('plural et countLabel : pluriel à partir de 2', () => {
  assert.equal(plural(0, 'borne'), 'borne');
  assert.equal(plural(1, 'borne'), 'borne');
  assert.equal(plural(2, 'borne'), 'bornes');
  assert.equal(plural(3, 'invité a répondu', 'invités ont répondu'), 'invités ont répondu');
  assert.equal(countLabel(1, 'jour'), '1 jour');
  assert.equal(countLabel(4, 'action masquée', 'actions masquées'), '4 actions masquées');
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('dates : mêmes rendus que les anciennes fonctions', () => {
  const opts = { timeZone: PARIS_TIME_ZONE };
  const iso = '2026-11-16T13:05:00Z';
  assert.equal(formatDate(iso, opts), '16/11/2026');
  assert.equal(formatDate(iso, opts), new Date(iso).toLocaleDateString('fr-FR', opts));
  assert.equal(formatDateTime(iso, opts), '16/11/2026 14:05');
  assert.equal(formatDateTime(iso, opts), new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', ...opts }));
  assert.equal(formatShortDate(iso, opts), '16 nov. 2026');
  assert.equal(formatShortDate(iso, opts), new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium', ...opts }));
  assert.equal(formatTime(iso, opts), '14:05');
  assert.equal(formatDateWith(iso, { day: '2-digit', month: 'short', ...opts }), '16 nov.');
});

test('dates : vide ou invalide → null, jour seul lu à midi', () => {
  for (const v of [null, undefined, '', 'pas une date']) assert.equal(formatDate(v), null);
  assert.equal(formatDate('2026-11-16', { timeZone: PARIS_TIME_ZONE }), '16/11/2026');
  assert.equal(formatDate(new Date('2026-11-16T10:00:00Z'), { timeZone: PARIS_TIME_ZONE }), '16/11/2026');
});

test('formatDuration et repli des dates', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration('65'), '1:05');
  assert.equal(formatDuration(NaN, '—'), '—');
  assert.equal(formatDuration(Infinity), '0:00');
  assert.equal(formatDate(null, { fallback: '—' }), '—');
  assert.equal(formatDateTime('', { fallback: '' }), '');
});
