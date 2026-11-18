import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { FEATURE_IDS } from './catalog.js';
import {
  FEATURE_DISABLED, NAV_FEATURES, featureAvailable, featureInstalled, filterNav, hasPublicFeature,
  isFeatureDisabledError, navItemAvailable, navItemFeature, publicFeaturesFrom,
} from './featureGate.js';

test('isFeatureDisabledError : réponse d\'edge function (404 { error })', () => {
  assert.equal(isFeatureDisabledError({ error: FEATURE_DISABLED }), true);
  // Error construite par functionError(res, data) : message = data.error
  const fromBody = Object.assign(new Error(FEATURE_DISABLED), { status: 404 });
  assert.equal(isFeatureDisabledError(fromBody), true);
  // Error de bookingPublic : message lisible, code = data.error
  const booking = Object.assign(new Error('Erreur 404'), { status: 404, code: FEATURE_DISABLED, data: { error: FEATURE_DISABLED } });
  assert.equal(isFeatureDisabledError(booking), true);
  assert.equal(isFeatureDisabledError({ body: { error: FEATURE_DISABLED } }), true);
  assert.equal(isFeatureDisabledError(FEATURE_DISABLED), true);
});

test('isFeatureDisabledError : erreur RPC (PT404)', () => {
  assert.equal(isFeatureDisabledError({ code: 'PT404', message: FEATURE_DISABLED, details: null, hint: null }), true);
  assert.equal(isFeatureDisabledError({ code: 'PT404', message: ` ${FEATURE_DISABLED}\n` }), true);
  assert.equal(isFeatureDisabledError({ error: { code: 'PT404', message: FEATURE_DISABLED } }), true);
});

test('isFeatureDisabledError : autres erreurs ignorées', () => {
  for (const err of [
    null, undefined, '', 'Code invalide', 404, {}, new Error('Erreur 404'),
    { code: 'PGRST202', message: 'Could not find the function public.public_features_by_code' },
    { error: 'not_found' }, { status: 404, error: 'Événement introuvable' },
    { message: 'fonctionnalite_desactivee_bis' },
  ]) {
    assert.equal(isFeatureDisabledError(err), false, JSON.stringify(err));
  }
});

test('publicFeaturesFrom : liste du serveur', () => {
  assert.deepEqual(publicFeaturesFrom({ data: ['core', 'gallery'], error: null }), ['core', 'gallery']);
  assert.deepEqual(publicFeaturesFrom({ data: ['core', 3, null], error: null }), ['core']);
  assert.deepEqual(publicFeaturesFrom({ data: [], error: null }), []);
});

test('publicFeaturesFrom : RPC absente ou en erreur → tout actif', () => {
  const all = [...FEATURE_IDS];
  assert.deepEqual(publicFeaturesFrom({ data: null, error: { code: 'PGRST202', message: 'not found' } }), all);
  assert.deepEqual(publicFeaturesFrom({ data: null, error: { status: 404 } }), all);
  assert.deepEqual(publicFeaturesFrom({ data: null, error: null }), all);
  assert.deepEqual(publicFeaturesFrom({ data: 'core', error: null }), all);
  assert.deepEqual(publicFeaturesFrom(undefined), all);
});

test('hasPublicFeature : liste inconnue = actif', () => {
  assert.equal(hasPublicFeature(null, 'ai_visuals'), true);
  assert.equal(hasPublicFeature(['core'], 'ai_visuals'), false);
  assert.equal(hasPublicFeature(['core', 'ai_visuals'], 'ai_visuals'), true);
});

