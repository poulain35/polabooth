// LAB-232 (spec LAB-209, SAAS-1) : lien du QR code transmis à get-photos, admin propriétaire non compté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGalleryOwnerCheck, getPhotosUrl, qrLinkParams } from './galleryTracking.js';

const PHOTO = '9a7d6e5f-1111-4222-8333-444455556666';
const qs = (s) => new URLSearchParams(s);

test('qrLinkParams : via et photo seulement pour un lien de QR code', () => {
  assert.deepEqual(qrLinkParams(qs(`photo=${PHOTO}&via=qr`)), { via: 'qr', photo: PHOTO });
  assert.deepEqual(qrLinkParams(qs(`photo=${PHOTO}`)), {}, 'lien partagé depuis la galerie');
  assert.deepEqual(qrLinkParams(qs('via=qr')), {});
  assert.deepEqual(qrLinkParams(qs(`photo=${PHOTO}&via=email`)), {});
  assert.deepEqual(qrLinkParams(undefined), {});
});

test('getPhotosUrl : code seul par défaut, via et photo transmis ensemble', () => {
  const base = 'https://x.supabase.co/functions/v1';
  assert.equal(getPhotosUrl(base, 'AB CD'), `${base}/get-photos?code=AB+CD`);
  assert.equal(getPhotosUrl(base, 'ABCD', {}), `${base}/get-photos?code=ABCD`);
  assert.equal(getPhotosUrl(base, 'ABCD', { via: 'qr' }), `${base}/get-photos?code=ABCD`);
  assert.equal(getPhotosUrl(base, 'ABCD', { via: 'qr', photo: PHOTO }), `${base}/get-photos?code=ABCD&photo=${PHOTO}&via=qr`);
});

test('propriétaire : invité sans session compté, admin propriétaire non compté', async () => {
  const calls = [];
  const check = (userId, owns) => createGalleryOwnerCheck({
    getUserId: async () => userId,
    ownsEventByCode: async (code) => { calls.push(code); return owns; },
  });
  assert.equal(await check(null, true)('ABCD'), false);
  assert.deepEqual(calls, [], 'aucune requête sans session');
  assert.equal(await check('u1', true)('ABCD'), true);
  assert.equal(await check('u1', false)('ABCD'), false, 'connecté mais pas propriétaire : compté');
});

test('propriétaire : vérification en échec avec une session ouverte = non compté, sans rejet', async () => {
  const failing = createGalleryOwnerCheck({ getUserId: async () => 'u1', ownsEventByCode: async () => { throw new Error('réseau'); } });
  assert.equal(await failing('ABCD'), true);
  const noSession = createGalleryOwnerCheck({ getUserId: async () => { throw new Error('storage'); }, ownsEventByCode: async () => false });
  assert.equal(await noSession('ABCD'), true);
});

test('propriétaire : une seule requête par utilisateur et par code', async () => {
  let n = 0;
  let user = 'u1';
  const isOwner = createGalleryOwnerCheck({ getUserId: async () => user, ownsEventByCode: async () => { n += 1; return true; } });
  await Promise.all([isOwner('ABCD'), isOwner('ABCD'), isOwner('ABCD')]);
  assert.equal(n, 1);
  await isOwner('EFGH');
  user = 'u2';
  await isOwner('ABCD');
  assert.equal(n, 3);
});

// ── Branchement dans supabase.js et PhotoGallery.jsx ────────────────────────────────────────

const lib = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from) + 1));

test('supabase.js : trackGalleryEvent passe par la vérification propriétaire avant la RPC', () => {
  const fn = slice(lib, 'export function trackGalleryEvent', 'export async function fetchGalleryStats');
  assert.match(fn, /isGalleryOwner\(code\)\.then\(\(owner\) => \{\s+if \(owner\) return;\s+supabase\.rpc\('track_gallery_event'/);
  const owner = slice(lib, 'const isGalleryOwner = createGalleryOwnerCheck', 'export function trackGalleryEvent');
  assert.match(owner, /supabase\.auth\.getSession\(\)/);
  assert.match(owner, /\.from\('events'\)\.select\('id'\)\.eq\('access_code', code\.toUpperCase\(\)\.trim\(\)\)\.limit\(1\)/);
});

test('supabase.js : fetchPhotosByAccessCode transmet le lien du QR code à get-photos', () => {
  assert.match(lib, /export async function fetchPhotosByAccessCode\(code, link = \{\}\)/);
  assert.match(lib, /fetchPhotoDownloadUrls\(code, link\)/);
  assert.match(lib, /fetch\(getPhotosUrl\(FUNCTIONS_URL, code, link\)/);
});

test('PhotoGallery.jsx : via et photo au premier chargement seulement ; diaporama sans lien', () => {
  const page = readFileSync(new URL('../pages/PhotoGallery.jsx', import.meta.url), 'utf8');
  assert.match(page, /const qrLinkRef\s+= useRef\(qrLinkParams\(searchParams\)\);/);
  assert.match(page, /const link = qrLinkRef\.current;\s+qrLinkRef\.current = \{\};\s+fetchPhotosByAccessCode\(code, link\)/);
  const calls = [...page.matchAll(/fetchPhotosByAccessCode\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(calls.filter((c) => c !== 'code'), ['code, link'], 'rechargements après envoi d\'invité : sans lien');
  const slideshow = readFileSync(new URL('../pages/Slideshow.jsx', import.meta.url), 'utf8');
  for (const m of slideshow.matchAll(/fetchPhotosByAccessCode\(([^)]*)\)/g)) assert.equal(m[1], 'code');
});
