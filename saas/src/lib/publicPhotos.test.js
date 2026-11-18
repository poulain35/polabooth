import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePublicPhotos, PUBLIC_PHOTOS_RPC, withDownloadUrls } from './publicPhotos.js';

test('parsePublicPhotos : réponse vide ou inattendue → tableau vide', () => {
  assert.deepEqual(parsePublicPhotos(null), []);
  assert.deepEqual(parsePublicPhotos(undefined), []);
  assert.deepEqual(parsePublicPhotos({}), []);
  assert.deepEqual(parsePublicPhotos('x'), []);
  assert.deepEqual(parsePublicPhotos([]), []);
});

test('parsePublicPhotos : conserve les photos dans l\'ordre, écarte les lignes sans id', () => {
  const a = { id: 'p1', photo_url: 'https://cdn/a.jpg', source: 'kiosk' };
  const b = { id: 'p2', photo_url: 'https://cdn/b.jpg', source: 'guest', width: 800, height: 600 };
  assert.deepEqual(parsePublicPhotos([a, null, { photo_url: 'x' }, b]), [a, b]);
});

test('withDownloadUrls : URL présignée de get-photos, à défaut photo_url', () => {
  const photos = [{ id: 'p1', photo_url: 'https://cdn/a.jpg' }, { id: 'p2', photo_url: 'https://cdn/b.jpg' }];
  assert.deepEqual(withDownloadUrls(photos, { p1: 'https://r2/signed' }), [
    { id: 'p1', photo_url: 'https://cdn/a.jpg', download_url: 'https://r2/signed' },
    { id: 'p2', photo_url: 'https://cdn/b.jpg', download_url: 'https://cdn/b.jpg' },
  ]);
  assert.deepEqual(withDownloadUrls(photos), photos.map((p) => ({ ...p, download_url: p.photo_url })));
});

const fnSource = (src, fn) => {
  const start = src.indexOf(`export async function ${fn}(`);
  assert.ok(start >= 0, `${fn} introuvable`);
  const end = src.indexOf('\nexport ', start + 1);
  return src.slice(start, end === -1 ? undefined : end);
};

// Garde-fou : plus aucune lecture anon directe de `photos` dans les fonctions publiques du front.
test('api/photos.js : galerie et diaporama lisent les photos via la RPC get_public_photos', () => {
  const src = readFileSync(new URL('./api/photos.js', import.meta.url), 'utf8');
  assert.equal(PUBLIC_PHOTOS_RPC, 'get_public_photos');
  assert.match(fnSource(src, 'fetchPublicPhotos'), /rpc\(PUBLIC_PHOTOS_RPC, \{ p_code: code \}\)/);

  const byCode = fnSource(src, 'fetchPhotosByAccessCode');
  assert.match(byCode, /fetchPublicPhotos\(code\)/);
  assert.doesNotMatch(byCode, /from\(['"]photos['"]\)/);
  assert.doesNotMatch(byCode, /fetchPhotos\(/, 'fetchPhotos (lecture directe, admin) ne sert plus aux pages publiques');
});

test('middleware Open Graph : RPC get_public_photos limitée à 1, plus de /rest/v1/photos', () => {
  const src = readFileSync(new URL('../../middleware.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /rest\/v1\/photos/);
  assert.match(src, /rest\/v1\/rpc\/get_public_photos/);
  assert.match(src, /p_limit: 1/);
});
