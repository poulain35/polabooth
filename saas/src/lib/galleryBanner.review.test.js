// Revue LAB-130 / LAB-142 : cas limites du bandeau « Vous organisez un événement ? », rendu réel de la
// barre fixe, placement dans les galeries, réglage admin et comparaison de la migration avec la précédente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BANNER_DISMISS_KEY, BOOKING_BANNER_SETTING, bookingBannerLinks,
  isBookingBannerEnabled, shouldShowBookingBanner,
} from './galleryBanner.js';
import { parsePublicEvent } from './publicEvent.js';
import { BRAND } from './instanceBrand.js';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../scripts/private-history.mjs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Site passé explicitement : les tests ne dépendent pas de la marque installée (open core).
const SITE = 'https://exemple.fr';
const BOOKING = `${SITE}/disponibilites/?utm_source=galerie&utm_medium=web`;
const BUSINESS = `${SITE}/pour-les-entreprises/?utm_source=galerie&utm_medium=web`;
const BRAND_RE = BRAND.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Liens ────────────────────────────────────────────────────────────────────

test('liens : type à caractères spéciaux → aucun utm_campaign, chemin et paramètres intacts', () => {
  const nasty = ['soirée privée', 'a&b=c', 'mariage?x=1', 'mariage#top', '../../admin', '<script>', 'mari age',
    'mariage&utm_source=spam', '%2F', 'ma/riage', 'é', 'x'.repeat(41), {}, [], true];
  for (const t of nasty) {
    const { booking, business } = bookingBannerLinks(t, SITE);
    assert.equal(booking, BOOKING, JSON.stringify(t));
    assert.equal(business, BUSINESS, JSON.stringify(t));
    const u = new URL(booking);
    assert.equal(u.pathname, '/disponibilites/');
    assert.equal(u.hash, '');
    assert.deepEqual([...u.searchParams.keys()], ['utm_source', 'utm_medium']);
  }
});

test('liens : type valide en majuscules ou entouré d\'espaces → normalisé, sans encodage parasite', () => {
  assert.equal(bookingBannerLinks('MARIAGE', SITE).booking, `${BOOKING}&utm_campaign=mariage`);
  assert.equal(bookingBannerLinks('\tSoiree_Privee \n', SITE).booking, `${BOOKING}&utm_campaign=soiree_privee`);
  assert.equal(bookingBannerLinks('x'.repeat(40), SITE).booking, `${BOOKING}&utm_campaign=${'x'.repeat(40)}`);
});

