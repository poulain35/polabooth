// LAB-269 : installeur PolaKiosk envoyé sur R2 / S3 par URL présignée (au lieu de Supabase Storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_RELEASE_BYTES, RELEASE_CONTENT_TYPE, releaseStoragePath, resolveReleaseUpload, UPLOAD_URL_TTL_SECONDS,
} from './releaseUpload.ts';

const MB = 1024 * 1024;
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('chemin : releases/setup-polakiosk-<version>.exe', () => {
  assert.equal(releaseStoragePath('1.2.3'), 'releases/setup-polakiosk-1.2.3.exe');
});

test('installeur de 95 Mo accepté (au-delà des 50 Mo de Supabase Storage)', () => {
  assert.deepEqual(resolveReleaseUpload({ version: ' 1.0.16 ', content_length: 95 * MB }), {
    ok: true,
    version: '1.0.16',
    storagePath: 'releases/setup-polakiosk-1.0.16.exe',
    contentType: 'application/octet-stream',
    contentLength: 95 * MB,
  });
  assert.equal(RELEASE_CONTENT_TYPE, 'application/octet-stream');
});

test('version : format 1.2.3 exigé, sinon 400', () => {
  for (const version of [undefined, null, '', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '../1.2.3', '1.2.3/../x', 123]) {
    const res = resolveReleaseUpload({ version, content_length: MB });
    assert.equal(res.ok, false, String(version));
    if (!res.ok) {
      assert.equal(res.status, 400);
      assert.match(res.error, /Version invalide/);
    }
  }
});

test('taille : entier positif exigé, sinon 400', () => {
  for (const content_length of [undefined, null, 0, -1, 1.5, '1000', Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = resolveReleaseUpload({ version: '1.0.0', content_length });
    assert.equal(res.ok, false, String(content_length));
    if (!res.ok) assert.equal(res.status, 400);
  }
});

test('taille : 500 Mo au maximum, 413 au-delà', () => {
  assert.equal(MAX_RELEASE_BYTES, 500 * MB);
  assert.equal(resolveReleaseUpload({ version: '1.0.0', content_length: MAX_RELEASE_BYTES }).ok, true);
  const res = resolveReleaseUpload({ version: '1.0.0', content_length: MAX_RELEASE_BYTES + 1 });
  assert.deepEqual(res, { ok: false, status: 413, error: 'Installeur trop lourd (500 Mo au maximum).' });
});

test('URL valable 15 minutes', () => {
  assert.equal(UPLOAD_URL_TTL_SECONDS, 900);
});

test('index.ts : administrateur de l’application vérifié avant toute signature', () => {
  const guard = source.indexOf('requireAppAdmin(adminClient(), auth.user.id)');
  assert.ok(source.indexOf('authenticate(') > 0 && guard > source.indexOf('authenticate('));
  assert.ok(guard < source.indexOf('getSignedUrl('), 'garde avant la signature');
  assert.match(source, /if \(denied\) return denied;/);
});

test('index.ts : bucket et URL publique des photos, type et taille signés', () => {
  assert.match(source, /Bucket: photosBucket\(\)/);
  assert.match(source, /public_url: +`\$\{photosPublicBaseUrl\(\)\}\/\$\{upload\.storagePath\}`/);
  assert.match(source, /ContentLength: upload\.contentLength/);
  assert.match(source, /signableHeaders: new Set\(\['content-length', 'content-type'\]\)/);
  assert.doesNotMatch(source, /app-releases/);
});
