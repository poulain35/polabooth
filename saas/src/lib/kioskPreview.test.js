import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fabric } from 'fabric';
import { IN_PUBLIC_REPO } from '../../scripts/private-history.mjs';
import {
  DEFAULT_PREVIEW_SCREEN,
  HOME_SURFACE_HEIGHT,
  PREVIEW_MESSAGES,
  PREVIEW_SCREENS,
  USER_PHOTO_MAX_BYTES,
  coverBox,
  fitScale,
  homeScreenGeometry,
  homeStartMode,
  homeSurfaceSize,
  nextSampleOffset,
  prepareDesignPreview,
  prepareScreenPreview,
  prepareStoredDesignPreview,
  previewScreenById,
  samplePhotoOrder,
  userPhotoError,
  zonesFromCanvasJson,
} from './kioskPreview.js';
import { findPhotoZones, photoZoneRect } from './photoZones.js';
import { zoneFromRect } from './kioskComposite.js';
import { KIOSK_PREVIEW_PHOTOS } from './kioskPreviewPhotos.js';
import { exportAsHighResPNG } from '../utils/export.js';
import { FORMATS, HOME_FORMAT, kioskFormatByKind } from '../utils/formats.js';
import { buildScreenLayoutFromState } from './kioskScreenLayout.js';
import { kioskScreenTemplate } from './kioskScreenTemplates.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── Écrans et géométrie ──

test('écran 16:10 (1280×800) par défaut, 16:9 au choix', () => {
  assert.equal(DEFAULT_PREVIEW_SCREEN.id, '16:10');
  assert.deepEqual(PREVIEW_SCREENS.map((s) => [s.id, s.width, s.height]), [['16:10', 1280, 800], ['16:9', 1920, 1080]]);
  assert.equal(previewScreenById('16:9').width, 1920);
  assert.equal(previewScreenById('inconnu'), DEFAULT_PREVIEW_SCREEN);
});

test('surface de l\'accueil : 800 de haut, largeur à la proportion de l\'écran', () => {
  assert.deepEqual(homeSurfaceSize(previewScreenById('16:10')), { width: 1280, height: HOME_SURFACE_HEIGHT });
  assert.ok(close(homeSurfaceSize(previewScreenById('16:9')).width, 800 * 16 / 9));
  // Écran plus étroit que 3:2 : au moins 1200 de large (DesignSurface de la borne).
  assert.equal(homeSurfaceSize({ width: 1024, height: 768 }).width, 1200);
});

test('16:10 coupe à gauche et à droite la bande de la zone de sécurité de l\'éditeur', () => {
  const g = homeScreenGeometry(previewScreenById('16:10'));
  assert.ok(close(g.cut.x, 96));
  assert.ok(close(g.cut.x, (HOME_FORMAT.safeZoneInsetX * HOME_FORMAT.exportWidth) / HOME_FORMAT.canvasWidth));
  assert.equal(g.cut.y, 0);
  assert.ok(close(g.image.height, 800));
});

test('16:9 ne coupe rien', () => {
  const g = homeScreenGeometry(previewScreenById('16:9'));
  assert.ok(close(g.cut.x, 0));
  assert.ok(close(g.cut.y, 0));
  assert.ok(close(g.image.width, g.surface.width));
});

test('cover centré et taille réduite sans déformation', () => {
  const c = coverBox(1920, 1080, 1280, 800);
  assert.ok(close(c.scale, 800 / 1080));
  assert.ok(close(c.left, (1280 - c.width) / 2));
  assert.equal(c.top, 0);
  assert.equal(fitScale(1280, 800, 640, 800), 0.5);
  assert.equal(fitScale(0, 800, 640, 800), 0);
});

test('pastille pour un format, tuiles pour plusieurs', () => {
  assert.equal(homeStartMode([]), 'pill');
  assert.equal(homeStartMode([{ format: 'photo' }]), 'pill');
  assert.equal(homeStartMode([{ format: 'photo' }, { format: 'gif' }]), 'tiles');
  assert.equal(homeStartMode(undefined), 'pill');
});

