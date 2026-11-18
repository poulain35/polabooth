import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fabric } from 'fabric';
import {
  ALLOWED,
  LOCK_ZONE,
  SAFE_ZONE,
  buildScreenLayout,
  buildScreenLayoutFromState,
  fontFileExtension,
  isTransparentBackground,
  liveFont,
  normalizeScreenLayout,
  screenFontName,
  screenImageName,
} from './kioskScreenLayout.js';
import { kioskScreenTemplate } from './kioskScreenTemplates.js';
import {
  KIOSK_LOCK_ZONE_EXPORT,
  KIOSK_SAFE_ZONE_EXPORT,
  formatById,
  kioskFormatByKind,
} from '../utils/formats.js';

// Cas de test communs avec la borne (ScreenLayout.Parse) : lus depuis docs/, sans copie.
const fixture = JSON.parse(
  readFileSync(new URL('../../../docs/specs/fixtures/kiosk-screen-layout-cases.json', import.meta.url), 'utf8'),
);

const codes = (list) => list.map((c) => c.code);
const withoutIgnored = ({ ignored: _ignored, ...rest }) => rest;
const withoutSize = ({ size: _size, ...rest }) => rest;

// ── Normalisation : cas communs ──

test('les valeurs permises du module sont celles des cas communs', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ALLOWED)), fixture.allowed);
});

for (const c of fixture.cases) {
  test(`cas commun : ${c.name}`, () => {
    assert.deepEqual(normalizeScreenLayout(c.layout), c.expected);
  });
}

test('normalisation : graisse DM Sans la plus proche, la plus fine en cas d’égalité', () => {
  const weight = (font, w, file = null) => liveFont(font, w, file).weight;
  assert.equal(weight('DM Sans', 450), 400);
  assert.equal(weight('DM Sans', 'bold'), 700);
  assert.equal(weight('DM Sans', '600'), 600);
  assert.equal(weight('DM Sans', 900), 700);
  assert.equal(weight('DM Sans', undefined), 400);
  assert.equal(weight('Fraunces', 300), 600);
  assert.equal(weight('Pacifico', 900), 700, 'sans fichier : DM Sans');
  assert.equal(weight('Pacifico', 'bold', 'f.ttf'), 700);
  assert.equal(weight('Pacifico', 1000, 'f.ttf'), 900);
  assert.equal(weight('Pacifico', 333.4, 'f.ttf'), 333);
  assert.equal(weight('Pacifico', 'x', 'f.ttf'), 400);
});

test('normalisation : police embarquée sans fichier, autre police gardée seulement avec son fichier', () => {
  assert.deepEqual(liveFont('"Fraunces 72pt SuperSoft"', 400, 'f.ttf'), { font: 'Fraunces', weight: 600, font_file: null });
  assert.deepEqual(liveFont('dm sans', 500, 'f.ttf'), { font: 'DM Sans', weight: 500, font_file: null });
  assert.deepEqual(liveFont(' Great Vibes ', 400, 'f.ttf'), { font: 'Great Vibes', weight: 400, font_file: 'f.ttf' });
  assert.deepEqual(liveFont('Great Vibes', 400, ''), { font: 'DM Sans', weight: 400, font_file: null });
  assert.deepEqual(liveFont(undefined, 600, 'f.ttf'), { font: 'DM Sans', weight: 600, font_file: null });
});

test('normalisation : plan illisible refusé', () => {
  assert.equal(normalizeScreenLayout(null), null);
  assert.equal(normalizeScreenLayout('{}'), null);
  assert.equal(normalizeScreenLayout({ version: 1, kind: 'constructor', size: { w: 1920, h: 1080 }, background: 'b.png' }), null);
  assert.equal(normalizeScreenLayout({ version: 0, kind: 'home', size: { w: 1920, h: 1080 }, background: 'b.png' }), null);
});

// ── Zones partagées avec l'éditeur ──

test('zones de sécurité et du cadenas identiques dans formats.js et le plan', () => {
  assert.deepEqual({ ...KIOSK_SAFE_ZONE_EXPORT }, { ...SAFE_ZONE });
  assert.deepEqual({ ...KIOSK_LOCK_ZONE_EXPORT }, { ...LOCK_ZONE });
  assert.equal(kioskFormatByKind('home').lockZoneExport, KIOSK_LOCK_ZONE_EXPORT);
  assert.equal(kioskFormatByKind('result').lockZoneExport, null);
  assert.equal(kioskFormatByKind('gallery'), null);
  // L'éditeur du client ne voit jamais les formats de la borne.
  assert.equal(formatById('kiosk_home'), null);
  assert.equal(formatById('kiosk_result'), null);
});

