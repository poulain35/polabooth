// LAB-216 : fichier .pola = l'événement complet pour une borne sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPolaBundle, polaBundleWarnings, polaDesignProblem, polaFileName, PolaExportError, POLA_FORMAT_VERSION,
} from './polaBundle.js';

const canvas = {
  version: '5.3.0',
  objects: [{ type: 'group', left: 10, top: 20, objects: [{ type: 'rect', isPhotoZone: true, left: -50, top: -40, width: 100, height: 80 }] }],
};

const event = (over = {}) => ({
  id: 'ev-1',
  org_id: 'org-1',
  name: 'Mariage Julie & Thomas',
  access_code: 'TUQNA5',
  start_date: '2026-06-14T14:00:00+00:00',
  end_date: '2026-06-15T02:00:00+00:00',
  form_config: {
    kiosk: { home: { title: 'Bienvenue', background_url: 'https://cdn/bg.jpg' }, capture: { countdown_seconds: 3 } },
    features: { audio: true },
    gallery: { password: 'confidentiel' },
  },
  ...over,
});

const design = (over = {}) => ({
  id: 'ds-1', status: 'approved', format: 'stripV', canvas_json: canvas,
  final_png_url: 'https://cdn/designs/ev-1/20261104.png', ...over,
});

const LOGO_URL = 'https://cdn/kiosk-backgrounds/org/org-1/logo.png?v=1';
const contact = {
  contact_company: 'Studio Exemple', contact_phone: '06 00 00 00 00', contact_email: 'x@y.fr', logo_url: LOGO_URL,
};

const full = (over = {}) => buildPolaBundle({
  event: event(), design: design(), designPngBase64: 'UE5H', homeBackgroundBase64: 'QkdI',
  contact, logoBase64: 'TE9H', exportedAt: '2026-11-04T10:00:00.000Z', ...over,
});

test('bundle complet : événement, design approuvé et son PNG, fond d’accueil, logo, contact', () => {
  const b = full();
  assert.equal(b.version, POLA_FORMAT_VERSION);
  assert.equal(b.version, 2);
  assert.equal(b.exported_at, '2026-11-04T10:00:00.000Z');
  assert.deepEqual(b.event, {
    id: 'ev-1', org_id: 'org-1', name: 'Mariage Julie & Thomas', access_code: 'TUQNA5',
    start_date: '2026-06-14T14:00:00+00:00', end_date: '2026-06-15T02:00:00+00:00',
    form_config: { kiosk: event().form_config.kiosk },
  });
  assert.deepEqual(b.design, {
    id: 'ds-1', format: 'stripV', canvas_json: canvas, final_png_url: 'https://cdn/designs/ev-1/20261104.png',
  });
  assert.deepEqual(b.assets, { design_png: 'UE5H', home_background: 'QkdI', logo: 'TE9H' });
  assert.deepEqual(b.contact, { company: 'Studio Exemple', phone: '06 00 00 00 00', logo_url: LOGO_URL, email: 'x@y.fr' });
  assert.deepEqual(polaBundleWarnings(b), []);
});

test('canvas_json gardé tel quel (zones groupées comprises) : la borne le lit comme en ligne', () => {
  assert.deepEqual(full().design.canvas_json, canvas);
});

test('form_config réduit à la partie kiosk, comme la RPC kiosk_get_event', () => {
  const json = JSON.stringify(full());
  assert.ok(!json.includes('confidentiel'));
  assert.ok(!json.includes('features'));
  assert.deepEqual(buildPolaBundle({ event: event({ form_config: null }), design: design(), designPngBase64: 'UE5H' })
    .event.form_config, { kiosk: null });
});

test('LAB-250 : event a les mêmes clés que la RPC kiosk_get_event, dates comprises', () => {
  assert.deepEqual(Object.keys(full().event).sort(),
    ['access_code', 'end_date', 'form_config', 'id', 'name', 'org_id', 'start_date']);
  const undated = full({ event: event({ start_date: undefined, end_date: undefined }) }).event;
  assert.equal(undated.start_date, null);
  assert.equal(undated.end_date, null);
});