test('menu : chaque entrée d\'AdminLayout a une fonctionnalité du catalogue', () => {
  const src = readFileSync(new URL('../pages/admin/AdminLayout.jsx', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const MODULES = ['), src.indexOf('function navClass'));
  const targets = [...block.matchAll(/\bto:\s*'([^']+)'/g)].map((m) => m[1]);
  // Refonte de la navigation (LAB-335) : sept entrées au plus, dans cet ordre.
  assert.deepEqual(targets, ['aujourdhui', 'ventes', 'events', 'bornes', 'reglages', 'templates', 'aide']);
  for (const to of targets) {
    assert.ok(to in NAV_FEATURES, `entrée sans correspondance : ${to}`);
    for (const id of [NAV_FEATURES[to]].flat()) assert.ok(FEATURE_IDS.includes(id), `${to} → ${id}`);
  }
  assert.match(src, /filterNav\(MODULES,/);
});

test('menu : socle toujours visible, entrée inconnue = socle', () => {
  for (const to of ['aujourdhui', 'events', 'bornes', 'reglages', 'templates']) {
    assert.ok(['core', 'templates'].includes(navItemFeature(to)), to);
  }
  assert.equal(navItemFeature('inconnu'), 'core');
  assert.deepEqual(navItemFeature('ventes'), ['booking', 'prospects']);
  assert.equal(navItemFeature('aide'), 'help');
});

test('menu : « Demandes et devis » visible si booking ou prospects est disponible', () => {
  const avail = (...ids) => (id) => ['core', ...ids].includes(id);
  assert.equal(navItemAvailable('ventes', avail()), false);
  assert.equal(navItemAvailable('ventes', avail('booking')), true);
  assert.equal(navItemAvailable('ventes', avail('prospects')), true);
  assert.equal(navItemAvailable('events', avail()), true);
});

test('filterNav : retire les entrées inactives et les groupes vides', () => {
  const modules = [
    { id: 'a', items: [{ to: 'aujourdhui' }, { to: 'ventes' }] },
    { id: 'b', items: [{ to: 'aide' }] },
    { id: 'c', items: [{ to: 'reglages' }, { to: 'templates' }] },
  ];
  const active = new Set(['core', 'templates']);
  const out = filterNav(modules, (id) => active.has(id));
  assert.deepEqual(out.map((m) => [m.id, m.items.map((i) => i.to)]), [['a', ['aujourdhui']], ['c', ['reglages', 'templates']]]);
  // tout actif : menu inchangé
  assert.deepEqual(filterNav(modules, () => true), modules);
});

test('featureAvailable : chargement, erreur ou sans organisation = disponible', () => {
  assert.equal(featureAvailable({ loading: true, features: {} }, 'booking'), true);
  assert.equal(featureAvailable({ loading: false, error: 'boom', orgId: 'o', features: {} }, 'booking'), true);
  assert.equal(featureAvailable({ loading: false, orgId: null, features: {} }, 'booking'), true);
});

test('featureAvailable : applique défauts et dépendances une fois chargé', () => {
  const s = (features) => ({ loading: false, error: '', orgId: 'o', features });
  assert.equal(featureAvailable(s({}), 'booking'), false);        // privée, désactivée par défaut
  assert.equal(featureAvailable(s({}), 'gallery'), true);         // ouverte, active par défaut
  assert.equal(featureAvailable(s({ gallery: false }), 'delivery_email'), false); // dépendance
  assert.equal(featureAvailable(s({ core: false }), 'core'), true); // socle
  const all = Object.fromEntries(FEATURE_IDS.map((id) => [id, true]));
  for (const id of FEATURE_IDS) assert.equal(featureAvailable(s(all), id), true, id);
});

// Dépôt public (export open core) : les modules privés (src/modules/<id>/) ne sont pas livrés.
const PRIVATE_INSTALLED = readdirSync(new URL('../modules/', import.meta.url), { withFileTypes: true })
  .some((d) => d.isDirectory());

test('pages publiques : message « non disponible » et fonctionnalité vérifiée', () => {
  // Pages des modules privés : src/modules/<id>/pages/ (open core L2b).
  const MODULE_PAGES = { 'AudioGallery.jsx': 'audio_guestbook', 'Reservation.jsx': 'booking', 'Unsubscribe.jsx': 'prospects' };
  const page = (name) => readFileSync(new URL(MODULE_PAGES[name] ? `../modules/${MODULE_PAGES[name]}/pages/${name}` : `../pages/${name}`, import.meta.url), 'utf8');
  const installed = (name) => PRIVATE_INSTALLED || !MODULE_PAGES[name];
  const pages = {
    'EditorPage.jsx': 'client_design', 'PhotoGallery.jsx': 'gallery', 'Slideshow.jsx': 'gallery',
    'AudioGallery.jsx': 'audio_guestbook', 'Assistance.jsx': 'help',
    'EventReport.jsx': null, 'Reservation.jsx': null, 'Unsubscribe.jsx': null,
  };
  for (const [name, feature] of Object.entries(pages)) {
    if (!installed(name)) continue;
    const s = page(name);
    assert.match(s, /FEATURE_UNAVAILABLE_MESSAGE/, name);
    if (feature) assert.match(s, new RegExp(`hasPublicFeature\\(features, '${feature}'\\)`), name);
  }
  // Pages à jeton (sans code) : seule la réponse du serveur compte.
  for (const name of ['EventReport.jsx', 'Reservation.jsx'].filter(installed)) assert.match(page(name), /isFeatureDisabledError\(/, name);
  // IA visuelle de l'éditeur client, bandeau de réservation des galeries.
  assert.match(page('EditorPage.jsx'), /aiVisuals=\{hasPublicFeature\(publicFeatures, 'ai_visuals'\)\}/);
  assert.match(page('PhotoGallery.jsx'), /hasPublicFeature\(features, 'booking'\)/);
  if (installed('AudioGallery.jsx')) assert.match(page('AudioGallery.jsx'), /hasPublicFeature\(features, 'booking'\)/);
  assert.match(page('Assistance.jsx'), /hasPublicFeature\(features, 'assistant'\)/);
});

test('désinscription : 404 fonctionnalite_desactivee lu dans le corps de la réponse', { skip: !PRIVATE_INSTALLED && 'module privé absent (dépôt public)' }, () => {
  const lib = readFileSync(new URL('../modules/prospects/api.js', import.meta.url), 'utf8');
  const start = lib.indexOf('export async function unsubscribeProspect');
  const fn = lib.slice(start, lib.indexOf('\n}\n', start));
  assert.match(fn, /error\.context\.clone\(\)\.json\(\)/);
  assert.match(fn, /if \(isFeatureDisabledError\(body\)\) return 'unavailable';/);
  assert.ok(fn.indexOf("'unavailable'") < fn.indexOf("return 'unknown'"), 'vérifié avant le lien inconnu');
});

test('featureInstalled : une fonctionnalité privée exige son module, les ouvertes jamais', () => {
  const none = new Set();
  assert.equal(featureInstalled('booking', none), false);
  assert.equal(featureInstalled('booking', new Set(['booking'])), true);
  assert.equal(featureInstalled('planning', none), false, 'planning : module privé (LAB-421)');
  assert.equal(featureInstalled('gallery', none), true);
  assert.equal(featureInstalled('core', none), true);
  assert.equal(featureInstalled('inconnue', none), true, 'id hors catalogue : laissé au reste du contrôle');
});