test('fond transparent', () => {
  for (const bg of ['', null, undefined, 'transparent', 'rgba(0,0,0,0)', 'rgba(255, 255, 255, 0)']) {
    assert.equal(isTransparentBackground(bg), true, String(bg));
  }
  for (const bg of ['#ffffff', 'rgba(0,0,0,0.5)', { type: 'linear' }]) {
    assert.equal(isTransparentBackground(bg), false, String(bg));
  }
});

// ── Géométrie : comparée à Fabric ──

const serialize = (o) => o.toObject(['kioskAction', 'kioskVariable', 'kioskSlot', 'personalizedOnly']);
// Plus petite boîte en px entiers qui contient la boîte de Fabric (×2), au millionième près.
const fabricBox = (o) => {
  const r = o.getBoundingRect(true, true);
  const x = Math.floor(r.left * 2 + 1e-6);
  const y = Math.floor(r.top * 2 + 1e-6);
  return { x, y, w: Math.ceil((r.left + r.width) * 2 - 1e-6) - x, h: Math.ceil((r.top + r.height) * 2 - 1e-6) - y };
};
const buttonOf = (objects, kind = 'home') => buildScreenLayout(objects.map(serialize), kind).layout.buttons[0];

test('boîte d’un bouton = boîte englobante de Fabric (rotation, échelle, origine, contour)', () => {
  const variants = [
    new fabric.Rect({ left: 300, top: 200, width: 120, height: 60, kioskAction: 'start' }),
    new fabric.Rect({ left: 300, top: 200, width: 120, height: 60, angle: 17, strokeWidth: 4, stroke: '#000', kioskAction: 'start' }),
    new fabric.Rect({ left: 400, top: 300, width: 80, height: 40, scaleX: 1.5, scaleY: 0.8, angle: -30, originX: 'center', originY: 'center', kioskAction: 'start' }),
    new fabric.Rect({ left: 400, top: 300, width: 80, height: 40, flipX: true, angle: 95, originX: 'right', originY: 'bottom', kioskAction: 'start' }),
    new fabric.Circle({ left: 500, top: 100, radius: 40, strokeWidth: 3, stroke: '#000', strokeUniform: true, scaleX: 2, kioskAction: 'start' }),
  ];
  for (const o of variants) assert.deepEqual(withoutImage(buttonOf([o])), fabricBox(o));

  const g = new fabric.Group([
    new fabric.Rect({ left: 100, top: 100, width: 200, height: 60, rx: 30, strokeWidth: 0 }),
    new fabric.Circle({ left: 110, top: 120, radius: 10, strokeWidth: 0 }),
  ], { kioskAction: 'start' });
  g.rotate(12);
  g.scale(1.3);
  assert.deepEqual(withoutImage(buttonOf([g])), fabricBox(g));
});

test('boîte d’un bouton avec ombre : élargie du flou et du décalage (le PNG ne la coupe pas)', () => {
  const plain = new fabric.Rect({ left: 300, top: 200, width: 120, height: 60, strokeWidth: 0, kioskAction: 'start' });
  const base = withoutImage(buttonOf([plain]));
  assert.deepEqual(base, { x: 600, y: 400, w: 240, h: 120 });

  // Flou 10, décalage (4, 6), échelle 1 : gauche 6, droite 14, haut 4, bas 16 (px canvas) → ×2.
  const shadowed = new fabric.Rect({
    left: 300, top: 200, width: 120, height: 60, strokeWidth: 0, kioskAction: 'start',
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.3)', blur: 10, offsetX: 4, offsetY: 6 }),
  });
  assert.deepEqual(withoutImage(buttonOf([shadowed])), { x: 588, y: 392, w: 280, h: 160 });

  // Échelle 2 : flou et décalage doublés ; nonScaling : non.
  const scaled = new fabric.Rect({
    left: 300, top: 200, width: 60, height: 30, scaleX: 2, scaleY: 2, strokeWidth: 0, kioskAction: 'start',
    shadow: new fabric.Shadow({ color: '#000', blur: 5, offsetX: 2, offsetY: 3 }),
  });
  assert.deepEqual(withoutImage(buttonOf([scaled])), { x: 588, y: 392, w: 280, h: 160 });
  scaled.shadow.nonScaling = true;
  assert.deepEqual(withoutImage(buttonOf([scaled])), { x: 594, y: 396, w: 260, h: 140 });

  // Ombre d'un enfant du groupe bouton.
  const g = new fabric.Group([
    new fabric.Rect({ left: 300, top: 200, width: 120, height: 60, strokeWidth: 0,
      shadow: new fabric.Shadow({ color: '#000', blur: 8, offsetX: 0, offsetY: 0 }) }),
  ], { kioskAction: 'start' });
  assert.deepEqual(withoutImage(buttonOf([g])), { x: 584, y: 384, w: 272, h: 152 });
});