test('liens : chaque valeur du CHECK leads.event_type devient un utm_campaign identique', { skip: PRIVATE_HISTORY }, () => {
  const ddl = src('../../supabase/migrations/20260910000003_leads.sql');
  const check = ddl.match(/event_type\s+TEXT\s+CHECK \(event_type\s+IN \(([^)]*)\)\)/);
  assert.ok(check, 'CHECK de leads.event_type trouvé');
  const values = [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(values.length >= 6);
  for (const v of values) {
    assert.equal(new URL(bookingBannerLinks(v, SITE).booking).searchParams.get('utm_campaign'), v, v);
  }
  // Aucune migration ultérieure n'élargit la liste (sinon une nouvelle valeur pourrait être rejetée par le slug).
  const later = readdirSync(new URL('../../supabase/migrations/', import.meta.url))
    .filter((f) => f > '20260910000003_leads.sql')
    .filter((f) => /CHECK\s*\(\s*event_type/i.test(src(`../../supabase/migrations/${f}`)));
  assert.deepEqual(later, []);
});

test('liens : site avec plusieurs slashs finaux', () => {
  assert.equal(bookingBannerLinks('', `${SITE}///`).business, BUSINESS);
});

// ── Réglage ──────────────────────────────────────────────────────────────────

test('réglage : seul le booléen false masque ; la chaîne "false", 0 et "" laissent le bandeau', () => {
  assert.equal(isBookingBannerEnabled(false), false);
  for (const v of ['false', 'False', 0, '', 'non', undefined, null, true, 'true', {}]) {
    assert.equal(isBookingBannerEnabled(v), true, JSON.stringify(v));
  }
  // Même règle côté lecture publique : un "false" texte reçu de la RPC n'éteint pas le bandeau.
  assert.equal(parsePublicEvent({ id: 'e1', booking_banner: 'false' }).bookingBanner, true);
  assert.equal(parsePublicEvent({ id: 'e1', booking_banner: false }).bookingBanner, false);
  assert.equal(parsePublicEvent(null), null);
});

test('règle d\'affichage : galerie vide, nombre invalide ou réglage false → pas de bandeau', () => {
  for (const itemCount of [0, -1, NaN, undefined, null, '0']) {
    assert.equal(shouldShowBookingBanner({ enabled: true, itemCount }), false, String(itemCount));
  }
  assert.equal(shouldShowBookingBanner({ enabled: 'false', itemCount: 1 }), true);
  assert.equal(shouldShowBookingBanner({ enabled: false, itemCount: 1 }), false);
});

test('parsePublicEvent : event_type NULL (pas de lead) → chaîne vide → lien sans utm_campaign', () => {
  const pub = parsePublicEvent({ id: 'e1', name: 'X', booking_banner: true, event_type: null });
  assert.equal(pub.eventType, '');
  assert.equal(bookingBannerLinks(pub.eventType, SITE).booking, BOOKING);
});

// ── Composant rendu (JSX compilé par Vite, rendu serveur React) ──────────────

async function loadBanner() {
  const code = src('../components/GalleryBookingBanner.jsx');
  const { code: js } = await transformWithOxc(code, 'GalleryBookingBanner.jsx', { lang: 'jsx', jsx: { runtime: 'automatic' } });
  const abs = (rel) => new URL(rel, import.meta.url).href;
  const out = js
    .replace('"../lib/galleryBanner"', JSON.stringify(abs('./galleryBanner.js')))
    .replace('"./public/polaHead"', JSON.stringify(abs('../components/public/polaHead.js')))
    .replace('"./public/polaStyles"', JSON.stringify(abs('../components/public/polaStyles.js')))
    .replace('"../lib/instanceBrand"', JSON.stringify(abs('./instanceBrand.js')))
    .replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
    .replace('"react"', JSON.stringify(import.meta.resolve('react')));
  assert.doesNotMatch(out, /from "\.{1,2}\//, 'tous les imports relatifs sont réécrits');
  return (await import(`data:text/javascript,${encodeURIComponent(out)}`)).default;
}

// Texte visible d'un lien (les libellés mobile / bureau sont dans des <span> distincts).
const hrefs = (html) => [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attrs, inner]) => ({
  text: [...inner.replaceAll('</span>', '').matchAll(/(?:<span class="([^"]*)">)?([^<]+)/g)].map(([, cls, t]) => ({ cls: cls ?? '', t })),
  href: attrs.match(/href="([^"]*)"/)[1].replaceAll('&amp;', '&'),
  target: attrs.match(/target="([^"]*)"/)?.[1],
  rel: attrs.match(/rel="([^"]*)"/)?.[1],
}));
const bar = (html) => html.match(/<aside [^>]*>/)?.[0] ?? '';

