import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANNER_DISMISS_KEY, BOOKING_BANNER_SETTING, bookingBannerLinks, dismissBookingBanner,
  isBookingBannerDismissed, isBookingBannerEnabled, shouldShowBookingBanner,
} from './galleryBanner.js';
import { ORG } from '../components/public/polaStyles.js';
import { BRAND } from './instanceBrand.js';
import { IN_PUBLIC_REPO, PRIVATE_HISTORY, readPrivateHistory } from '../../scripts/private-history.mjs';

// Site passé explicitement : les tests ne dépendent pas de la marque installée (open core).
const SITE = 'https://exemple.fr';
const links = (t) => bookingBannerLinks(t, SITE);

const params = (href) => Object.fromEntries(new URL(href).searchParams);

test('liens : disponibilités avec utm_campaign = type d\'événement connu', () => {
  const { booking } = links('mariage');
  assert.equal(booking, 'https://exemple.fr/disponibilites/?utm_source=galerie&utm_medium=web&utm_campaign=mariage');
});

test('liens : type inconnu, vide ou invalide → pas de utm_campaign', () => {
  for (const t of [undefined, null, '', '   ', 'soirée privée', 'a&b=c', 42, 'x'.repeat(41)]) {
    const { booking } = links(t);
    assert.equal(booking, 'https://exemple.fr/disponibilites/?utm_source=galerie&utm_medium=web', String(t));
  }
});

test('liens : type normalisé (casse, espaces), valeurs de la liste fermée des leads', () => {
  assert.equal(params(links('  Entreprise ').booking).utm_campaign, 'entreprise');
  for (const t of ['mariage', 'anniversaire', 'bapteme', 'entreprise', 'soiree_privee', 'autre']) {
    assert.deepEqual(params(links(t).booking), { utm_source: 'galerie', utm_medium: 'web', utm_campaign: t });
  }
});

test('liens : entreprises, sans utm_campaign quel que soit le type', () => {
  for (const t of ['mariage', '']) {
    assert.equal(links(t).business, 'https://exemple.fr/pour-les-entreprises/?utm_source=galerie&utm_medium=web');
  }
});

test('liens : URL du site issue d\'une seule constante (ORG.site), slash final toléré', () => {
  assert.equal(ORG.site, BRAND.site);
  assert.equal(bookingBannerLinks('mariage', '') , null, 'sans site vitrine : pas de liens');
  const other = bookingBannerLinks('mariage', 'https://exemple.test/');
  assert.equal(other.booking, 'https://exemple.test/disponibilites/?utm_source=galerie&utm_medium=web&utm_campaign=mariage');
  assert.equal(other.business, 'https://exemple.test/pour-les-entreprises/?utm_source=galerie&utm_medium=web');
});

test('réglage : affiché par défaut, seul false le désactive', () => {
  assert.equal(BOOKING_BANNER_SETTING, 'gallery_booking_banner');
  assert.equal(isBookingBannerEnabled(undefined), true);
  assert.equal(isBookingBannerEnabled(null), true);
  assert.equal(isBookingBannerEnabled(true), true);
  assert.equal(isBookingBannerEnabled(false), false);
});

test('règle d\'affichage : réglage actif et galerie non vide', () => {
  assert.equal(shouldShowBookingBanner({ enabled: true, itemCount: 3 }), true);
  assert.equal(shouldShowBookingBanner({ enabled: undefined, itemCount: 1 }), true);
  assert.equal(shouldShowBookingBanner({ enabled: false, itemCount: 400 }), false);
  assert.equal(shouldShowBookingBanner({ enabled: true, itemCount: 0 }), false);
});

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

test('fermeture : retenue dans le stockage de session, absente au départ', () => {
  const s = memoryStorage();
  assert.equal(isBookingBannerDismissed(s), false);
  dismissBookingBanner(s);
  assert.equal(s.m.get(BANNER_DISMISS_KEY), '1');
  assert.equal(isBookingBannerDismissed(s), true);
});