test('boîte d’un bouton arrondi à une position non entière : contient tout le contour (LAB-318)', () => {
  // Bords non entiers en px d'export : arrondis au plus proche, un bord en ,3 ou ,4 perdait son dernier pixel.
  for (const left of [300.15, 300.3, 300.45, 300.7, 300.85]) {
    const pill = new fabric.Rect({
      left, top: 200.2, width: 120.2, height: 60.3, rx: 30, ry: 30, strokeWidth: 1, stroke: '#24412F', kioskAction: 'start',
    });
    const r = pill.getBoundingRect(true, true);
    const box = withoutImage(buttonOf([pill]));
    assert.ok(box.x <= r.left * 2 + 1e-6 && box.y <= r.top * 2 + 1e-6, `${left} : début ${JSON.stringify(box)}`);
    assert.ok(box.x + box.w >= (r.left + r.width) * 2 - 1e-6, `${left} : bord droit ${JSON.stringify(box)} / ${(r.left + r.width) * 2}`);
    assert.ok(box.y + box.h >= (r.top + r.height) * 2 - 1e-6, `${left} : bord bas ${JSON.stringify(box)}`);
    // Jamais plus d'un pixel de marge vide de chaque côté.
    assert.ok(box.w < r.width * 2 + 2 && box.h < r.height * 2 + 2, JSON.stringify(box));
  }
  // Bords entiers (y compris après une rotation de 90°, cos ≈ 6e-17) : aucun pixel ajouté.
  assert.deepEqual(withoutImage(buttonOf([new fabric.Rect({ left: 300, top: 200, width: 120, height: 60, strokeWidth: 0, kioskAction: 'start' })])),
    { x: 600, y: 400, w: 240, h: 120 });
  const turned = new fabric.Rect({ left: 400, top: 300, width: 120, height: 60, angle: 90, originX: 'center', originY: 'center', strokeWidth: 0, kioskAction: 'start' });
  assert.deepEqual(withoutImage(buttonOf([turned])), { x: 740, y: 480, w: 120, h: 240 });
});

test('zone 16:10 : un bouton qui dépasse d’une fraction de pixel est refusé, au bord exact accepté', () => {
  assert.deepEqual(codes(buildScreenLayout([btn('start', 48, 400, 200, 60)], 'home').blocking), []);
  // 47,8 px canvas = 95,6 px d'export : son bord gauche serait coupé sur un écran 16:10.
  assert.deepEqual(codes(buildScreenLayout([btn('start', 47.8, 400, 200, 60)], 'home').blocking), ['outside_safe_zone']);
  // Bord droit de la zone : 912 px canvas (1824 px d'export) ; 912,2 donnait 1824 arrondi, 1825 désormais.
  assert.deepEqual(codes(buildScreenLayout([btn('start', 712, 400, 200, 60)], 'home').blocking), []);
  assert.deepEqual(codes(buildScreenLayout([btn('start', 712.2, 400, 200, 60)], 'home').blocking), ['outside_safe_zone']);
});

function withoutImage({ action: _a, image: _i, ...box }) {
  return box;
}

test('emplacement et texte : rectangle non tourné autour du centre de Fabric + angle', () => {
  const slot = new fabric.Rect({ left: 100, top: 60, width: 200, height: 300, angle: -4, rx: 6, strokeWidth: 0, kioskSlot: 'last_photo' });
  const { layout } = buildScreenLayout([serialize(slot)], 'home');
  const c = slot.getCenterPoint();
  assert.deepEqual(layout.slots, [{
    slot: 'last_photo',
    x: Math.round(c.x * 2 - 200), y: Math.round(c.y * 2 - 300), w: 400, h: 600, angle: -4, radius: 12,
  }]);

  const textObj = {
    type: 'textbox', left: 50, top: 40, width: 300, height: 61.02, fontSize: 27, lineHeight: 1, strokeWidth: 1,
    scaleX: 1, scaleY: 1, angle: 0, fontFamily: 'Fraunces', fontWeight: 'bold', fill: '#24412F',
    textAlign: 'justify', textTransform: 'uppercase', charSpacing: 120, kioskVariable: 'event_name', personalizedOnly: true,
  };
  assert.deepEqual(buildScreenLayout([textObj], 'home').layout.texts, [{
    variable: 'event_name', x: 101, y: 81, w: 600, h: 122, angle: 0,
    font: 'Fraunces', weight: 600, font_file: null, size: 54, color: '#24412F', align: 'left',
    uppercase: true, char_spacing: 120, max_lines: 2, personalized_only: true,
  }]);
});