// ── Photos d'exemple ──

test('une photo différente par zone tant qu\'il y en a assez', () => {
  for (let zones = 1; zones <= 6; zones++) {
    const order = samplePhotoOrder(zones, 6);
    assert.equal(order.length, zones);
    assert.equal(new Set(order).size, zones);
  }
  // Plus de zones que de photos : on reboucle.
  assert.deepEqual(samplePhotoOrder(8, 6), [0, 1, 2, 3, 4, 5, 0, 1]);
  // Sans zone (fond plein) : une photo quand même.
  assert.equal(samplePhotoOrder(0, 6).length, 1);
  assert.deepEqual(samplePhotoOrder(3, 0), []);
});

test('« Autres photos » change la photo de chaque zone', () => {
  for (let zones = 1; zones <= 6; zones++) {
    const before = samplePhotoOrder(zones, 6, 0);
    const after = samplePhotoOrder(zones, 6, nextSampleOffset(0, zones, 6));
    before.forEach((p, i) => assert.notEqual(after[i], p, `zones=${zones}, zone ${i}`));
  }
  assert.equal(nextSampleOffset(4, 1, 6), 5);
  assert.equal(nextSampleOffset(5, 1, 6), 0);
});

test('photo de l\'utilisateur : JPEG, PNG ou WebP, 20 Mo au plus', () => {
  assert.equal(userPhotoError({ type: 'image/jpeg', size: 1000 }), null);
  assert.equal(userPhotoError({ type: 'image/png', size: USER_PHOTO_MAX_BYTES }), null);
  assert.equal(userPhotoError({ type: 'image/webp', size: 10 }), null);
  assert.equal(userPhotoError({ type: 'image/jpeg', size: USER_PHOTO_MAX_BYTES + 1 }), PREVIEW_MESSAGES.photoTooLarge);
  assert.equal(userPhotoError({ type: 'image/gif', size: 10 }), PREVIEW_MESSAGES.photoWrongType);
  assert.equal(userPhotoError({ type: 'image/heic', size: 10 }), PREVIEW_MESSAGES.photoWrongType);
  assert.equal(userPhotoError(null), null);
});

// ── Préparation : le design ne change pas (D10) ──

// Canvas d'éditeur minimal : agrandi (Option A, marge autour du modèle), avec de vrais objets Fabric.
function fakeEditorCanvas(objects, { failOnExport = false } = {}) {
  const fired = [];
  const canvas = {
    width: 520,
    height: 720,
    viewportTransform: [1, 0, 0, 1, 60, 60],
    backgroundColor: '#ffeedd',
    backgroundImage: null,
    _exportMode: false,
    getObjects: () => objects,
    setWidth(w) { this.width = w; },
    setHeight(h) { this.height = h; },
    setViewportTransform(vt) { this.viewportTransform = vt; },
    renderAll() {},
    toDataURL() {
      if (failOnExport) throw new Error('tainted canvas');
      return 'data:image/png;base64,AAAA';
    },
    fire: (name) => fired.push(name),
    on: (name) => fired.push(`on:${name}`),
  };
  return { canvas, fired };
}

function snapshot(canvas) {
  return {
    width: canvas.width,
    height: canvas.height,
    vt: canvas.viewportTransform.slice(),
    bg: canvas.backgroundColor,
    bgImage: canvas.backgroundImage,
    exportMode: canvas._exportMode,
    objects: canvas.getObjects().map((o) => JSON.stringify(o.toObject(['isPhotoZone']))),
  };
}

// Navigateur minimal pour l'assemblage du PNG troué (Image, canvas hors écran).
async function withFakeBrowser(fn) {
  const saved = { Image: globalThis.Image, document: globalThis.document };
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  globalThis.Image = class {
    constructor() { this.width = 2400; this.height = 3600; }
    set src(v) { this._src = v; queueMicrotask(() => this.onload?.()); }
    get src() { return this._src; }
  };
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,PUNCHED' }),
  };
  try {
    return await fn();
  } finally {
    globalThis.Image = saved.Image;
    globalThis.document = saved.document;
  }
}

