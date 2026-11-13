import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isActiveEventStatus, PHOTO_NOT_LINKED, verifyKioskPhoto } from './kiosk-photo.ts';

const EVENT = '3f2b8c1e-0000-4000-8000-000000000001';
const OTHER = '3f2b8c1e-0000-4000-8000-000000000002';
const SESSION = '9a7d6e5f-1111-4222-8333-444455556666';
// URL publique R2 renvoyée par get-kiosk-upload-url et enregistrée par kiosk_record_photo (LAB-213).
const KIOSK_URL = `https://photos.example.com/photos/mariage-3f2b8c1e/${SESSION}/composite_20261025_213000.jpg`;

type Row = { event_id: string; photo_url: string };
function fakeDb(rows: Row[], fail = false) {
  return {
    from(table: string) {
      assert.equal(table, 'photos');
      const filters: ((r: Row) => boolean)[] = [];
      const q = {
        select() { return q; },
        eq(col: keyof Row, v: string) { filters.push((r) => r[col] === v); return q; },
        limit() { return q; },
        then(resolve: (v: unknown) => void) {
          resolve(fail ? { data: null, error: { message: 'timeout' } } : { data: rows.filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return q;
    },
  };
}

test('événement actif : active et submitted uniquement (même filtre que kiosk_get_event)', () => {
  assert.equal(isActiveEventStatus('active'), true);
  assert.equal(isActiveEventStatus('submitted'), true);
  for (const s of ['archived', 'draft', '', null, undefined]) assert.equal(isActiveEventStatus(s), false);
});

test('photo rattachée par la table photos (ligne sans media_type : photo, sans affiche)', async () => {
  const res = await verifyKioskPhoto({ db: fakeDb([{ event_id: EVENT, photo_url: KIOSK_URL }]), eventId: EVENT, photoUrl: KIOSK_URL });
  assert.deepEqual(res, { ok: true, photo: { id: null, media_type: 'photo', thumbnail_url: null } });
});

test('refus : photo d’un autre événement, URL externe, ligne photos absente', async () => {
  const otherEventPhoto = await verifyKioskPhoto({ db: fakeDb([{ event_id: EVENT, photo_url: KIOSK_URL }]), eventId: OTHER, photoUrl: KIOSK_URL });
  assert.deepEqual(otherEventPhoto, { ok: false, status: 403, error: PHOTO_NOT_LINKED });

  const external = await verifyKioskPhoto({ db: fakeDb([]), eventId: EVENT, photoUrl: 'https://phishing.example/photo.jpg' });
  assert.deepEqual(external, { ok: false, status: 403, error: PHOTO_NOT_LINKED });

  const notRecorded = await verifyKioskPhoto({ db: fakeDb([]), eventId: EVENT, photoUrl: KIOSK_URL });
  assert.deepEqual(notRecorded, { ok: false, status: 403, error: PHOTO_NOT_LINKED });
});

test('base photos en panne : refus (plus de repli sur Supabase Storage)', async () => {
  const res = await verifyKioskPhoto({ db: fakeDb([], true), eventId: EVENT, photoUrl: KIOSK_URL });
  assert.deepEqual(res, { ok: false, status: 500, error: 'Vérification de la photo impossible' });
});

test('LAB-213 : send-kiosk-photo ne lit plus le bucket Supabase Storage photos', () => {
  const src = readFileSync(new URL('../send-kiosk-photo/index.ts', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('./kiosk-photo.ts', import.meta.url), 'utf8');
  for (const code of [src, shared]) {
    assert.doesNotMatch(code, /storage\s*\.\s*from\(/);
    assert.doesNotMatch(code, /storage\/v1/);
    assert.doesNotMatch(code, /objectExists/);
  }
  assert.match(src, /verifyKioskPhoto\(\{\s*db,\s*eventId: event\.id,\s*photoUrl: photo_url\s*\}\)/);
});