// ── Plan et contrôles D11 ──

const btn = (action, left, top, width = 100, height = 60, extra = {}) => ({
  type: 'rect', left, top, width, height, strokeWidth: 0, kioskAction: action, ...extra,
});
const previewSlot = { type: 'rect', left: 60, top: 60, width: 200, height: 300, strokeWidth: 0, kioskSlot: 'photo_preview' };
const allResultButtons = () => [
  btn('print', 600, 200), btn('copies_minus', 600, 280), btn('copies_plus', 720, 280),
  btn('email', 600, 360), btn('qr', 720, 360), btn('retake', 600, 440), btn('finish', 720, 440),
];

test('plan : noms d’images, fonds et parties à exporter', () => {
  const decor = { type: 'rect', left: 0, top: 0, width: 960, height: 540, strokeWidth: 0, fill: '#fff' };
  const welcome = { type: 'textbox', left: 10, top: 10, width: 200, height: 20, text: 'BIENVENUE', personalizedOnly: true };
  const objects = [decor, welcome, btn('start', 300, 400, 200, 60), btn('gallery', 700, 440, 100, 60)];
  const { layout, blocking, parts } = buildScreenLayout(objects, 'home', { version: 3 });
  assert.deepEqual(blocking, []);
  assert.equal(layout.background, 'screen-home-v3-bg.png');
  assert.equal(layout.background_neutral, 'screen-home-v3-bg-neutral.png');
  assert.deepEqual(layout.size, { w: 1920, h: 1080 });
  assert.deepEqual(layout.buttons.map((b) => b.image), ['screen-home-v3-btn-start.png', 'screen-home-v3-btn-gallery.png']);
  assert.deepEqual(parts.background.objectIndices, [0, 1]);
  assert.deepEqual(parts.backgroundNeutral.objectIndices, [0]);
  assert.deepEqual(parts.buttons.map((b) => b.objectIndex), [2, 3]);
  assert.deepEqual(parts.liveIndices, [2, 3]);
  assert.equal(screenImageName('result', 7, 'btn-qr'), 'screen-result-v7-btn-qr.png');
});

test('plan : fond transparent sans décor → pas d’image de fond', () => {
  const { layout } = buildScreenLayout([btn('start', 300, 400, 200, 60)], 'home', { transparentBackground: true });
  assert.equal(layout.background, null);
  assert.equal(layout.transparent_background, true);
  assert.equal(layout.background_neutral, null);
  const fromState = buildScreenLayoutFromState(JSON.stringify({ bg: '', bgType: 'solid', objects: [btn('start', 300, 400, 200, 60)] }), 'home');
  assert.equal(fromState.layout.transparent_background, true);
});

test('bloquant : bouton hors de la zone 16:10', () => {
  const r = buildScreenLayout([btn('start', 20, 400, 200, 60)], 'home');
  assert.deepEqual(codes(r.blocking), ['outside_safe_zone']);
  assert.match(r.blocking[0].message, /« Commencer »/);
  // Juste au bord : accepté (x = 96 px d'export).
  assert.deepEqual(codes(buildScreenLayout([btn('start', 48, 400, 200, 60)], 'home').blocking), []);
});