const zone = (o) => new fabric.Rect({ strokeWidth: 0, fill: 'transparent', isPhotoZone: true, ...o });
const deco = (o) => new fabric.Rect({ fill: 'red', ...o });

test('la préparation du modèle photo laisse le design intact (ni événement, ni changement)', async () => {
  const objects = [
    deco({ left: 0, top: 0, width: 400, height: 600 }),
    zone({ left: 18, top: 20, width: 360, height: 240 }),
    zone({ left: 18, top: 300, width: 360, height: 240, angle: 5 }),
    deco({ left: 100, top: 100, width: 40, height: 40, visible: false }),
    deco({ left: 30, top: 30, width: 60, height: 60 }),
  ];
  const { canvas, fired } = fakeEditorCanvas(objects);
  const before = snapshot(canvas);
  const result = await withFakeBrowser(() => prepareDesignPreview(canvas, FORMATS.portrait));
  assert.deepEqual(snapshot(canvas), before);
  assert.deepEqual(fired, []);
  assert.equal(result.kind, 'print');
  assert.equal(result.formatId, 'portrait');
  assert.equal(result.pngUrl, 'data:image/png;base64,PUNCHED');
  assert.equal(result.zones.length, 2);
  assert.deepEqual(result.zones[0], { left: 18, top: 20, width: 360, height: 240, angle: 0 });
  assert.ok(close(result.zones[1].angle, 5));
});

test('un export qui échoue rend quand même le design tel quel', async () => {
  const objects = [deco({ left: 0, top: 0, width: 400, height: 600 }), zone({ left: 18, top: 20, width: 360, height: 240 })];
  const { canvas, fired } = fakeEditorCanvas(objects, { failOnExport: true });
  const before = snapshot(canvas);
  await assert.rejects(withFakeBrowser(() => prepareDesignPreview(canvas, FORMATS.portrait)), /tainted/);
  assert.deepEqual(snapshot(canvas), before);
  assert.deepEqual(fired, []);
});

test('l\'écran d\'accueil est exporté au format de l\'écran, sans trou', async () => {
  const calls = [];
  const exportPng = async (canvas, format, options) => { calls.push({ format, options }); return 'data:home'; };
  const result = await prepareDesignPreview({ getObjects: () => [] }, HOME_FORMAT, exportPng);
  assert.deepEqual(result, { kind: 'home', formatId: 'home', pngUrl: 'data:home', zones: [] });
  assert.equal(calls[0].format, HOME_FORMAT);
  assert.equal(calls[0].options, undefined);
});

test('le modèle photo est exporté troué, comme à l\'envoi', async () => {
  const calls = [];
  const exportPng = async (canvas, format, options) => { calls.push({ format, options }); return 'data:print'; };
  await prepareDesignPreview({ getObjects: () => [] }, FORMATS.landscape, exportPng);
  assert.equal(calls[0].format, FORMATS.landscape);
  assert.deepEqual(calls[0].options, { punchZones: true });
  assert.equal(exportAsHighResPNG.name, 'exportAsHighResPNG');
});

// ── Écran composé dans l'éditeur des écrans (LAB-309) ──

test("écran composé : même découpage qu'à la publication, images de l'export par parties", () => {
  for (const kind of ['home', 'result']) {
    const format = kioskFormatByKind(kind);
    const calls = [];
    const exportParts = (canvas, fmt, parts) => {
      calls.push({ canvas, fmt, parts });
      const names = [parts.background?.name, parts.backgroundNeutral?.name, ...(parts.buttons ?? []).map((b) => b.name)];
      return names.filter(Boolean).map((name) => ({ name, dataUrl: `data:image/png;base64,${name}` }));
    };
    const canvas = { tag: kind };
    const source = prepareScreenPreview(canvas, kioskScreenTemplate(kind), format, exportParts);
    const { layout } = buildScreenLayoutFromState(kioskScreenTemplate(kind), kind, { canvasWidth: format.canvasWidth });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].canvas, canvas);
    assert.equal(calls[0].fmt, format);
    assert.equal(source.kind, 'screen');
    assert.equal(source.screenKind, kind);
    assert.equal(source.layout.background, `data:image/png;base64,${layout.background}`);
    assert.deepEqual(source.layout.buttons.map((b) => b.action), layout.buttons.map((b) => b.action));
    assert.ok(source.layout.buttons.every((b) => b.image.startsWith('data:image/png')));
  }
});

