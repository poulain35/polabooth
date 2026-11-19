// LAB-348 : images des modèles rangées dans le stockage, plus intégrées en data URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createImageStore, dataUrlToBytes, imageSourcesToStore, importedImagePlacement, isDataImage, isEphemeralImageUrl, maxImagePx,
  planPhotoEncoding, replaceImageSources, withCrossOrigin, PHOTO_KEEP_MAX_BYTES,
} from './designImages.js';

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`;
const jpg = 'data:image/jpeg;base64,/9j/4AAQ';
const svg = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';
const replicate = 'https://replicate.delivery/xezq/abc/out-0.png';
const stored = 'https://x.supabase.co/storage/v1/object/public/designs/templates/images/aa.png';

// Modèle avec une photo importée, une décoration dans un groupe et une image détourée masquée.
const state = {
  bg: '#ffffff',
  bgType: 'solid',
  objects: [
    { type: 'rect', isPhotoZone: true },
    { type: 'image', src: png, left: 10 },
    { type: 'group', objects: [{ type: 'image', src: jpg }, { type: 'group', objects: [{ type: 'image', src: png }] }] },
    { type: 'image', src: stored, clipPath: { type: 'image', src: jpg } },
    { type: 'image', src: replicate, isAIBackground: true },
    { type: 'textbox', text: 'data:image/png;base64,pas une image' },
  ],
};

test('repérage : data URL et adresse Replicate, groupes et masques compris, sans doublon', () => {
  assert.ok(isDataImage(png) && isDataImage('DATA:image/webp;base64,x'));
  assert.ok(!isDataImage(stored) && !isDataImage(null) && !isDataImage('data:text/plain,x'));
  assert.ok(isEphemeralImageUrl(replicate) && isEphemeralImageUrl('https://pbxt.replicate.delivery/a.png'));
  assert.ok(!isEphemeralImageUrl(stored) && !isEphemeralImageUrl('https://evilreplicate.delivery.example.com/a'));
  assert.deepEqual(imageSourcesToStore(state), [png, jpg, replicate]);
  assert.deepEqual(imageSourcesToStore({}), []);
});

test('remplacement : adresses posées partout, crossOrigin anonyme, état d’origine intact', () => {
  const before = JSON.stringify(state);
  const out = replaceImageSources(state, new Map([[png, 'https://s/p.png'], [jpg, 'https://s/j.jpg'], [replicate, 'https://s/r.png']]));
  assert.equal(JSON.stringify(state), before, 'pas de mutation');
  assert.deepEqual(imageSourcesToStore(out), []);
  assert.equal(JSON.stringify(out).includes('data:image/png;base64,iVBOR'), false);
  assert.deepEqual(out.objects[1], { type: 'image', src: 'https://s/p.png', left: 10, crossOrigin: 'anonymous' });
  assert.equal(out.objects[2].objects[1].objects[0].src, 'https://s/p.png');
  assert.equal(out.objects[2].objects[1].objects[0].crossOrigin, 'anonymous');
  assert.equal(out.objects[3].clipPath.src, 'https://s/j.jpg');
  assert.equal(out.objects[3].src, stored, 'adresse déjà rangée inchangée');
  assert.equal(out.objects[4].isAIBackground, true);
  assert.equal(out.bg, '#ffffff');
  // Source inconnue : gardée intégrée (repli).
  const partial = replaceImageSources(state, { [jpg]: 'https://s/j.jpg' });
  assert.deepEqual(imageSourcesToStore(partial), [png, replicate]);
});

test('crossOrigin : toute image distante, à toute profondeur, data URL laissées telles quelles', () => {
  const out = withCrossOrigin([
    { type: 'image', src: stored },
    { type: 'group', objects: [{ type: 'image', src: 'http://h/a.png' }, { type: 'image', src: png }] },
    { type: 'rect', clipPath: { type: 'image', src: stored } },
  ]);
  assert.equal(out[0].crossOrigin, 'anonymous');
  assert.equal(out[1].objects[0].crossOrigin, 'anonymous');
  assert.equal(out[1].objects[1].crossOrigin, undefined);
  assert.equal(out[2].clipPath.crossOrigin, 'anonymous');
  assert.deepEqual(withCrossOrigin(undefined), []);
});

test('data URL → octets (base64 et URL-encodée)', () => {
  const { bytes, mime } = dataUrlToBytes(png);
  assert.equal(mime, 'image/png');
  assert.deepEqual([...bytes], PNG_BYTES);
  const svgOut = dataUrlToBytes(svg);
  assert.equal(svgOut.mime, 'image/svg+xml');
  assert.equal(new TextDecoder().decode(svgOut.bytes), '<svg/>');
  assert.throws(() => dataUrlToBytes('pas une data url'));
});

test('photos : réduites à la résolution d’export du format, gardées telles quelles sinon', () => {
  assert.equal(maxImagePx({ exportWidth: 2400, exportHeight: 3600 }), 3600);
  assert.equal(maxImagePx({ exportWidth: 1920, exportHeight: 1080 }), 1920);
  assert.equal(maxImagePx(null), 3600);
  // Photo de téléphone 4032×3024 en 10×15 : réduite à 3600 px, JPEG.
  assert.deepEqual(planPhotoEncoding({ type: 'image/jpeg', size: 3e6, width: 4032, height: 3024, maxPx: 3600 }),
    { keep: false, width: 3600, height: 2700, type: 'image/jpeg' });
  // Petite photo : fichier d'origine gardé (pas de perte de qualité).
  assert.deepEqual(planPhotoEncoding({ type: 'image/jpeg', size: 1e6, width: 1600, height: 1200, maxPx: 3600 }),
    { keep: true, width: 1600, height: 1200, type: 'image/jpeg' });
  // PNG transparent trop grand : reste PNG ; PNG opaque : passe en JPEG.
  assert.equal(planPhotoEncoding({ type: 'image/png', size: 2e6, width: 5000, height: 5000, maxPx: 3600 }).type, 'image/png');
  assert.equal(planPhotoEncoding({ type: 'image/png', size: 2e6, width: 5000, height: 5000, maxPx: 3600, hasAlpha: false }).type, 'image/jpeg');
  // Trop lourd sans être trop grand : réencodé à la même taille.
  assert.deepEqual(planPhotoEncoding({ type: 'image/jpeg', size: PHOTO_KEEP_MAX_BYTES + 1, width: 3000, height: 2000, maxPx: 3600 }),
    { keep: false, width: 3000, height: 2000, type: 'image/jpeg' });
  // GIF, HEIC… : réencodés (le stockage n'accepte que PNG, JPEG, WebP).
  assert.equal(planPhotoEncoding({ type: 'image/gif', size: 1000, width: 100, height: 100, maxPx: 3600 }).keep, false);
});

test('magasin : un envoi par source, réutilisé ; échec = image gardée intégrée puis réessayée', async () => {
  const sent = [];
  let fail = 0;
  const store = createImageStore({
    upload: async (bytes, mime) => {
      sent.push(mime);
      if (fail > 0) { fail--; throw new Error('réseau'); }
      return `https://s/${sent.length}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    },
    fetchBytes: async () => ({ bytes: Uint8Array.from(PNG_BYTES), mime: 'image/png' }),
  });

  const [a, b] = await Promise.all([store.store(png), store.store(png)]);
  assert.equal(a, 'https://s/1.png');
  assert.equal(b, a);
  assert.equal(sent.length, 1, 'envoyée une seule fois');
  assert.equal(store.lookup(png), a);

  const { state: out, failed } = await store.resolveState(state);
  assert.equal(failed, 0);
  assert.deepEqual(imageSourcesToStore(out), []);
  assert.equal(out.objects[4].src, 'https://s/3.png', 'fond IA rangé');

  // Deux échecs (essai + nouvel essai) : null, l'image reste intégrée ; réessayée ensuite.
  const other = 'data:image/webp;base64,UklGRg==';
  fail = 2;
  const failedState = await store.resolveState({ objects: [{ type: 'image', src: other }] });
  assert.equal(failedState.failed, 1);
  assert.equal(failedState.state.objects[0].src, other);
  assert.match(await store.store(other), /^https:\/\/s\//);

  // Types refusés (SVG) et adresses déjà rangées : rien n'est envoyé.
  const count = sent.length;
  assert.equal(await store.store(svg), null);
  assert.equal(await store.store(stored), null);
  assert.equal(sent.length, count);
});

