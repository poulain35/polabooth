// LAB-227 : miniature des impressions retrouvée par la photo de la séance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionIdFromStoragePath, sessionsNeedingThumbnail, withPrintThumbnails } from './printThumbnails.js';

const S1 = '0b9c6a52-1f3e-4c8a-9d2e-5a7b8c9d0e1f';
const S2 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

test('numéro de séance lu dans le chemin R2 du kiosk', () => {
  assert.equal(sessionIdFromStoragePath(`photos/mariage-ab12cd34/${S1}/photo_1.jpg`), S1);
  assert.equal(sessionIdFromStoragePath(`photos/mariage-ab12cd34/${S1.toUpperCase()}/photo_1.jpg`), S1);
  assert.equal(sessionIdFromStoragePath('uploads/evt/guest.jpg'), null);
  assert.equal(sessionIdFromStoragePath(`photos/x/${S1}/sous/dossier.jpg`), null);
  assert.equal(sessionIdFromStoragePath(null), null);
});

test('séances à compléter : composite_url vide et session_id présent, sans doublon', () => {
  const logs = [
    { id: 1, session_id: S1, composite_url: null },
    { id: 2, session_id: S1, composite_url: null },
    { id: 3, session_id: S2, composite_url: 'https://r2/ancienne.jpg' },
    { id: 4, session_id: null, composite_url: null },
  ];
  assert.deepEqual(sessionsNeedingThumbnail(logs), [S1]);
  assert.deepEqual(sessionsNeedingThumbnail(null), []);
});

test('miniature : photo de la séance, composite_url existant gardé, première photo gagne', () => {
  const logs = [
    { id: 1, session_id: S1, composite_url: null },
    { id: 2, session_id: S2, composite_url: 'https://r2/ancienne.jpg' },
    { id: 3, session_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', composite_url: null },
    { id: 4, session_id: null, composite_url: null },
  ];
  const photos = [
    { storage_path: `photos/evt-ab12cd34/${S1}/b.jpg`, photo_url: 'https://r2/b.jpg', created_at: '2026-11-04T21:12:00Z' },
    { storage_path: `photos/evt-ab12cd34/${S1}/a.jpg`, photo_url: 'https://r2/a.jpg', created_at: '2026-11-04T21:10:00Z' },
    { storage_path: `photos/evt-ab12cd34/${S2}/c.jpg`, photo_url: 'https://r2/c.jpg', created_at: '2026-11-04T21:00:00Z' },
  ];
  const out = withPrintThumbnails(logs, photos);
  assert.equal(out[0].composite_url, 'https://r2/a.jpg');
  assert.equal(out[1].composite_url, 'https://r2/ancienne.jpg');
  assert.equal(out[2].composite_url, null);
  assert.equal(out[3].composite_url, null);
  assert.equal(out[1], logs[1], 'ligne inchangée renvoyée telle quelle');
  assert.equal(logs[0].composite_url, null, 'entrées non modifiées');
  assert.deepEqual(withPrintThumbnails(null, photos), []);
});

test('getEventPrintLogs : une seule requête photos, seulement si une miniature manque', () => {
  const src = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function getEventPrintLogs'), src.indexOf('/** Historique des alertes parc kiosk'));
  assert.equal((fn.match(/\.from\('photos'\)/g) ?? []).length, 1);
  assert.match(fn, /sessionsNeedingThumbnail\(logs\)/);
  assert.match(fn, /if \(sessions\.length === 0\) return logs;/);
  assert.match(fn, /withPrintThumbnails\(logs, photos/);
  assert.doesNotMatch(fn, /for \(|\.map\(\s*async|Promise\.all/, 'pas de requête par ligne');
});
