import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePublicEvent, PUBLIC_EVENT_RPC } from './publicEvent.js';

test('parsePublicEvent : code inconnu ou réponse vide → null', () => {
  assert.equal(parsePublicEvent(null), null);
  assert.equal(parsePublicEvent(undefined), null);
  assert.equal(parsePublicEvent({}), null);
  assert.equal(parsePublicEvent('x'), null);
});

test('parsePublicEvent : événement, entreprise et config galerie', () => {
  const parsed = parsePublicEvent({
    id: 'e1', name: 'Mariage', company: 'Studio Exemple',
    gallery: { guest_upload_enabled: true, slideshow_enabled: false },
  });
  assert.deepEqual(parsed, {
    event: { id: 'e1', name: 'Mariage' },
    companyName: 'Studio Exemple',
    gallery: { guest_upload_enabled: true, slideshow_enabled: false },
    bookingBanner: true,
    eventType: '',
    branding: null,
  });
});

test('parsePublicEvent : champs absents → valeurs neutres', () => {
  assert.deepEqual(parsePublicEvent({ id: 'e1', name: null, company: null, gallery: null }), {
    event: { id: 'e1', name: '' },
    companyName: '',
    gallery: {},
    bookingBanner: true,
    eventType: '',
    branding: null,
  });
});

test('parsePublicEvent : bandeau réservation (LAB-130), seul un false explicite le désactive', () => {
  const base = { id: 'e1', name: 'Mariage' };
  assert.equal(parsePublicEvent({ ...base, booking_banner: false }).bookingBanner, false);
  assert.equal(parsePublicEvent({ ...base, booking_banner: true }).bookingBanner, true);
  assert.equal(parsePublicEvent({ ...base, booking_banner: null }).bookingBanner, true);
  assert.equal(parsePublicEvent(base).bookingBanner, true);
  assert.equal(parsePublicEvent({ ...base, event_type: 'mariage' }).eventType, 'mariage');
  assert.equal(parsePublicEvent({ ...base, event_type: 42 }).eventType, '');
});

test('parsePublicEvent : habillage (LAB-301/303), absent ou null → null, sinon refiltré', () => {
  const base = { id: 'e1', name: 'Mariage' };
  assert.equal(parsePublicEvent(base).branding, null, 'RPC sans branding');
  assert.equal(parsePublicEvent({ ...base, branding: null }).branding, null);
  assert.equal(parsePublicEvent({ ...base, branding: 'x' }).branding, null);
  assert.deepEqual(parsePublicEvent({ ...base, branding: { color: '#1F4E79', logo_url: 'https://x.fr/l.png', gallery_text: 'Bienvenue' } }).branding,
    { color: '#1F4E79', logoUrl: 'https://x.fr/l.png', galleryText: 'Bienvenue' });
  assert.deepEqual(parsePublicEvent({ ...base, branding: { color: 'red', logo_url: 'javascript:alert(1)', gallery_text: null, extra: 1 } }).branding,
    { color: null, logoUrl: null, galleryText: '' });
});

// Garde-fou : plus aucune lecture anon directe de `events` dans les fonctions publiques du front.
test('api/photos.js : galerie, diaporama et livre d\'or passent par la RPC, pas par from(\'events\')', () => {
  const src = readFileSync(new URL('./api/photos.js', import.meta.url), 'utf8');
  for (const fn of ['fetchCompanyByCode', 'fetchPhotosByAccessCode', 'getGalleryConfig']) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} introuvable`);
    const end = src.indexOf('\nexport ', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    assert.doesNotMatch(body, /from\(['"]events['"]\)/, `${fn} lit encore la table events`);
    assert.match(body, /getPublicEvent\(/, `${fn} doit passer par getPublicEvent`);
  }
  assert.match(src, new RegExp(`rpc\\(PUBLIC_EVENT_RPC`));
  assert.equal(PUBLIC_EVENT_RPC, 'get_public_event');
});

test('middleware Open Graph : RPC get_public_event, plus de /rest/v1/events', () => {
  const src = readFileSync(new URL('../../middleware.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /rest\/v1\/events/);
  assert.match(src, /rest\/v1\/rpc\/get_public_event/);
});
