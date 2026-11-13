// Consentements photo de la borne dans l'admin (LAB-226).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPhotoConsentsTable, machineLabel, photoConsentsFileName, photoConsentsPurgeAt,
  photoConsentsRetentionLabel, toPhotoConsentsCsv,
} from './photoConsents.js';
import { PRIVATE_HISTORY } from '../../scripts/private-history.mjs';

const BOM = '﻿';
const LICENSES = [{ machine_id: 'PC-01', label: 'Borne noyer' }, { machine_id: 'PC-02', label: null }];

function consent(overrides) {
  return {
    id: 'c-1',
    event_id: 'ev-1',
    machine_id: 'PC-01',
    session_id: '11111111-2222-3333-4444-555555555555',
    consent_text: 'J\'accepte que mes photos soient utilisées par l\'organisateur.',
    consented_at: '2026-11-04T19:05:30Z',
    received_at: '2026-11-04T19:06:00Z',
    ...overrides,
  };
}

// ── Date de suppression (miroir de photo_consents_purge_at) ─────────────────────────────────

test('photoConsentsPurgeAt : expiration + 30 jours', () => {
  assert.equal(photoConsentsPurgeAt('2026-12-01T00:00:00+00:00'), '2026-12-31T00:00:00.000Z');
  // Fin février, année non bissextile
  assert.equal(photoConsentsPurgeAt('2027-02-01T00:00:00Z'), '2027-03-03T00:00:00.000Z');
  // Passage à l'heure d'été : 30 × 24 h, la base calcule en UTC
  assert.equal(photoConsentsPurgeAt('2027-03-15T10:00:00Z'), '2027-04-14T10:00:00.000Z');
});

test('photoConsentsPurgeAt : pas d\'expiration = jamais', () => {
  assert.equal(photoConsentsPurgeAt(null), null);
  assert.equal(photoConsentsPurgeAt(undefined), null);
  assert.equal(photoConsentsPurgeAt(''), null);
  assert.equal(photoConsentsPurgeAt('pas une date'), null);
});

test('photoConsentsRetentionLabel : date à venir, passée, ou aucune', () => {
  const now = new Date('2026-12-15T12:00:00Z');
  assert.equal(
    photoConsentsRetentionLabel('2026-12-01T00:00:00Z', now),
    'Suppression automatique à partir du 31/12/2026 (30 jours après l\'expiration des photos)',
  );
  assert.equal(
    photoConsentsRetentionLabel('2026-11-01T00:00:00Z', now),
    'Suppression automatique depuis le 01/12/2026 (30 jours après l\'expiration des photos)',
  );
  assert.equal(
    photoConsentsRetentionLabel(null, now),
    'Gardés jusqu\'à la suppression de l\'événement (les photos n\'expirent pas)',
  );
});

test('photoConsentsRetentionLabel : date affichée en heure de Paris', () => {
  // 23:30 UTC le 30/11 = 00:30 à Paris le 01/12
  assert.match(photoConsentsRetentionLabel('2026-10-31T23:30:00Z', new Date('2026-01-01T00:00:00Z')), /à partir du 01\/12\/2026/);
});

// ── Borne ───────────────────────────────────────────────────────────────────────────────────

test('machineLabel : nom de la licence, sinon identifiant', () => {
  assert.equal(machineLabel('PC-01', LICENSES), 'Borne noyer');
  assert.equal(machineLabel('PC-02', LICENSES), 'PC-02');
  assert.equal(machineLabel('PC-99', LICENSES), 'PC-99');
  assert.equal(machineLabel('PC-01', undefined), 'PC-01');
  assert.equal(machineLabel(null, LICENSES), '');
});

// ── Tableau et CSV ──────────────────────────────────────────────────────────────────────────

