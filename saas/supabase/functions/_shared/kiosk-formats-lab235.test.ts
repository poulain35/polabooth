// LAB-235 (spec LAB-207, ticket 5) : affichage des formats animés côté SaaS.
// Email d'une animation (affiche + bouton, sans pièce jointe), RPC get_public_photos avec
// media_type (badges), et contrôles statiques de la galerie et du diaporama.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { isAnimatedMediaType, kioskEmailMedia, verifyKioskPhoto } from './kiosk-photo.ts';
import { renderKioskPhotoEmail } from './saas-emails.ts';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const EVENT = '3f2b8c1e-0000-4000-8000-000000000001';
const PHOTO_ID = '7c1d2e3f-0000-4000-8000-0000000000aa';
const MP4 = 'https://photos.example.com/photos/mariage-3f2b8c1e/seance/animation.mp4';
const POSTER = 'https://photos.example.com/photos/mariage-3f2b8c1e/seance/poster.jpg';
const JPG = 'https://photos.example.com/photos/mariage-3f2b8c1e/seance/composite.jpg';
const APP = 'https://photobooth.example.com/';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261202000000_public_photos_media_type.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const sql = strip(readPrivateHistory(new URL(MIGRATION, DIR)));
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const front = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
const fnSrc = readFileSync(new URL('../send-kiosk-photo/index.ts', import.meta.url), 'utf8');
const kioskEmailSrc = readFileSync(new URL('./kiosk-email.ts', import.meta.url), 'utf8');

function fakeDb(rows: Record<string, unknown>[]) {
  return {
    from() {
      const q = {
        selected: '',
        select(cols: string) { q.selected = cols; return q; },
        eq() { return q; },
        limit() { return q; },
        then(resolve: (v: unknown) => void) { resolve({ data: rows, error: null }); },
      };
      return q;
    },
  };
}

test('verifyKioskPhoto renvoie le type de média et l’affiche de la ligne photos', async () => {
  const row = { id: PHOTO_ID, media_type: 'gif', thumbnail_url: POSTER };
  const res = await verifyKioskPhoto({ db: fakeDb([row]), eventId: EVENT, photoUrl: MP4 });
  assert.deepEqual(res, { ok: true, photo: row });
});

test('types animés : gif, boomerang (et vidéo du lot 2) ; photo et inconnu = photo', () => {
  for (const t of ['gif', 'boomerang', 'video']) assert.equal(isAnimatedMediaType(t), true);
  for (const t of ['photo', 'testimonial', '', null, undefined]) assert.equal(isAnimatedMediaType(t), false);
});

test('email photo : inchangé (image et bouton vers la photo)', () => {
  const media = kioskEmailMedia({ photo: { id: PHOTO_ID, media_type: 'photo', thumbnail_url: null }, photoUrl: JPG, appUrl: APP, accessCode: 'K7M2PQ' });
  assert.deepEqual(media, { mediaType: 'photo', imageUrl: JPG, viewUrl: JPG, buttonLabel: 'Voir ma photo →' });
  assert.deepEqual(kioskEmailMedia({ photo: null, photoUrl: JPG }).viewUrl, JPG);

  const before = renderKioskPhotoEmail({ eventName: 'Soirée', photoUrl: JPG, message: 'Bonjour' });
  const after = renderKioskPhotoEmail({ eventName: 'Soirée', photoUrl: JPG, message: 'Bonjour', media });
  assert.equal(after, before);
  assert.match(after, /Voir ma photo →/);
  assert.match(after, new RegExp(`<img src="${JPG}"`));
});

test('email GIF / boomerang : affiche cliquable + « Voir mon animation » vers la galerie, sans via=qr', () => {
  for (const mediaType of ['gif', 'boomerang']) {
    const media = kioskEmailMedia({ photo: { id: PHOTO_ID, media_type: mediaType, thumbnail_url: POSTER }, photoUrl: MP4, appUrl: APP, accessCode: 'K7M2PQ' });
    const view = `https://photobooth.example.com/photos/K7M2PQ?photo=${PHOTO_ID}`;
    assert.deepEqual(media, { mediaType, imageUrl: POSTER, viewUrl: view, buttonLabel: '▶ Voir mon animation' });

    const html = renderKioskPhotoEmail({ eventName: 'Soirée', photoUrl: MP4, message: 'Bonjour', media });
    assert.match(html, /▶ Voir mon animation/);
    assert.doesNotMatch(html, /Voir ma photo/);
    assert.match(html, new RegExp(`<a href="${view.replace(/[?]/g, '\\?')}"[^>]*><img src="${POSTER}"`));
    assert.doesNotMatch(html, /\.mp4/, 'le fichier MP4 n’apparaît pas dans l’email');
    assert.doesNotMatch(html, /via=qr/);
  }
});