test('magasin : une réponse qui n’est pas une adresse https est un échec', async () => {
  const store = createImageStore({ upload: async () => 'data:image/png;base64,xx', retries: 0 });
  assert.equal(await store.store(png), null);
  const noFetch = createImageStore({ upload: async () => stored });
  assert.equal(await noFetch.store(replicate), null, 'adresse temporaire sans fetchBytes : laissée');
});

test('image importée aux proportions de la page : pleine page, pixels gardés', () => {
  const portrait = { canvasWidth: 400, canvasHeight: 600, exportWidth: 2400, exportHeight: 3600 };
  const full = importedImagePlacement(2400, 3600, portrait);
  assert.deepEqual(full, { left: 0, top: 0, scale: 400 / 2400, fullPage: true });
  // À l'export (×6), l'image fait exactement 2400×3600 : aucun agrandissement.
  assert.equal(2400 * full.scale * (portrait.exportWidth / portrait.canvasWidth), 2400);
  // 1 % d'écart : couvre toute la page, centrée.
  const near = importedImagePlacement(2400, 3636, portrait);
  assert.equal(near.fullPage, true);
  assert.ok(near.left === 0 && near.top < 0 && 3636 * near.scale >= 600);
  assert.equal(importedImagePlacement(1200, 3600, { canvasWidth: 200, canvasHeight: 600 }).fullPage, true);
});

test('image importée d’autres proportions : réduite à 60 % de la largeur, comme avant', () => {
  const portrait = { canvasWidth: 400, canvasHeight: 600 };
  assert.deepEqual(importedImagePlacement(1000, 1000, portrait), { left: 50, top: 50, scale: 0.24, fullPage: false });
  assert.deepEqual(importedImagePlacement(100, 50, portrait), { left: 50, top: 50, scale: 1, fullPage: false });
  assert.equal(importedImagePlacement(3600, 2400, portrait).fullPage, false);
});