test('plus de bibliothèque de templates dans le fichier', () => {
  const b = full();
  assert.equal(b.templates, undefined);
  assert.deepEqual(Object.keys(b).sort(), ['assets', 'contact', 'design', 'event', 'exported_at', 'version']);
});

test('sans design approuvé : export refusé avec un message clair', () => {
  for (const d of [null, design({ status: 'submitted' }), design({ status: 'rejected' }), design({ status: 'draft' })]) {
    assert.throws(() => full({ design: d }), (err) => err instanceof PolaExportError && /Aucun design approuvé/.test(err.message));
    assert.match(polaDesignProblem(d), /sans cadre/);
  }
});

test('design approuvé sans PNG, ou PNG non téléchargé : export refusé', () => {
  assert.throws(() => full({ design: design({ final_png_url: null }) }), /pas de rendu PNG/);
  assert.throws(() => full({ designPngBase64: null }), (err) => err instanceof PolaExportError && /n'a pas pu être téléchargé/.test(err.message));
  assert.equal(polaDesignProblem(design()), null);
});

test('éléments facultatifs absents : fichier produit, admin prévenu', () => {
  const b = full({ homeBackgroundBase64: null, contact: null, logoBase64: null });
  assert.deepEqual(b.assets, { design_png: 'UE5H' });
  assert.equal(b.contact, null);
  assert.deepEqual(polaBundleWarnings(b), [
    'fond d\'accueil non téléchargé (la borne affichera le fond crème)',
    'coordonnées du loueur absentes',
  ]);
});

test('fond d\'accueil ignoré si l\'événement n\'en a pas, téléphone vide = null', () => {
  const ev = event({ form_config: { kiosk: { home: {} } } });
  const b = full({ event: ev, contact: { contact_company: 'Pola', contact_phone: '' } });
  assert.equal(b.assets.home_background, undefined);
  assert.deepEqual(b.contact, { company: 'Pola', phone: null, logo_url: null, email: null });
  assert.deepEqual(polaBundleWarnings(b), []);
});

test('LAB-257 : logo non téléchargé, fichier produit, admin prévenu', () => {
  const b = full({ logoBase64: null });
  assert.equal(b.assets.logo, undefined);
  assert.equal(b.contact.logo_url, LOGO_URL, "la borne garde le logo qu'elle a déjà");
  assert.deepEqual(polaBundleWarnings(b), [
    "logo de la société non téléchargé (la borne gardera celui qu'elle a déjà, sinon affichera le nom de la société)",
  ]);
});

test("LAB-257 : société sans logo, logo_url null pour que la borne efface l'ancien", () => {
  const b = full({ contact: { ...contact, logo_url: null }, logoBase64: 'TE9H' });
  assert.equal(b.assets.logo, undefined, 'pas de logo embarqué sans URL');
  assert.equal(b.contact.logo_url, null);
  assert.deepEqual(polaBundleWarnings(b), []);
  // RPC d'avant la migration : pas de champ logo_url.
  const { logo_url: _, ...oldContact } = contact;
  assert.equal(full({ contact: oldContact }).contact.logo_url, null);
});

test('nom du fichier', () => {
  assert.equal(polaFileName(event()), 'mariage_julie___thomas_TUQNA5.pola');
  assert.equal(polaFileName({ name: '', access_code: 'AB12' }), 'evenement_AB12.pola');
});

test('open core : questionnaire de la borne retiré quand la fonctionnalité est désactivée', () => {
  const q = { enabled: true, questions: [{ type: 'email' }] };
  const ev = event({ form_config: { kiosk: { home: { title: 'B' }, questionnaire: q } } });
  const on = buildPolaBundle({ event: ev, design: design(), designPngBase64: 'UE5H' });
  assert.deepEqual(on.event.form_config.kiosk.questionnaire, q);
  const off = buildPolaBundle({ event: ev, design: design(), designPngBase64: 'UE5H', guestFormEnabled: false });
  assert.deepEqual(off.event.form_config.kiosk, { home: { title: 'B' } });
  assert.deepEqual(ev.form_config.kiosk.questionnaire, q);
});