test('composant : barre fixe en bas, titre, deux liens dans un nouvel onglet sans référent, utm du type', async () => {
  const Banner = await loadBanner();
  const html = renderToStaticMarkup(createElement(Banner, { eventType: 'mariage', site: SITE }));
  // Espaceur (hauteur réservée en bas de page) puis la barre elle-même.
  assert.match(html, new RegExp(`^<div aria-hidden="true" style="height:0(px)?"></div><aside aria-label="${BRAND_RE}"`));
  assert.match(bar(html), /class="fixed inset-x-0 bottom-0 z-30 /);
  assert.match(bar(html), /style="padding-bottom:env\(safe-area-inset-bottom\)"/);
  assert.doesNotMatch(bar(html), /\bhidden\b/, 'visible par défaut');
  assert.doesNotMatch(html, /animate-|transition-transform|translate-y/, 'aucune animation d\'entrée');
  assert.match(html, /Vous organisez un événement \?/);
  const links = hrefs(html);
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(({ href, target, rel }) => ({ href, target, rel })), [
    { href: BUSINESS, target: '_blank', rel: 'noopener noreferrer' },
    { href: `${BOOKING}&utm_campaign=mariage`, target: '_blank', rel: 'noopener noreferrer' },
  ]);
  assert.deepEqual(links[0].text, [{ cls: '', t: 'Entreprises' }]);
  assert.deepEqual(links[1].text, [{ cls: 'sm:hidden', t: 'Nos disponibilités' }, { cls: 'hidden sm:inline', t: 'Vérifiez nos disponibilités' }]);
});

test('composant : croix de fermeture avec aria-label, bouton non soumettant', async () => {
  const Banner = await loadBanner();
  const html = renderToStaticMarkup(createElement(Banner, { eventType: '', site: SITE }));
  const buttons = html.match(/<button [^>]*>/g);
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /type="button"/);
  assert.match(buttons[0], new RegExp(`aria-label="Fermer le bandeau ${BRAND_RE}"`));
});

test('composant : type inconnu ou à encoder → liens sans utm_campaign, rien d\'injecté', async () => {
  const Banner = await loadBanner();
  for (const eventType of [undefined, '', 'soirée privée', 'a"><img src=x>']) {
    const html = renderToStaticMarkup(createElement(Banner, { eventType, site: SITE }));
    assert.deepEqual(hrefs(html).map((l) => l.href), [BUSINESS, BOOKING], String(eventType));
    assert.doesNotMatch(html, /<img/);
  }
});

test('composant : hidden → barre masquée (attribut hidden), toujours rendue pour revenir à la fermeture de la visionneuse', async () => {
  const Banner = await loadBanner();
  const html = renderToStaticMarkup(createElement(Banner, { eventType: 'mariage', hidden: true, site: SITE }));
  assert.match(bar(html), new RegExp(`^<aside aria-label="${BRAND_RE}" hidden=""`));
});

test('composant : fermée pendant la session → rien n\'est rendu, ni barre ni espaceur', async () => {
  const Banner = await loadBanner();
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (k) => (k === BANNER_DISMISS_KEY ? '1' : null), setItem() {} } });
  try {
    assert.equal(renderToStaticMarkup(createElement(Banner, { eventType: 'mariage', site: SITE })), '');
  } finally {
    if (desc) Object.defineProperty(globalThis, 'sessionStorage', desc);
    else delete globalThis.sessionStorage;
  }
  // Stockage qui lève : la barre s'affiche quand même.
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.match(renderToStaticMarkup(createElement(Banner, { eventType: 'mariage', site: SITE })), /<aside /);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'sessionStorage', desc);
    else delete globalThis.sessionStorage;
  }
});