test('buildPhotoConsentsTable : colonnes, heure de Paris, ordre chronologique', () => {
  const table = buildPhotoConsentsTable([
    consent({ id: 'c-2', consented_at: '2026-11-04T21:10:00Z', machine_id: 'PC-99', received_at: null }),
    consent({ id: 'c-1' }),
  ], { licenses: LICENSES });
  assert.deepEqual(table.header, [
    'Date et heure (Paris)', 'Horodatage UTC', 'Séance', 'Borne', 'Identifiant machine',
    'Texte accepté', 'Reçu par le serveur (Paris)', 'Identifiant du consentement',
  ]);
  assert.deepEqual(table.rows[0], [
    '04/11/2026 20:05', '2026-11-04T19:05:30Z', '11111111-2222-3333-4444-555555555555',
    'Borne noyer', 'PC-01', 'J\'accepte que mes photos soient utilisées par l\'organisateur.',
    '04/11/2026 20:06', 'c-1',
  ]);
  assert.equal(table.rows[1][0], '04/11/2026 22:10');
  assert.equal(table.rows[1][3], 'PC-99');
  assert.equal(table.rows[1][6], '');
  assert.equal(table.rows[1][7], 'c-2');
});

test('buildPhotoConsentsTable : même heure départagée par id, texte vide gardé vide, liste vide', () => {
  const table = buildPhotoConsentsTable([consent({ id: 'b' }), consent({ id: 'a', consent_text: '' })]);
  assert.deepEqual(table.rows.map((r) => r[7]), ['a', 'b']);
  assert.equal(table.rows[0][5], '');
  assert.deepEqual(buildPhotoConsentsTable([]).rows, []);
  assert.deepEqual(buildPhotoConsentsTable(null).rows, []);
});

test('toPhotoConsentsCsv : BOM, ;, CRLF, guillemets et retours à la ligne', () => {
  const csv = toPhotoConsentsCsv(buildPhotoConsentsTable([
    consent({ consent_text: 'J\'accepte ; photos "souvenir"\net réseaux' }),
  ], { licenses: LICENSES }));
  assert.ok(csv.startsWith(BOM));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Date et heure (Paris);Horodatage UTC;Séance;Borne;Identifiant machine;Texte accepté;Reçu par le serveur (Paris);Identifiant du consentement');
  assert.ok(csv.includes('"J\'accepte ; photos ""souvenir""\net réseaux"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('toPhotoConsentsCsv : protection contre l\'injection de formules', () => {
  const csv = toPhotoConsentsCsv(buildPhotoConsentsTable([
    consent({ consent_text: '=HYPERLINK("http://x")', machine_id: '+PC', session_id: '@s' }),
  ]));
  const row = csv.slice(1).split('\r\n')[1];
  assert.ok(row.includes('"\'=HYPERLINK(""http://x"")"'));
  assert.ok(row.includes(';\'+PC;'));
  assert.ok(row.includes(';\'@s;'));
  assert.ok(!/;[=+\-@]/.test(row));
});

test('photoConsentsFileName : slug et date de l\'événement, sinon du jour', () => {
  assert.equal(
    photoConsentsFileName({ name: 'Mariage Léa & Tom', start_date: '2026-11-04T14:00:00Z' }),
    'consentements-photo-mariage-lea-tom-2026-11-04.csv',
  );
  assert.equal(
    photoConsentsFileName({ access_code: 'ABC123' }, new Date('2026-11-04T23:30:00Z')),
    'consentements-photo-abc123-2026-11-05.csv',
  );
  assert.equal(photoConsentsFileName(null, new Date('2026-06-01T10:00:00Z')), 'consentements-photo-evenement-2026-06-01.csv');
});

test('photoConsentsPurgeAt : même délai que photo_consents_purge_at (migration LAB-223)', { skip: PRIVATE_HISTORY }, () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261126000000_kiosk_photo_consent.sql', import.meta.url), 'utf8');
  const fn = sql.slice(sql.indexOf('FUNCTION public.photo_consents_purge_at('));
  assert.match(fn.slice(0, fn.indexOf('$$;')), /SELECT p_expires_at \+ interval '30 days';/);
  assert.equal(photoConsentsPurgeAt('2026-01-01T00:00:00Z'), '2026-01-31T00:00:00.000Z');
});
