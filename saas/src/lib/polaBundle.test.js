// LAB-216 : fichier .pola = l'événement complet pour une borne sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPolaBundle, polaBundleWarnings, polaDesignProblem, polaFileName, PolaExportError, POLA_FORMAT_VERSION, polaFrames,
  polaHomeDesign, polaScreens,
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

test('LAB-304 (D12) : habillage de l\'événement (form_config.branding) hors du .pola, format inchangé', () => {
  const branded = event({
    form_config: {
      ...event().form_config,
      kiosk: { ...event().form_config.kiosk, email: { enabled: true, title: 'Merci {client_name} !', button_label: 'Voir ma photo' } },
      branding: { color: '#1F4E79', logo_url: 'https://cdn/kiosk-backgrounds/ev-1/brand-logo.png?v=1', gallery_text: 'Texte de la galerie' },
    },
  });
  const b = full({ event: branded });
  assert.equal(b.version, 2);
  assert.deepEqual(Object.keys(b.event.form_config), ['kiosk']);
  const json = JSON.stringify(b);
  for (const leak of ['branding', '#1F4E79', 'brand-logo.png', 'Texte de la galerie']) assert.ok(!json.includes(leak), leak);
  assert.deepEqual(Object.keys(b.assets).sort(), Object.keys(full().assets).sort());
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
    assert.throws(() => full({ design: d }), (err) => err instanceof PolaExportError && /Aucun cadre photo approuvé/.test(err.message));
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

// ── LAB-290 : écran d'accueil créé par le client ──────────────────────────────

const HOME_PNG_URL = 'https://cdn/designs/ev-1/home/20261115.png';
const homeDesign = (over = {}) => ({ id: 'hd-1', status: 'approved', final_png_url: HOME_PNG_URL, ...over });
const homeEvent = (home = { personalized: true, client_design: true }) => event({ form_config: { kiosk: { home } } });

test('LAB-290 : écran d’accueil validé, option active → home_design et assets.home_design', () => {
  const b = full({ event: homeEvent(), homeDesign: homeDesign(), homeDesignBase64: 'SE9NRQ==' });
  assert.equal(b.version, 2, 'le format reste en version 2');
  assert.deepEqual(b.home_design, { id: 'hd-1', final_png_url: HOME_PNG_URL });
  assert.equal(b.assets.home_design, 'SE9NRQ==');
  assert.deepEqual(polaBundleWarnings(b), []);
});

test('LAB-290 : sans écran validé ou option coupée, ni home_design ni assets.home_design', () => {
  const cases = [
    { event: homeEvent(), homeDesign: null },
    ...['draft', 'submitted', 'rejected'].map((status) => ({ event: homeEvent(), homeDesign: homeDesign({ status }) })),
    { event: homeEvent(), homeDesign: homeDesign({ final_png_url: null }) },
    { event: homeEvent({ personalized: false, client_design: true }), homeDesign: homeDesign() },
    { event: homeEvent({ personalized: true, client_design: false }), homeDesign: homeDesign() },
    { event: homeEvent({ personalized: 'true', client_design: 'true' }), homeDesign: homeDesign() },
    { event: homeEvent({ personalized: true }), homeDesign: homeDesign() },
  ];
  for (const c of cases) {
    const b = full({ ...c, homeDesignBase64: 'SE9NRQ==' });
    assert.equal('home_design' in b, false, JSON.stringify(c));
    assert.equal('home_design' in b.assets, false, JSON.stringify(c));
  }
  assert.deepEqual(Object.keys(full()).sort(), ['assets', 'contact', 'design', 'event', 'exported_at', 'version']);
});

test('LAB-290 : PNG de l’écran non téléchargé, home_design gardé et admin prévenu (comme le logo)', () => {
  const b = full({ event: homeEvent(), homeDesign: homeDesign(), homeDesignBase64: null });
  assert.deepEqual(b.home_design, { id: 'hd-1', final_png_url: HOME_PNG_URL });
  assert.equal(b.assets.home_design, undefined);
  assert.deepEqual(polaBundleWarnings(b), [
    "écran d'accueil du client non téléchargé (la borne gardera celui qu'elle a déjà pour cet écran, sinon affichera l'accueil habituel)",
  ]);
});

test('LAB-290 : option active sans écran validé, fichier produit, admin prévenu', () => {
  const b = full({ event: homeEvent(), homeDesign: homeDesign({ status: 'submitted' }) });
  assert.equal(b.home_design, undefined);
  assert.deepEqual(polaBundleWarnings(b), [
    "écran d'accueil du client pas encore validé (la borne affichera l'accueil habituel)",
  ]);
  // Option coupée : rien à signaler.
  assert.deepEqual(polaBundleWarnings(full({ event: homeEvent({ personalized: true, client_design: false }) })), []);
});

test('LAB-290 : polaHomeDesign, conditions de la RPC kiosk_get_approved_design', () => {
  const kiosk = { home: { personalized: true, client_design: true } };
  assert.deepEqual(polaHomeDesign(kiosk, homeDesign({ canvas_json: { objects: [] } })), { id: 'hd-1', final_png_url: HOME_PNG_URL });
  assert.equal(polaHomeDesign(null, homeDesign()), null);
  assert.equal(polaHomeDesign({}, homeDesign()), null);
  assert.equal(polaHomeDesign(kiosk, null), null);
});

// LAB-298 : écrans de la borne publiés par l'organisation.
const ORG = 'https://cdn/storage/v1/object/public/kiosk-backgrounds/org/org-1/';
const homePlan = {
  version: 3, kind: 'home', size: { w: 1920, h: 1080 },
  background: `${ORG}screen-home-v3-bg.png`, background_neutral: `${ORG}screen-home-v3-bg-neutral.png`,
  transparent_background: false,
  buttons: [{ action: 'start', x: 700, y: 800, w: 520, h: 120, image: `${ORG}screen-home-v3-btn-start.png` }],
  texts: [], slots: [],
};
const resultPlan = {
  version: 7, kind: 'result', size: { w: 1920, h: 1080 },
  background: null, background_neutral: null, transparent_background: true,
  buttons: [{ action: 'finish', x: 1460, y: 900, w: 300, h: 100, image: `${ORG}screen-result-v7-btn-finish.png` }],
  texts: [], slots: [{ slot: 'photo_preview', x: 140, y: 120, w: 594, h: 810, angle: 0, radius: 8 }],
};
const screenImages = {
  [`${ORG}screen-home-v3-bg.png`]: 'SEJH',
  [`${ORG}screen-home-v3-bg-neutral.png`]: 'SE5F',
  [`${ORG}screen-home-v3-btn-start.png`]: 'U1RB',
  [`${ORG}screen-result-v7-btn-finish.png`]: 'RklO',
};

test('LAB-298 : écrans publiés → bloc screens (plans tels quels) et assets screens/{nom}', () => {
  const screens = { home: homePlan, result: resultPlan };
  const b = full({ screens, screenImagesBase64: screenImages });
  assert.equal(b.version, 2);
  assert.deepEqual(b.screens, { home: homePlan, result: resultPlan });
  assert.deepEqual(b.assets, {
    design_png: 'UE5H', home_background: 'QkdI', logo: 'TE9H',
    'screens/screen-home-v3-bg.png': 'SEJH',
    'screens/screen-home-v3-bg-neutral.png': 'SE5F',
    'screens/screen-home-v3-btn-start.png': 'U1RB',
    'screens/screen-result-v7-btn-finish.png': 'RklO',
  });
  assert.deepEqual(polaBundleWarnings(b, { screens }), []);
});

test('LAB-298 : rien de publié → pas de bloc screens (écrans standard)', () => {
  for (const screens of [null, { home: null, result: null }]) {
    const b = full({ screens, screenImagesBase64: screenImages });
    assert.equal('screens' in b, false);
    assert.deepEqual(Object.keys(b.assets).sort(), ['design_png', 'home_background', 'logo']);
    assert.deepEqual(polaBundleWarnings(b, { screens }), []);
  }
});

test('LAB-298 : une image non téléchargée retire tout l’écran, l’admin est prévenu', () => {
  const screens = { home: homePlan, result: resultPlan };
  const { [`${ORG}screen-home-v3-bg-neutral.png`]: _missing, ...partial } = screenImages;
  const b = full({ screens, screenImagesBase64: partial });
  assert.deepEqual(b.screens, { home: null, result: resultPlan });
  assert.equal(Object.keys(b.assets).some((k) => k.startsWith('screens/screen-home')), false, 'aucune image de l’accueil');
  assert.equal(b.assets['screens/screen-result-v7-btn-finish.png'], 'RklO');
  assert.deepEqual(polaBundleWarnings(b, { screens }), [
    "écran d'accueil de la borne non téléchargé (la borne affichera l'écran standard)",
  ]);

  const none = full({ screens, screenImagesBase64: {} });
  assert.equal('screens' in none, false);
  assert.deepEqual(polaBundleWarnings(none, { screens }), [
    "écran d'accueil de la borne non téléchargé (la borne affichera l'écran standard)",
    "écran de partage de la borne non téléchargé (la borne affichera l'écran standard)",
  ]);
});

test('LAB-298 : polaScreens, nom de l’asset = dernier segment de l’adresse (sans ?, comme la borne)', () => {
  const plan = { ...resultPlan, buttons: [{ ...resultPlan.buttons[0], image: `${ORG}screen-result-v7-btn-finish.png?t=1` }] };
  const out = polaScreens({ result: plan }, { [`${ORG}screen-result-v7-btn-finish.png?t=1`]: 'RklO' });
  assert.deepEqual(out.block, { home: null, result: plan });
  assert.deepEqual(out.assets, { 'screens/screen-result-v7-btn-finish.png': 'RklO' });
});

test('LAB-331 : polices des textes vivants en assets screens/{nom}, une police manquante garde l’écran', () => {
  const text = (font, file) => ({ variable: 'event_name', x: 0, y: 0, w: 900, h: 200, font, weight: 700, font_file: file });
  const plan = {
    ...homePlan,
    texts: [
      text('Great Vibes', `${ORG}screen-home-v3-font-1.ttf`),
      text('Great Vibes', `${ORG}screen-home-v3-font-1.ttf`),
      text('Ma Police', `${ORG}screen-home-v3-font-2.otf`),
      text('DM Sans', null),
    ],
  };
  const screens = { home: plan, result: null };
  const images = { ...screenImages, [`${ORG}screen-home-v3-font-1.ttf`]: 'VFRG', [`${ORG}screen-home-v3-font-2.otf`]: 'T1RU' };
  const b = full({ screens, screenImagesBase64: images });
  assert.deepEqual(b.screens.home, plan);
  assert.equal(b.assets['screens/screen-home-v3-font-1.ttf'], 'VFRG');
  assert.equal(b.assets['screens/screen-home-v3-font-2.otf'], 'T1RU');
  assert.deepEqual(polaBundleWarnings(b, { screens }), []);

  const { [`${ORG}screen-home-v3-font-2.otf`]: _missing, ...partial } = images;
  const p = full({ screens, screenImagesBase64: partial });
  assert.deepEqual(p.screens.home, plan, 'écran gardé');
  assert.equal('screens/screen-home-v3-font-2.otf' in p.assets, false);
  assert.deepEqual(polaBundleWarnings(p, { screens }), [
    "police Ma Police de l'écran d'accueil de la borne non téléchargée (la borne écrira ces textes en DM Sans, sauf si elle l'a déjà)",
  ]);
});

// ── LAB-314 : choix du cadre par l'invité ──
const frameRow = (slot, over = {}) => ({
  id: `fr-${slot}`, kind: 'print', slot, status: 'approved', label: `Cadre ${slot}`, format: 'portrait',
  canvas_json: { objects: [{ slot }] }, final_png_url: `https://cdn/designs/ev-1/slot${slot}.png`, ...over,
});
const withChoice = (enabled, maxFrames = 3) => event({
  form_config: { kiosk: { ...event().form_config.kiosk, frame_choice: { enabled, max_frames: maxFrames } } },
});
const frameImages = { 'fr-2': 'RlIy', 'fr-3': 'RlIz' };

test('LAB-314 : sans frame_choice, bundle strictement identique à celui d’avant', () => {
  const expected = {
    version: 2,
    exported_at: '2026-11-04T10:00:00.000Z',
    event: {
      id: 'ev-1', org_id: 'org-1', name: 'Mariage Julie & Thomas', access_code: 'TUQNA5',
      start_date: '2026-06-14T14:00:00+00:00', end_date: '2026-06-15T02:00:00+00:00',
      form_config: { kiosk: { home: { title: 'Bienvenue', background_url: 'https://cdn/bg.jpg' }, capture: { countdown_seconds: 3 } } },
    },
    design: { id: 'ds-1', format: 'stripV', canvas_json: canvas, final_png_url: 'https://cdn/designs/ev-1/20261104.png' },
    assets: { design_png: 'UE5H', home_background: 'QkdI', logo: 'TE9H' },
    contact: { company: 'Studio Exemple', phone: '06 00 00 00 00', logo_url: LOGO_URL, email: 'x@y.fr' },
  };
  assert.deepEqual(full(), expected);
  // Même avec d'autres cadres validés passés à l'export : le choix est coupé, rien ne change.
  const frames = [frameRow(2), frameRow(3)];
  assert.deepEqual(full({ design: design({ label: 'Jour' }), frames, frameImagesBase64: frameImages }), expected);
  assert.deepEqual(polaBundleWarnings(full({ frames, frameImagesBase64: frameImages }), { frames }), []);
});

test('LAB-314 : choix coupé explicitement (enabled false ou non booléen) → ni label ni frames', () => {
  for (const enabled of [false, 'true', 1]) {
    const b = full({ event: withChoice(enabled), frames: [frameRow(2)], frameImagesBase64: frameImages });
    assert.deepEqual(Object.keys(b).sort(), ['assets', 'contact', 'design', 'event', 'exported_at', 'version']);
    assert.ok(!('label' in b.design));
    assert.deepEqual(Object.keys(b.assets).sort(), ['design_png', 'home_background', 'logo']);
    // La config de l'événement reste telle quelle (la borne lit frame_choice comme en ligne).
    assert.deepEqual(b.event.form_config.kiosk.frame_choice, { enabled, max_frames: 3 });
  }
});

test('LAB-314 : 3 cadres validés → design (cadre 1 avec label) + 2 cadres dans frames, avec leurs PNG', () => {
  const main = frameRow(1, { id: 'ds-1', label: 'Jour', final_png_url: 'https://cdn/designs/ev-1/20261104.png' });
  const frames = [frameRow(3), main, frameRow(2, { label: null })];
  const b = full({ event: withChoice(true), design: main, frames, frameImagesBase64: frameImages });
  assert.equal(b.version, 2);
  assert.deepEqual(b.design, {
    id: 'ds-1', format: 'portrait', canvas_json: { objects: [{ slot: 1 }] },
    final_png_url: 'https://cdn/designs/ev-1/20261104.png', label: 'Jour',
  });
  assert.deepEqual(b.frames, [
    { id: 'fr-2', slot: 2, label: null, format: 'portrait', canvas_json: { objects: [{ slot: 2 }] }, final_png_url: 'https://cdn/designs/ev-1/slot2.png' },
    { id: 'fr-3', slot: 3, label: 'Cadre 3', format: 'portrait', canvas_json: { objects: [{ slot: 3 }] }, final_png_url: 'https://cdn/designs/ev-1/slot3.png' },
  ]);
  assert.equal(b.assets.design_png, 'UE5H');
  assert.equal(b.assets['frame/fr-2'], 'RlIy');
  assert.equal(b.assets['frame/fr-3'], 'RlIz');
  assert.ok(!('frame/ds-1' in b.assets));
  assert.deepEqual(polaBundleWarnings(b, { frames }), []);
});

test('LAB-314 : choix actif sans autre cadre → frames vide (comme la RPC), label null', () => {
  const b = full({ event: withChoice(true) });
  assert.deepEqual(b.frames, []);
  assert.equal(b.design.label, null);
});

test('LAB-314 : PNG d’un cadre non téléchargé → cadre retiré de frames, admin prévenu', () => {
  const frames = [frameRow(2), frameRow(3, { label: 'Soirée' }), frameRow(4, { final_png_url: null, label: null })];
  const b = full({ event: withChoice(true, 4), frames, frameImagesBase64: { 'fr-2': 'RlIy' } });
  assert.deepEqual(b.frames.map((f) => f.id), ['fr-2']);
  assert.ok(!('frame/fr-3' in b.assets));
  assert.deepEqual(polaBundleWarnings(b, { frames }), [
    '« Cadre 3 · Soirée » non téléchargé (la borne ne le proposera pas aux invités)',
    '« Cadre 4 » non téléchargé (la borne ne le proposera pas aux invités)',
  ]);
});

test('LAB-314 : polaFrames ignore le cadre principal, les cadres non validés et l’écran d’accueil', () => {
  const kiosk = { frame_choice: { enabled: true, max_frames: 4 } };
  const frames = [frameRow(1, { id: 'ds-1' }), frameRow(2, { status: 'submitted' }), frameRow(3), { ...frameRow(4), kind: 'home' }];
  const { block, assets } = polaFrames(kiosk, { id: 'ds-1' }, frames, { 'ds-1': 'X', 'fr-2': 'Y', 'fr-3': 'Z', 'fr-4': 'W' });
  assert.deepEqual(block.map((f) => f.id), ['fr-3']);
  assert.deepEqual(assets, { 'frame/fr-3': 'Z' });
  assert.deepEqual(polaFrames({}, { id: 'ds-1' }, frames, {}), { block: null, assets: {} });
  assert.deepEqual(polaFrames(null, null, null), { block: null, assets: {} });
});