test('composant : fermeture retenue (sessionStorage dans un try/catch), hauteur exposée aux autres boutons fixes', () => {
  const c = src('../components/GalleryBookingBanner.jsx');
  assert.match(c, /useState\(\(\) => isBookingBannerDismissed\(\)\)/, 'lu avant le premier rendu (pas de clignotement)');
  assert.match(c, /function close\(\) \{\s+dismissBookingBanner\(\);\s+setDismissed\(true\);/);
  assert.doesNotMatch(c, /sessionStorage|localStorage/, 'aucun accès direct au stockage hors des fonctions protégées');
  assert.match(c, /export const BAR_OFFSET_VAR = '--gallery-bar-h';/);
  assert.match(c, /const offset = dismissed \|\| hidden \? 0 : height;/);
  assert.match(c, /useLayoutEffect\(/, 'mesure avant affichage : pas de décalage de mise en page');
});

// ── Galerie photo : barre fixe, plus d'insertion dans la grille ──────────────

const PHOTO = src('../pages/PhotoGallery.jsx');

test('page photo : une seule grille, aucune coupure, une seule barre', () => {
  assert.match(PHOTO, /const visible = filtered\.slice\(0, visibleCount\);/);
  assert.match(PHOTO, /\{visible\.map\(renderTile\)\}/);
  assert.equal(PHOTO.match(/\.map\(renderTile\)/g).length, 1, 'aucune autre boucle de vignettes');
  assert.doesNotMatch(PHOTO, /bookingBannerSlot|bannerAt|BANNER_AFTER_PHOTOS|visible\.slice\(/);
  assert.equal(PHOTO.match(/<GalleryBookingBanner\b/g).length, 1);
});

test('page photo : réglage false ou galerie vide → pas de barre (même règle qu\'avant)', () => {
  assert.match(PHOTO, /const showBanner = shouldShowBookingBanner\(\{ enabled: banner\.enabled, itemCount: filtered\.length \}\);/);
  assert.match(PHOTO, /\{showBanner && <GalleryBookingBanner eventType=\{banner\.eventType\} hidden=\{bannerHidden\} \/>\}/);
  assert.match(PHOTO, /setBanner\(\{ enabled: bookingBanner, eventType \}\);/);
  assert.match(PHOTO, /useState\(\{ enabled: false, eventType: '' \}\)/, 'masquée tant que rien n\'est chargé');
});

test('page photo : barre masquée sous la visionneuse, la feuille d\'upload et la sélection', () => {
  assert.match(PHOTO, /const bannerHidden = Boolean\(lightbox\) \|\| showUploader \|\| selectMode;/);
});

test('page photo : boutons fixes du bas (remonter, barre de sélection) posés au-dessus de la barre', () => {
  assert.match(PHOTO, /const aboveBar = \{ bottom: `calc\(var\(\$\{BAR_OFFSET_VAR\}, 0px\) \+ 1rem\)` \};/);
  // Tout élément fixe de la page hors plein écran (visionneuse inset-0) : la barre de sélection et « remonter ».
  const fixed = [...PHOTO.matchAll(/className="fixed (?!inset-0)([^"]*)"/g)];
  assert.equal(fixed.length, 2, 'remonter en haut + barre de sélection');
  for (const m of fixed) {
    const tag = PHOTO.slice(PHOTO.lastIndexOf('<', m.index), m.index + m[0].length);
    assert.match(tag, /style=\{aboveBar\}/, tag);
    assert.doesNotMatch(m[1], /\bbottom-\d/, `${m[1]} : plus de bottom-4 en dur`);
  }
});

test('page photo : barre après la sentinelle, hors visionneuse et hors écrans de chargement / d\'erreur', () => {
  const grid = PHOTO.indexOf('{visible.map(renderTile)}');
  const sentinel = PHOTO.indexOf('ref={sentinelRef}');
  const bannerEl = PHOTO.indexOf('<GalleryBookingBanner');
  const lightbox = PHOTO.indexOf('{lightbox && (');
  assert.ok(grid > 0 && grid < sentinel && sentinel < bannerEl && bannerEl < lightbox);
  assert.doesNotMatch(PHOTO.slice(lightbox), /GalleryBookingBanner/);
  const errorScreen = PHOTO.slice(PHOTO.indexOf("if (status === 'loading')"), PHOTO.indexOf('const lightboxIdx'));
  assert.doesNotMatch(errorScreen, /GalleryBookingBanner/);
});

test('page photo : vignette (index, sélection, visionneuse) toujours sur la liste filtrée', () => {
  const tile = PHOTO.slice(PHOTO.indexOf('const renderTile = (photo) => {'), PHOTO.indexOf('return (\n    <div className="min-h-screen bg-gray-50 pb-16'));
  assert.ok(tile.length > 100, 'renderTile trouvé');
  assert.match(tile, /key=\{photo\.id\}/);
  assert.equal(tile.match(/index=\{filtered\.indexOf\(photo\)\}/g).length, 2);
  assert.match(PHOTO, /const lightboxIdx = lightbox \? filtered\.findIndex\(\(p\) => p\.id === lightbox\.id\) : -1;/);
});

// ── Galerie audio et diaporama ───────────────────────────────────────────────

test('page audio : bandeau uniquement dans le lecteur, sous la liste, masqué si la RPC échoue', { skip: PRIVATE_HISTORY }, () => {
  const audio = src('../modules/audio_guestbook/pages/AudioGallery.jsx');
  assert.equal(audio.match(/<GalleryBookingBanner\b/g).length, 1);
  const player = audio.slice(audio.indexOf('function Player('), audio.indexOf('export default function AudioGallery'));
  assert.match(player, /<GalleryBookingBanner\b/);
  assert.ok(player.indexOf('{tracks.map(') < player.indexOf('<GalleryBookingBanner'));
  assert.match(player, /shouldShowBookingBanner\(\{ enabled: banner\.enabled, itemCount: tracks\.length \}\)/);
  assert.match(audio, /getPublicEvent\(code\)\.catch\(\(\) => null\)/);
  assert.match(audio, /setBanner\(\{ enabled: pub\?\.bookingBanner === true, eventType: pub\?\.eventType \?\? '' \}\)/);
  assert.match(audio, /useState\(\{ enabled: false, eventType: '' \}\)/, 'masqué tant que rien n\'est chargé');
});

test('diaporama : aucun import du bandeau, de la galerie photo ou de la galerie audio', () => {
  const slide = src('../pages/Slideshow.jsx');
  assert.doesNotMatch(slide, /GalleryBookingBanner|galleryBanner|PhotoGallery|AudioGallery|booking_banner|bookingBanner/);
});

// ── Réglage admin ────────────────────────────────────────────────────────────

test('réglages admin : interrupteur et enregistrement passent par isBookingBannerEnabled (toujours un booléen)', () => {
  const s = src('../pages/admin/reglages/GallerySettings.jsx');
  const bp = src('./businessProfile.js');
  assert.match(bp, /\[BOOKING_BANNER_SETTING\]: true,/, 'défaut affiché');
  assert.match(bp, /\[BOOKING_BANNER_SETTING\]: isBookingBannerEnabled\(cfg\[BOOKING_BANNER_SETTING\]\),/);
  assert.match(s, /saveBusinessProfile\(org\.id, profilePatch\(cfg\)\)/, 'profilePatch passe par businessProfilePatch (LAB-262)');
  assert.match(s, /checked=\{isBookingBannerEnabled\(cfg\[BOOKING_BANNER_SETTING\]\)\} onChange=\{v => set\(BOOKING_BANNER_SETTING, v\)\}/);
  // Modèle de l'init (défaut puis business_profile) et de l'enregistrement.
  for (const [bp, expected] of [[null, true], [{}, true], [{ gallery_booking_banner: null }, true],
    [{ gallery_booking_banner: true }, true], [{ gallery_booking_banner: false }, false], [{ gallery_booking_banner: 'false' }, true]]) {
    const cfg = { [BOOKING_BANNER_SETTING]: true, ...(bp ?? {}) };
    const saved = isBookingBannerEnabled(cfg[BOOKING_BANNER_SETTING]);
    assert.equal(saved, expected, JSON.stringify(bp));
    assert.equal(typeof saved, 'boolean');
  }
});

// ── Migration : comparaison avec 20261107000100 ──────────────────────────────

const MIG_DIR = '../../supabase/migrations/';
const fnBody = (sql) => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_public_event(');
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
};
const norm = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ').trim();
const OLD = norm(fnBody(readPrivateHistory(new URL(`${MIG_DIR}20261107000100_rpc_code_rate_limit.sql`, import.meta.url))));
const NEW_SQL = readPrivateHistory(new URL(`${MIG_DIR}20261114000100_gallery_booking_banner.sql`, import.meta.url));
const NEW = norm(fnBody(NEW_SQL));
const ADDED = ", 'booking_banner', (o.business_profile -> 'gallery_booking_banner') IS DISTINCT FROM 'false'::jsonb, "
  + "'event_type', (SELECT l.event_type FROM public.leads l WHERE l.converted_event_id = e.id "
  + 'ORDER BY l.created_at DESC NULLS LAST LIMIT 1)';

test('migration : corps identique à 20261107000100 hormis les deux champs ajoutés', { skip: PRIVATE_HISTORY }, () => {
  assert.ok(OLD.includes('rpc_code_guard') && OLD.endsWith('$$;'));
  assert.equal(NEW.split(ADDED).length, 2, 'les deux champs, une seule fois, à la suite de gallery');
  assert.equal(NEW.replace(ADDED, ''), OLD);
});

test('migration : rien d\'autre de l\'organisation, du lead ou de business_profile n\'est lu', { skip: PRIVATE_HISTORY }, () => {
  assert.deepEqual([...new Set(NEW.match(/\bo\.\w+/g))].sort(), ['o.business_profile', 'o.contact_company', 'o.id', 'o.name']);
  assert.deepEqual([...new Set(NEW.match(/\bl\.\w+/g))].sort(), ['l.converted_event_id', 'l.created_at', 'l.event_type']);
  assert.doesNotMatch(NEW, /->>|row_to_json|to_jsonb?\(|\bo\.\*|\bl\.\*|business_profile\s*[,)]/);
  // `->` + IS DISTINCT FROM : NULL (pas d'org, business_profile NULL, clé absente) → true ; seul le jsonb false → false.
  // La chaîne JSON "false" reste distincte de false → bandeau affiché, comme côté front.
  assert.match(NEW, /'booking_banner', \(o\.business_profile -> 'gallery_booking_banner'\) IS DISTINCT FROM 'false'::jsonb,/);
  // Sous-requête scalaire bornée à une ligne : NULL sans lead, jamais d'erreur « more than one row ».
  assert.match(NEW, /\(SELECT l\.event_type FROM public\.leads l WHERE l\.converted_event_id = e\.id ORDER BY l\.created_at DESC NULLS LAST LIMIT 1\)/);
});

test('migration : droits, garde anti-énumération et ordre des migrations', { skip: PRIVATE_HISTORY }, () => {
  assert.match(NEW_SQL, /REVOKE ALL ON FUNCTION public\.get_public_event\(TEXT\) FROM PUBLIC;\s+GRANT EXECUTE ON FUNCTION public\.get_public_event\(TEXT\) TO anon, authenticated, service_role;/);
  const initial = src(`${MIG_DIR}20261103000000_events_public_rpc.sql`);
  assert.match(initial, /REVOKE ALL ON FUNCTION public\.get_public_event\(TEXT\) FROM PUBLIC;/);
  assert.match(initial, /GRANT EXECUTE ON FUNCTION public\.get_public_event\(TEXT\) TO anon, authenticated, service_role;/);
  assert.doesNotMatch(NEW_SQL, /DROP FUNCTION|kiosk_get_event|get_event_form_enabled|get_org_contact_by_code|ALTER TABLE|GRANT [^;]*\bON\b (?!FUNCTION public\.get_public_event)/);
  const files = readdirSync(new URL(MIG_DIR, import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const definers = files.filter((f) => src(`${MIG_DIR}${f}`).includes('FUNCTION public.get_public_event('));
  // Redéfinie ensuite par LAB-301 (habillage, publicEventBranding.test.js), qui garde ces deux champs.
  assert.deepEqual(definers.slice(definers.indexOf('20261114000100_gallery_booking_banner.sql')),
    ['20261114000100_gallery_booking_banner.sql', '20261221000000_event_branding_public.sql'], 'définitions suivantes de get_public_event');
  assert.equal(files.filter((f) => f.startsWith('20261114000100')).length, 1, 'horodatage unique');
  const others = files.filter((f) => f !== '20261114000100_gallery_booking_banner.sql');
  assert.ok(!others.some((f) => src(`${MIG_DIR}${f}`).includes('leads_converted_event_idx')), 'nom d\'index libre');
});