test("écran composé : un plan que la borne refuserait arrête l'aperçu", () => {
  const format = kioskFormatByKind('result');
  assert.throws(() => prepareScreenPreview({}, kioskScreenTemplate('result'), format, () => []), /refusé/);
});

// ── Design déjà envoyé (fiche de l'événement, LAB-308) ──

test('zones d\'un canvas_json enregistré : mêmes rectangles que le design vivant, groupes compris', async () => {
  const group = new fabric.Group([
    zone({ left: 40, top: 60, width: 160, height: 120 }),
    deco({ left: 220, top: 100, width: 100, height: 50 }),
  ]);
  group.set({ originX: 'center', originY: 'center', left: 200, top: 300, angle: 30, scaleX: 1.2, scaleY: 0.8 });
  const live = [
    deco({ left: 0, top: 0, width: 400, height: 600 }),
    zone({ left: 18, top: 20, width: 360, height: 240, angle: 5 }),
    group,
  ];
  const saved = {
    bg: '#fff',
    objects: [
      ...live.map((o) => o.toObject(['isPhotoZone'])),
      // Une image distante ne doit pas être chargée pour lire les zones.
      { type: 'image', src: 'https://cdn.example/deco.png', left: 0, top: 0, width: 10, height: 10 },
    ],
  };
  const expected = findPhotoZones(live).map((z) => zoneFromRect(photoZoneRect(z)));
  assert.equal(expected.length, 2);
  for (const input of [saved, JSON.stringify(saved)]) {
    const zones = await zonesFromCanvasJson(input);
    assert.equal(zones.length, 2);
    zones.forEach((z, i) => {
      for (const k of ['left', 'top', 'width', 'height', 'angle']) assert.ok(close(z[k], expected[i][k]), `${k} : ${z[k]} ≠ ${expected[i][k]}`);
    });
  }
  assert.deepEqual(await zonesFromCanvasJson({ objects: [deco({ width: 10, height: 10 }).toObject()] }), []);
  assert.deepEqual(await zonesFromCanvasJson(null), []);
});

test('design envoyé : PNG final et zones du canvas_json, accueil sans zone', async () => {
  const canvasJson = { objects: [zone({ left: 18, top: 20, width: 360, height: 240 }).toObject(['isPhotoZone'])] };
  assert.deepEqual(
    await prepareStoredDesignPreview({ kind: 'print', format: 'portrait', finalPngUrl: 'https://cdn.example/p.png', canvasJson }),
    { kind: 'print', formatId: 'portrait', pngUrl: 'https://cdn.example/p.png', zones: [{ left: 18, top: 20, width: 360, height: 240, angle: 0 }] },
  );
  assert.deepEqual(
    await prepareStoredDesignPreview({ kind: 'home', format: 'home', finalPngUrl: 'https://cdn.example/h.png', canvasJson }),
    { kind: 'home', formatId: 'home', pngUrl: 'https://cdn.example/h.png', zones: [] },
  );
});

// ── Garanties lues dans le code ──

const previewSources = [
  ['KioskPreview.jsx', read('../components/KioskPreview.jsx')],
  ...readdirSync(new URL('../components/kiosk-preview/', import.meta.url)).map((f) => [f, read(`../components/kiosk-preview/${f}`)]),
  ['kioskPreview.js', read('./kioskPreview.js')],
  ['kioskPreviewPhotos.js', read('./kioskPreviewPhotos.js')],
  ['kioskDesignedScreen.js', read('./kioskDesignedScreen.js')],
];

