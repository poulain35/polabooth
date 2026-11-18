// LAB-348 : images des modèles rangées dans le bucket `designs`, nommées par leur SHA-256.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DesignImageError, MAX_IMAGE_BYTES, designImagePath, detectImageType, isAlreadyExistsError, sha256Hex,
  storeDesignImage,
} from './design-images.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const EVENT_ID = '0b9a5c1e-3f4d-4a2b-9c8d-7e6f5a4b3c2d';

test('type d’après les octets : PNG, JPEG, WebP ; le reste est refusé', () => {
  assert.deepEqual(detectImageType(PNG), { ext: 'png', contentType: 'image/png' });
  assert.deepEqual(detectImageType(JPEG), { ext: 'jpg', contentType: 'image/jpeg' });
  assert.deepEqual(detectImageType(WEBP), { ext: 'webp', contentType: 'image/webp' });
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const gif = new TextEncoder().encode('GIF89a......');
  const riffWav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
  for (const bytes of [svg, gif, riffWav, PNG.slice(0, 7), new Uint8Array()]) assert.equal(detectImageType(bytes), null);
});

test('chemins : dossier de l’événement ou dossier commun des modèles', () => {
  const sha = 'a'.repeat(64);
  assert.equal(designImagePath({ kind: 'event', eventId: EVENT_ID }, sha, 'png'), `${EVENT_ID}/images/${sha}.png`);
  assert.equal(designImagePath({ kind: 'event', eventId: EVENT_ID.toUpperCase() }, sha, 'jpg'), `${EVENT_ID}/images/${sha}.jpg`);
  assert.equal(designImagePath({ kind: 'templates' }, sha, 'webp'), `templates/images/${sha}.webp`);
  assert.equal(designImagePath({ kind: 'templatePreviews' }, sha, 'jpg'), `templates/previews/${sha}.jpg`);
  assert.throws(() => designImagePath({ kind: 'event', eventId: '../x' }, sha, 'png'));
  assert.throws(() => designImagePath({ kind: 'templates' }, 'abc', 'png'));
  assert.throws(() => designImagePath({ kind: 'templates' }, sha, 'svg'));
});

test('SHA-256 en hexadécimal', async () => {
  assert.equal(
    await sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('« existe déjà » reconnu (409 ou message), le reste non', () => {
  assert.ok(isAlreadyExistsError({ statusCode: '409', message: 'x' }));
  assert.ok(isAlreadyExistsError({ message: 'The resource already exists' }));
  assert.ok(isAlreadyExistsError({ error: 'Duplicate', message: '' }));
  assert.ok(!isAlreadyExistsError({ statusCode: '500', message: 'Internal' }));
  assert.ok(!isAlreadyExistsError(null));
});

function fakeDb(uploadError: unknown = null) {
  const calls: { bucket: string; path: string; opts: Record<string, unknown> }[] = [];
  return {
    calls,
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string, _bytes: Uint8Array, opts: Record<string, unknown>) => {
            calls.push({ bucket, path, opts });
            return { error: uploadError };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        };
      },
    },
  };
}

test('rangement : bucket designs, nom = empreinte, réécrit (date rafraîchie), adresse publique renvoyée', async () => {
  const db = fakeDb();
  const stored = await storeDesignImage(db, { kind: 'event', eventId: EVENT_ID }, PNG);
  const sha = await sha256Hex(PNG);
  assert.equal(stored.path, `${EVENT_ID}/images/${sha}.png`);
  assert.equal(stored.url, `https://x.supabase.co/storage/v1/object/public/designs/${EVENT_ID}/images/${sha}.png`);
  assert.equal(db.calls[0].bucket, 'designs');
  assert.equal(db.calls[0].opts.upsert, true);
  assert.equal(db.calls[0].opts.contentType, 'image/png');
});

test('rangement : image déjà présente = succès (idempotent)', async () => {
  const db = fakeDb({ statusCode: '409', message: 'The resource already exists' });
  const stored = await storeDesignImage(db, { kind: 'templates' }, JPEG);
  assert.match(stored.url, /\/designs\/templates\/images\/[0-9a-f]{64}\.jpg$/);
});

test('rangement : refus du type, de la taille et des erreurs du stockage', async () => {
  const status = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { return (e as DesignImageError).status; }
    return 0;
  };
  const db = fakeDb();
  assert.equal(await status(storeDesignImage(db, { kind: 'templates' }, new TextEncoder().encode('<svg/>'))), 415);
  assert.equal(await status(storeDesignImage(db, { kind: 'templates' }, new Uint8Array())), 400);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG);
  assert.equal(await status(storeDesignImage(db, { kind: 'templates' }, big)), 413);
  assert.equal(db.calls.length, 0, 'rien n’est envoyé au stockage');
  assert.equal(await status(storeDesignImage(fakeDb({ statusCode: '500', message: 'boom' }), { kind: 'templates' }, PNG)), 500);
});

const source = (fn: string) => readFileSync(fileURLToPath(new URL(`../${fn}/index.ts`, import.meta.url)), 'utf8');

test('upload-design-image : client par code (limites, événement actif, client_design), admin d’application', () => {
  const src = source('upload-design-image');
  assert.match(src, /publicGuard\('upload-design-image'/);
  assert.match(src, /LIMITS\.designImageIp, guard\.ip\]/);
  assert.match(src, /LIMITS\.designImageCode, accessCode\]/);
  assert.match(src, /LIMITS\.designImageCodeDay, accessCode\]/);
  // Événement par code (LAB-392, _shared/event-by-code.ts) : code inconnu compté, archivé ou expiré
  // refusé, fonctionnalité client_design exigée.
  assert.match(src, /eventByCode\(db, accessCode, \{[^}]*guard,[^;]*archived: closed,\s+expiry: \{ rule: 'template', refusal: closed \},\s+feature: 'client_design',/);
  assert.match(src, /requireAppAdmin\(db, auth\.user\.id\)/);
  // Autorisation avant la lecture du corps et le stockage.
  assert.ok(src.indexOf('requireAppAdmin(') < src.indexOf('req.arrayBuffer()'));
  assert.ok(src.indexOf('eventByCode(') < src.indexOf('storeDesignImage('));
});

test('upload-design-image : aperçu (?kind=preview) réservé à l’administrateur, refusé avec un code', () => {
  const src = source('upload-design-image');
  assert.match(src, /kind === 'preview' && accessCode\) return corsResponse\(400/);
  assert.match(src, /kind !== null && kind !== 'preview'\) return corsResponse\(400/);
  assert.match(src, /scope = kind === 'preview' \? \{ kind: 'templatePreviews' \} : \{ kind: 'templates' \}/);
  // Refus avant toute lecture de la base ou du corps.
  assert.ok(src.indexOf("kind === 'preview' && accessCode") < src.indexOf('publicGuard('));
});

test('remove-background : résultat rangé dans le stockage, data URI en repli', () => {
  const src = source('remove-background');
  assert.match(src, /storeDesignImage\(db, scope, bytes\)/);
  assert.match(src, /data:image\/png;base64,/);
});