test('email animation sans affiche ni code : bouton seul, repli sur le fichier', () => {
  const media = kioskEmailMedia({ photo: { id: PHOTO_ID, media_type: 'boomerang', thumbnail_url: null }, photoUrl: MP4, appUrl: APP, accessCode: null });
  assert.equal(media.imageUrl, null);
  assert.equal(media.viewUrl, MP4);
  const html = renderKioskPhotoEmail({ eventName: 'Soirée', photoUrl: MP4, message: 'Bonjour', media });
  assert.doesNotMatch(html, /<img src="https:\/\/photos\.example\.com/);
  assert.match(html, /▶ Voir mon animation/);
});

test('email animation : nom, message, affiche et lien échappés', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderKioskPhotoEmail({
    eventName: evil, photoUrl: MP4, message: evil,
    media: { mediaType: 'gif', imageUrl: `${POSTER}"><script>`, viewUrl: `${APP}"><script>`, buttonLabel: '▶ Voir mon animation' },
  });
  assert.ok(!html.includes('<script>'));
});

test('send-kiosk-photo : lit access_code, construit le média, aucune pièce jointe', () => {
  assert.match(fnSrc, /\.select\('id, org_id, name, status, access_code, start_date, client_name, form_config'\)/);
  // Média et rendu dans _shared/kiosk-email.ts depuis LAB-300 (partagé avec l'aperçu de l'admin).
  assert.match(fnSrc, /photo: photoCheck\.photo, photoUrl: photo_url, appUrl: APP_URL/);
  assert.match(kioskEmailSrc, /kioskEmailMedia\(\{ photo: p\.photo, photoUrl: p\.photoUrl, appUrl: p\.appUrl, accessCode: p\.event\.access_code \}\)/);
  assert.match(kioskEmailSrc, /renderKioskPhotoEmail\(\{\s+eventName: p\.event\.name,\s+photoUrl: p\.photoUrl,[\s\S]*media,/);
  assert.doesNotMatch(fnSrc, /attachment/i);
  assert.doesNotMatch(kioskEmailSrc, /attachment/i);
});

test('migration : horodatage unique après LAB-233, SQL sans accent, rechargement du schéma', { skip: PRIVATE_HISTORY }, () => {
  const stamps = all.map((f) => f.slice(0, 14));
  assert.equal(new Set(stamps).size, stamps.length, 'horodatages uniques');
  assert.ok(MIGRATION > '20261201000000');
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/);
});

test('get_public_photos : media_type en plus, même périmètre, mêmes droits', { skip: PRIVATE_HISTORY }, () => {
  const body = flat(sql);
  assert.match(body, /DROP FUNCTION IF EXISTS public\.get_public_photos\(TEXT, INTEGER\);/);
  assert.match(body, /RETURNS TABLE \( id UUID, photo_url TEXT, thumbnail_url TEXT, storage_path TEXT, share_url TEXT, source TEXT, width INTEGER, height INTEGER, created_at TIMESTAMPTZ, media_type TEXT \)/);
  assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(body, /p\.created_at, p\.media_type FROM public\.events e JOIN public\.photos p ON p\.event_id = e\.id/);
  assert.match(body, /WHERE e\.access_code = UPPER\(TRIM\(p_code\)\) AND e\.status IN \('active', 'submitted'\) AND p\.status = 'approved'/);
  assert.match(body, /ORDER BY p\.created_at ASC, p\.id ASC LIMIT p_limit;/);
  assert.doesNotMatch(body, /event_id,|uploader_name|local_path/, 'pas de nouvelle donnée exposée');
  assert.match(body, /REVOKE ALL ON FUNCTION public\.get_public_photos\(TEXT, INTEGER\) FROM PUBLIC;/);
  assert.match(body, /GRANT EXECUTE ON FUNCTION public\.get_public_photos\(TEXT, INTEGER\) TO anon, authenticated, service_role;/);
});

test('galerie et diaporama : badges GIF / Boomerang, animation en boucle et sans son', () => {
  const gallery = front('pages/PhotoGallery.jsx');
  assert.match(gallery, /animatedMediaLabel\(photo\)/);
  assert.match(gallery, /animatedMediaLabel\(lightbox\)/);
  assert.match(gallery, /autoPlay\s+loop\s+muted\s+playsInline/);

  const slideshow = front('pages/Slideshow.jsx');
  assert.match(slideshow, /animatedMediaLabel\(photos\[activeIndex\]\)/);
  assert.match(slideshow, /<SlideVideo photo=\{photo\} active=\{i === activeIndex\} \/>/);
  assert.doesNotMatch(slideshow, /autoPlay=\{/, 'autoPlay ne joue qu’au montage : lecture pilotée par la diapositive active');
  assert.match(slideshow, /video\.play\(\)/);
  assert.match(slideshow, /video\.pause\(\)/);
  assert.match(slideshow, /muted\s+loop\s+playsInline/);
});