test('la fenêtre n\'envoie rien et ne touche ni à l\'historique ni à la sauvegarde', () => {
  const forbidden = ['supabase', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'FormData', 'markDirty', 'saveHistorySnapshot', 'onDirtyChange', 'autosave', 'autoSave'];
  for (const [name, src] of previewSources) {
    for (const word of forbidden) assert.ok(!src.includes(word), `${name} contient « ${word} »`);
  }
});

test('les repères de l\'éditeur ne sont pas dans l\'aperçu', () => {
  for (const [name, src] of previewSources) {
    for (const word of ['HomeScreenOverlay', 'KioskScreenOverlay', 'safeZoneInsetX', 'reservedBottom']) {
      assert.ok(!src.includes(word), `${name} contient « ${word} »`);
    }
  }
});

test('la photo de l\'utilisateur reste une URL locale, libérée à la fermeture', () => {
  const src = read('../components/KioskPreview.jsx');
  assert.ok(src.includes('URL.createObjectURL'));
  assert.ok(src.includes('URL.revokeObjectURL'));
});

test("aucun éditeur n'ouvre l'aperçu sur la borne (fiches de l'événement et des écrans seulement)", () => {
  const editor = readEditor();
  for (const word of ['KioskPreview', 'openKioskPreview', 'Aperçu sur la borne', "Voir d'abord l'aperçu"]) {
    assert.ok(!editor.includes(word), `l'éditeur (Editor.jsx ou components/editor/) contient « ${word} »`);
  }
  const editorPageParts = readdirSync(new URL('../pages/editor/', import.meta.url)).map((f) => `../pages/editor/${f}`);
  for (const page of ['../pages/EditorPage.jsx', ...editorPageParts, '../pages/admin/AdminTemplateEditor.jsx', '../pages/admin/AdminKioskScreens.jsx']) {
    assert.ok(!read(page).includes('kioskPreview'), `${page} passe encore une option d'aperçu`);
  }
});

test('aucune marque dans la fenêtre, ses photos et leur licence', () => {
  const licence = read('../../public/kiosk-preview/LICENCE.txt');
  for (const [name, src] of [...previewSources, ['LICENCE.txt', licence]]) {
    assert.ok(!/\bpola\b|bo[iî]te\s*[àa]\s*pola/i.test(src), `${name} contient une marque`);
  }
});

// ── Photos d'exemple : fichiers, format, licence, export open core ──

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'pas un JPEG');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('taille JPEG introuvable');
}

test('six photos d\'exemple 3:2 paysage, légères, déclarées et sous licence', () => {
  const licence = read('../../public/kiosk-preview/LICENCE.txt');
  // open-core/export.json n'existe que dans le dépôt privé : la liste des images revues n'y est vérifiée que là.
  const exportConfig = IN_PUBLIC_REPO ? null : JSON.parse(read('../../../open-core/export.json'));
  assert.equal(KIOSK_PREVIEW_PHOTOS.length, 6);
  for (const photo of KIOSK_PREVIEW_PHOTOS) {
    const file = new URL(`../../public${photo.src}`, import.meta.url);
    const buf = readFileSync(file);
    assert.ok(statSync(file).size <= 300 * 1024, `${photo.src} dépasse 300 Ko`);
    const size = jpegSize(buf);
    assert.deepEqual(size, { width: photo.width, height: photo.height }, photo.src);
    assert.equal(size.width * 2, size.height * 3, `${photo.src} n'est pas en 3:2`);
    const name = photo.src.split('/').pop();
    assert.ok(new RegExp(`^${name.replace('.', '\\.')}\\s.+CC0`, 'm').test(licence), `${name} absente de LICENCE.txt`);
    if (exportConfig) assert.ok(exportConfig.reviewedImages[`saas/public${photo.src}`], `${name} absente de reviewedImages`);
  }
  assert.ok(!/unsplash|pexels|pixabay/i.test(licence));
});