test('bloquant : seule l’ombre sort de la zone 16:10 ou touche le cadenas → le message parle de l’ombre (LAB-317)', () => {
  const shadow = { color: 'rgba(0,0,0,0.4)', blur: 20, offsetX: 0, offsetY: 0 };
  // Bouton au bord exact de la zone (x = 96 px d'export), ombre de 40 px d'export qui en sort.
  const nearEdge = buildScreenLayout([btn('start', 48, 400, 200, 60, { shadow })], 'home');
  assert.deepEqual(codes(nearEdge.blocking), ['outside_safe_zone']);
  assert.match(nearEdge.blocking[0].message, /^L'ombre du bouton « Commencer » sort de la zone/);
  // Bouton lui-même hors zone : message habituel, même avec une ombre.
  const outside = buildScreenLayout([btn('start', 20, 400, 200, 60, { shadow })], 'home');
  assert.match(outside.blocking[0].message, /^Le bouton « Commencer » sort de la zone/);
  // Cadenas : x 1716..1792, y 32..108 (px d'export) ; bouton juste à gauche, ombre dessus.
  const besideLock = buildScreenLayout([btn('gallery', 800, 20, 57, 50, { shadow })], 'home');
  assert.deepEqual(codes(besideLock.blocking), ['on_lock_zone']);
  assert.match(besideLock.blocking[0].message, /^L'ombre du bouton « Photos » déborde sur la zone du cadenas/);
  const onLock = buildScreenLayout([btn('gallery', 850, 20, 50, 50, { shadow })], 'home');
  assert.match(onLock.blocking.find((c) => c.code === 'on_lock_zone').message, /^Le bouton « Photos » est sur la zone du cadenas/);
});

test('bloquant : bouton sur le cadenas (accueil seulement)', () => {
  const onLock = btn('gallery', 850, 0, 50, 60);
  assert.deepEqual(codes(buildScreenLayout([onLock], 'home').blocking), ['on_lock_zone']);
  const result = buildScreenLayout([previewSlot, ...allResultButtons().slice(0, 6), btn('finish', 840, 0, 60, 60)], 'result');
  assert.deepEqual(codes(result.blocking), []);
});

test('bloquant : action en double (ex. après un copier-coller), seul le premier reste dans le plan', () => {
  const r = buildScreenLayout([btn('start', 100, 100, 200, 60), btn('start', 400, 300, 200, 60)], 'home');
  assert.deepEqual(codes(r.blocking), ['duplicate_action']);
  assert.match(r.blocking[0].message, /« Commencer » figure sur 2 boutons/);
  assert.equal(r.layout.buttons.length, 1);
  assert.equal(r.layout.buttons[0].x, 200);
});

test('bloquant : partage sans aperçu de la photo ni bouton Terminer', () => {
  const r = buildScreenLayout(allResultButtons().slice(0, 6), 'result');
  assert.deepEqual(codes(r.blocking), ['missing_photo_preview', 'missing_finish']);
});

test('avertissements : petit bouton, chevauchement, fonction sans bouton', () => {
  const small = buildScreenLayout([btn('start', 300, 300, 40, 60)], 'home');
  assert.deepEqual(codes(small.blocking), []);
  assert.deepEqual(codes(small.warnings), ['small_button', 'missing_action']);
  assert.match(small.warnings[0].message, /80×120 px/);
  assert.match(small.warnings[1].message, /« Photos »/);

  const overlap = buildScreenLayout([btn('start', 300, 300, 200, 60), btn('gallery', 450, 320, 100, 60)], 'home');
  assert.deepEqual(codes(overlap.warnings), ['overlapping_buttons']);

  const noEmail = buildScreenLayout([previewSlot, ...allResultButtons().filter((b) => b.kioskAction !== 'email')], 'result');
  assert.deepEqual(codes(noEmail.blocking), []);
  assert.deepEqual(noEmail.warnings, [{
    code: 'missing_action',
    message: 'Pas de bouton « Email » : les invités ne pourront pas recevoir la photo par email.',
  }]);
});

test('objets marqués : action d’un autre écran, élément dans un groupe', () => {
  const r = buildScreenLayout([
    btn('print', 300, 300, 200, 60),
    { type: 'group', left: 10, top: 10, width: 100, height: 100, objects: [btn('gallery', -50, -50, 100, 100)] },
    { type: 'textbox', left: 100, top: 100, width: 200, height: 30, fontFamily: 'Pacifico', kioskVariable: 'event_date' },
  ], 'home');
  assert.deepEqual(codes(r.warnings), ['unknown_action', 'marked_in_group', 'missing_action']);
  assert.deepEqual(r.layout.buttons, []);
  assert.deepEqual(r.parts.background.objectIndices, [0, 1]);
});

// ── Polices des textes vivants (LAB-331) ──

const liveText = (variable, fontFamily, fontWeight = 400) => ({
  type: 'textbox', left: 100, top: 100, width: 200, height: 30, fontFamily, fontWeight, kioskVariable: variable,
});

test('polices : Google et importée TTF jointes au plan, embarquées sans fichier', () => {
  const customFonts = [
    { name: 'Ma Police', url: 'https://x.supabase.co/storage/v1/object/public/fonts/123-abc.OTF?v=2' },
  ];
  const r = buildScreenLayout([
    liveText('event_name', 'Pacifico', 'bold'),
    liveText('event_date', 'Fraunces', 400),
  ], 'home', { version: 4, customFonts });
  assert.deepEqual(r.warnings.filter((w) => w.code.startsWith('live_font')), []);
  assert.deepEqual(r.layout.texts.map(({ font, weight, font_file }) => ({ font, weight, font_file })), [
    { font: 'Pacifico', weight: 700, font_file: 'screen-home-v4-font-1.ttf' },
    { font: 'Fraunces', weight: 600, font_file: null },
  ]);
  assert.deepEqual(r.parts.fonts, [
    { name: 'screen-home-v4-font-1.ttf', family: 'Pacifico', weight: 700, source: 'google', url: null },
  ]);

  const custom = buildScreenLayout([liveText('event_name', 'Ma Police', 300), liveText('event_date', 'Ma Police', 700)],
    'home', { version: 2, customFonts });
  assert.deepEqual(custom.parts.fonts, [
    { name: 'screen-home-v2-font-1.otf', family: 'Ma Police', weight: 300, source: 'custom', url: customFonts[0].url },
  ]);
  assert.deepEqual(custom.layout.texts.map((t) => [t.weight, t.font_file]),
    [[300, 'screen-home-v2-font-1.otf'], [700, 'screen-home-v2-font-1.otf']]);
});

test('polices : une famille Google par graisse, sans doublon', () => {
  const r = buildScreenLayout([
    liveText('copies', 'Roboto', 400), liveText('countdown', 'Roboto', 700), liveText('share_status', 'Roboto', 'bold'),
  ], 'result', { version: 3 });
  assert.deepEqual(r.parts.fonts.map((f) => [f.name, f.weight]),
    [['screen-result-v3-font-1.ttf', 400], ['screen-result-v3-font-2.ttf', 700]]);
  assert.deepEqual(r.layout.texts.map((t) => t.font_file),
    ['screen-result-v3-font-1.ttf', 'screen-result-v3-font-2.ttf', 'screen-result-v3-font-2.ttf']);
});

test('polices : importée en WOFF2 → avertissement, texte en DM Sans', () => {
  const r = buildScreenLayout([liveText('event_name', 'Douce', 650)], 'home',
    { customFonts: [{ name: 'Douce', url: 'https://x/fonts/douce.woff2' }] });
  const w = r.warnings.find((x) => x.code === 'live_font_format');
  assert.match(w.message, /utilise Douce, importée en WOFF ou WOFF2 : la borne écrira ce texte en DM Sans/);
  assert.deepEqual(r.parts.fonts, []);
  assert.deepEqual([r.layout.texts[0].font, r.layout.texts[0].weight, r.layout.texts[0].font_file], ['DM Sans', 600, null]);
});

test('polices : noms de fichier et extension', () => {
  assert.equal(screenFontName('result', 12, 3, 'otf'), 'screen-result-v12-font-3.otf');
  assert.equal(fontFileExtension('https://x/a.TTF?download=1'), 'ttf');
  assert.equal(fontFileExtension('https://x/a.otf#x'), 'otf');
  assert.equal(fontFileExtension('https://x/a.woff2'), null);
  assert.equal(fontFileExtension(null), null);
});

// ── Modèles d'origine ──

for (const kind of ['home', 'result']) {
  test(`modèle d’origine « ${kind} » : aucun contrôle bloquant, ni avertissement`, () => {
    const state = kioskScreenTemplate(kind);
    const r = buildScreenLayoutFromState(state, kind);
    assert.deepEqual(r.blocking, []);
    assert.deepEqual(r.warnings, []);
    const expectedActions = kind === 'home' ? ALLOWED.home.actions : ALLOWED.result.actions;
    assert.deepEqual([...r.layout.buttons.map((b) => b.action)].sort(), [...expectedActions].sort());
    assert.deepEqual(r.layout.texts.map((t) => t.variable).sort(), [...ALLOWED[kind].variables].sort());
    assert.deepEqual(r.layout.slots.map((s) => s.slot), [...ALLOWED[kind].slots]);
  });

  test(`modèle d’origine « ${kind} » : normaliser le plan produit le rend tel quel`, () => {
    const { layout } = buildScreenLayoutFromState(kioskScreenTemplate(kind), kind, { version: 5 });
    const normalized = normalizeScreenLayout(layout);
    assert.deepEqual(normalized.ignored, []);
    assert.deepEqual(withoutIgnored(normalized), withoutSize(layout));
  });
}

test('modèles d’origine : boutons, textes et emplacements à leur place', () => {
  const home = buildScreenLayoutFromState(kioskScreenTemplate('home'), 'home').layout;
  assert.equal(home.background_neutral, 'screen-home-v1-bg-neutral.png');
  assert.equal(home.slots[0].angle, -4);
  const name = home.texts.find((t) => t.variable === 'event_name');
  assert.equal(name.font, 'Fraunces');
  assert.equal(name.max_lines, 2);
  assert.equal(name.personalized_only, true);

  const result = buildScreenLayoutFromState(kioskScreenTemplate('result'), 'result').layout;
  assert.equal(result.background_neutral, null);
  assert.equal(result.slots[0].angle, -2);
  const byAction = Object.fromEntries(result.buttons.map((b) => [b.action, b]));
  // Bloc d'impression (D10) : − à gauche de +, Imprimer en dessous.
  assert.ok(byAction.copies_minus.x < byAction.copies_plus.x);
  assert.ok(byAction.print.y > byAction.copies_plus.y + byAction.copies_plus.h - 1);
  assert.ok(byAction.finish.x > byAction.retake.x);
});

test('modèles d’origine : chaque texte porte `styles` (sinon Fabric 5 ne sait plus le sérialiser)', () => {
  // Un Textbox relu sans `styles` garde styles = undefined et toObject() lève une exception :
  // l'éditeur ne pouvait ni enregistrer ni garder d'historique sur le modèle d'origine.
  const texts = (objects) => objects.flatMap((o) => [
    ...(['textbox', 'text', 'i-text'].includes(o.type) ? [o] : []),
    ...texts(Array.isArray(o.objects) ? o.objects : []),
  ]);
  for (const kind of ['home', 'result']) {
    const found = texts(kioskScreenTemplate(kind).objects);
    assert.ok(found.length > 0, kind);
    for (const t of found) assert.ok(Array.isArray(t.styles), `${kind} : « ${t.text} » sans styles`);
  }
});

test('modèles d’origine : le contour des boutons reste dans la boîte du groupe (PNG non coupé)', () => {
  // Le PNG d'un bouton est recadré sur la boîte du groupe : un contour qui déborde y était coupé
  // à droite et en bas (bouton Photos de l'accueil LAB-299, boutons du partage LAB-318). Fabric 5
  // place le bord extérieur du contour en `left`/`top` et lui donne `width + strokeWidth` : le
  // contour doit aller d'un bord à l'autre de la boîte, sans la dépasser ni laisser de vide.
  const eps = 0.02;
  // Arrondi au centième des positions relatives au centre du groupe : au plus un demi-centième.
  const rounding = 0.006;
  for (const kind of ['home', 'result']) {
    const groups = kioskScreenTemplate(kind).objects.filter((o) => o.type === 'group' && o.kioskAction);
    assert.ok(groups.length > 0, kind);
    let stroked = 0;
    for (const g of groups) {
      for (const child of g.objects.filter((c) => c.stroke && c.strokeWidth > 0)) {
        stroked += 1;
        const where = `${kind} : ${g.kioskAction}`;
        const right = child.left + child.width + child.strokeWidth;
        const bottom = child.top + child.height + child.strokeWidth;
        assert.ok(Math.abs(child.left + g.width / 2) <= eps, `${where} : bord gauche ${child.left} ≠ ${-g.width / 2}`);
        assert.ok(Math.abs(child.top + g.height / 2) <= eps, `${where} : bord haut ${child.top} ≠ ${-g.height / 2}`);
        assert.ok(right <= g.width / 2 + rounding, `${where} déborde à droite (${right} > ${g.width / 2})`);
        assert.ok(bottom <= g.height / 2 + rounding, `${where} déborde en bas (${bottom} > ${g.height / 2})`);
        assert.ok(right >= g.width / 2 - eps, `${where} : vide à droite`);
        assert.ok(bottom >= g.height / 2 - eps, `${where} : vide en bas`);
      }
    }
    assert.ok(stroked > 0, `${kind} : aucun bouton à contour`);
  }
});

test('modèles d’origine : un cercle relu deux fois par Fabric ne bouge pas (pas d’alerte après annulation, LAB-317)', async () => {
  // L'annulation relit l'état enregistré au chargement : un rayon arrondi à part (37,13 pour 74,25 de
  // large) donnait 74,26 à la deuxième lecture, et la garde voyait une modification.
  const circles = (objects) => objects.flatMap((o) => [
    ...(o.type === 'circle' ? [o] : []),
    ...circles(Array.isArray(o.objects) ? o.objects : []),
  ]);
  const enliven = (o) => new Promise((resolve) => fabric.util.enlivenObjects([o], (list) => resolve(list[0])));
  for (const kind of ['home', 'result']) {
    const found = circles(kioskScreenTemplate(kind).objects);
    assert.ok(found.length > 0, kind);
    for (const c of found) {
      const first = (await enliven(c)).toObject();
      const second = (await enliven(JSON.parse(JSON.stringify(first)))).toObject();
      assert.equal(first.width, c.width, `${kind} : largeur relue ${first.width} ≠ ${c.width}`);
      assert.deepEqual(second, first, `${kind} : cercle de rayon ${c.radius} modifié à la relecture`);
    }
  }
});

test('modèle d’accueil avec le logo de la société', () => {
  const state = kioskScreenTemplate('home', { logo: { url: 'https://exemple.fr/logo.png', width: 560, height: 96 } });
  const logo = state.objects.find((o) => o.type === 'image');
  assert.equal(logo.src, 'https://exemple.fr/logo.png');
  assert.ok(logo.width * logo.scaleX <= 280 * 0.675 + 0.01);
  assert.ok(logo.height * logo.scaleY <= 48 * 0.675 + 0.01);
  const named = kioskScreenTemplate('home', { brandName: 'Studio Lumière' });
  assert.ok(named.objects.some((o) => o.text === 'Studio Lumière'));
});

// ── Éditeur : les marques de la borne survivent à l'enregistrement et au copier-coller ──

// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');

const KIOSK_PROPS = ['kioskAction', 'kioskVariable', 'kioskSlot', 'personalizedOnly'];

test('Editor.jsx : CUSTOM_PROPS et CLONE_PROPS gardent les 4 marques de la borne', () => {
  const src = readEditor();
  for (const name of ['CUSTOM_PROPS', 'CLONE_PROPS']) {
    const start = src.indexOf(`const ${name} = [`);
    assert.ok(start >= 0, `${name} introuvable`);
    const list = src.slice(start, src.indexOf('];', start));
    for (const p of KIOSK_PROPS) assert.ok(list.includes(`'${p}'`), `${name} sans ${p}`);
  }
});

test('marques de la borne : enregistrer puis relire (JSON) et cloner gardent les valeurs', async () => {
  const shape = new fabric.Rect({ width: 120, height: 60, originX: 'center', originY: 'center' });
  // Pas de texte : jsdom ne sait pas le mesurer. La marque se garde de la même façon sur un Textbox.
  const caption = new fabric.Circle({ radius: 10, originX: 'center', originY: 'center' });
  const button = new fabric.Group([shape, caption], { left: 300, top: 300 });
  button.kioskAction = 'gallery';
  const live = new fabric.Rect({ width: 300, height: 40, left: 100, top: 100 });
  live.kioskVariable = 'event_name';
  live.personalizedOnly = true;
  const slot = new fabric.Rect({ left: 500, top: 100, width: 200, height: 150, angle: -4 });
  slot.kioskSlot = 'last_photo';

  const saved = JSON.parse(JSON.stringify([button, live, slot].map((o) => o.toObject(KIOSK_PROPS))));
  assert.equal(saved[0].kioskAction, 'gallery');
  assert.equal(saved[0].kioskVariable, undefined);
  const restored = await new Promise((resolve) => fabric.util.enlivenObjects(saved, resolve));
  assert.equal(restored[0].type, 'group');
  assert.equal(restored[0].kioskAction, 'gallery');
  assert.equal(restored[1].kioskVariable, 'event_name');
  assert.equal(restored[1].personalizedOnly, true);
  assert.equal(restored[2].kioskSlot, 'last_photo');

  const copy = await new Promise((resolve) => restored[0].clone(resolve, KIOSK_PROPS));
  assert.equal(copy.kioskAction, 'gallery');
  // Le doublon d'action est signalé par le plan.
  const { blocking } = buildScreenLayout([restored[0], copy], 'home');
  assert.ok(blocking.some((b) => b.code === 'duplicate_action'), JSON.stringify(blocking));
});