test('fermeture : stockage absent ou qui lève → barre affichée, aucune exception', () => {
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(isBookingBannerDismissed(throwing), false);
  assert.doesNotThrow(() => dismissBookingBanner(throwing));
  // Sans argument : globalThis.sessionStorage (absent sous Node, ou dont le getter lève dans un navigateur).
  assert.equal(isBookingBannerDismissed(), false);
  assert.doesNotThrow(() => dismissBookingBanner());
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.equal(isBookingBannerDismissed(), false);
    assert.doesNotThrow(() => dismissBookingBanner());
  } finally {
    if (desc) Object.defineProperty(globalThis, 'sessionStorage', desc);
    else delete globalThis.sessionStorage;
  }
});

const page = (p) => readFileSync(new URL(p === 'AudioGallery.jsx' ? `../modules/audio_guestbook/pages/${p}` : `../pages/${p}`, import.meta.url), 'utf8');
// Dépôt public : pas de module privé audio_guestbook.
const GALLERIES = IN_PUBLIC_REPO ? ['PhotoGallery.jsx'] : ['PhotoGallery.jsx', 'AudioGallery.jsx'];

test('pages : bandeau sur les galeries photo et audio, jamais dans le diaporama', () => {
  for (const p of GALLERIES) {
    assert.equal(page(p).match(/<GalleryBookingBanner\b/g).length, 1, `${p} affiche une seule barre`);
    assert.match(page(p), /shouldShowBookingBanner\(/, `${p} applique la règle d'affichage`);
    assert.doesNotMatch(page(p), /bookingBannerSlot|bannerAt|BANNER_AFTER_PHOTOS/, `${p} : plus d'insertion dans la grille`);
  }
  assert.doesNotMatch(page('Slideshow.jsx'), /GalleryBookingBanner|galleryBanner/);
});

const strip = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const MIGRATION = strip(readPrivateHistory(new URL('../../supabase/migrations/20261114000100_gallery_booking_banner.sql', import.meta.url)));

test('migration : get_public_event n\'expose que le booléen du réglage et le type d\'événement', { skip: PRIVATE_HISTORY }, () => {
  const body = MIGRATION.slice(MIGRATION.indexOf('FUNCTION public.get_public_event('), MIGRATION.indexOf('$$;'));
  assert.match(body, /'booking_banner', \(o\.business_profile -> 'gallery_booking_banner'\) IS DISTINCT FROM 'false'::jsonb/);
  assert.equal(body.match(/business_profile/g).length, 1, 'business_profile lu une seule fois, jamais renvoyé entier');
  assert.match(body, /'event_type',\s+\(SELECT l\.event_type FROM public\.leads l\s+WHERE l\.converted_event_id = e\.id/);
  for (const col of ['client_name', 'client_email', 'client_phone', 'total_amount', 'contact_email', 'contact_phone', 'access_code\'', '\'kiosk\'']) {
    assert.ok(!body.includes(col), `n'expose pas ${col}`);
  }
  // Invariants LAB-112 / LAB-116 conservés.
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = public, pg_temp/);
  assert.match(body, /\bVOLATILE\b/);
  assert.ok(body.indexOf('v_bucket TEXT := public.rpc_code_guard();') < body.indexOf('FROM public.events'));
  assert.match(body, /WHERE e\.access_code = UPPER\(TRIM\(p_code\)\)\s+AND e\.status IN \('active', 'submitted'\)\s+LIMIT 1;/);
  assert.match(body, /IF NOT FOUND THEN\s+PERFORM public\.rpc_code_failed\(v_bucket\);/);
  assert.match(MIGRATION, /CREATE OR REPLACE FUNCTION public\.get_public_event\(p_code TEXT\)/);
  assert.match(MIGRATION, /CREATE INDEX IF NOT EXISTS leads_converted_event_idx/);
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.get_public_event\(TEXT\) TO anon, authenticated, service_role;/);
  assert.doesNotMatch(MIGRATION, /ALTER TABLE|ADD COLUMN/, 'aucune nouvelle colonne');
});
