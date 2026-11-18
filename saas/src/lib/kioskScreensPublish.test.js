import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCREEN_DRAFT_MAX_BYTES,
  dataUrlMime,
  draftSizeProblem,
  fontFetchWarning,
  inlineImageSources,
  nextScreenVersion,
  planFonts,
  planImages,
  planSizeProblem,
  publishedPlan,
  referencedScreenFiles,
  replaceImageSources,
  screenAssetName,
  screenAssetNames,
  screenFontContentType,
  screenStatus,
  screenStoragePath,
  screensByKind,
  staleScreenFiles,
  unusedScreenAssets,
  urlLastSegment,
  withoutFonts,
} from './kioskScreensPublish.js';
import { buildScreenLayout, buildScreenLayoutFromState, kioskColor, normalizeScreenLayout } from './kioskScreenLayout.js';
import { kioskScreenTemplate } from './kioskScreenTemplates.js';

const BASE = 'https://x.supabase.co/storage/v1/object/public/kiosk-backgrounds/org/o1/';
const urlFor = (name) => BASE + name;

test('version : toujours la précédente + 1, même après une dépublication', () => {
  assert.equal(nextScreenVersion(null), 1);
  assert.equal(nextScreenVersion({ published_version: 0, published: null }), 1);
  assert.equal(nextScreenVersion({ published_version: 3, published: { version: 3 } }), 4);
  // Dépublié en v3 : la suivante est la v4, jamais une v1 qui collerait au cache de la borne.
  assert.equal(nextScreenVersion({ published_version: 3, published: null }), 4);
  assert.equal(nextScreenVersion({ published_version: 'x' }), 1);
});

test('chemins dans le bucket : org/{org_id}/{nom}', () => {
  assert.equal(screenStoragePath('o1', 'screen-home-v2-bg.png'), 'org/o1/screen-home-v2-bg.png');
});

test('plan publié : adresses complètes, noms uniques, dernier segment = nom de l’asset .pola', () => {
  for (const kind of ['home', 'result']) {
    const { layout, blocking } = buildScreenLayoutFromState(kioskScreenTemplate(kind), kind, { version: 5 });
    assert.deepEqual(blocking, [], kind);
    const names = planImages(layout);
    const expected = [layout.background, layout.background_neutral, ...layout.buttons.map((b) => b.image)].filter(Boolean);
    assert.equal(names.length, expected.length, `${kind} : deux parties donnent le même nom`);
    for (const n of names) assert.match(n, new RegExp(`^screen-${kind}-v5-[a-z0-9_-]+\\.png$`));

    const plan = publishedPlan(layout, urlFor);
    assert.equal(plan.version, 5);
    assert.deepEqual(plan.texts, layout.texts);
    assert.deepEqual(plan.slots, layout.slots);
    const urls = planImages(plan);
    assert.equal(urls.length, names.length);
    for (const u of urls) assert.ok(u.startsWith(BASE));
    assert.deepEqual(urls.map(urlLastSegment), names);
    assert.equal(planSizeProblem(plan), null);
  }
});

test('plan publié : fond transparent sans décor → background null conservé', () => {
  const layout = {
    version: 1, kind: 'result', background: null, background_neutral: null, transparent_background: true,
    buttons: [{ action: 'finish', x: 1, y: 2, w: 3, h: 4, image: 'screen-result-v1-btn-finish.png' }], texts: [], slots: [],
  };
  const plan = publishedPlan(layout, urlFor);
  assert.equal(plan.background, null);
  assert.equal(plan.background_neutral, null);
  assert.equal(plan.buttons[0].image, `${BASE}screen-result-v1-btn-finish.png`);
  assert.deepEqual(planImages(plan), [`${BASE}screen-result-v1-btn-finish.png`]);
});

test('plan publié : polices jointes en adresses complètes, lues telles quelles par la borne (LAB-331)', () => {
  const text = (variable, fontFamily, fontWeight) => ({
    type: 'textbox', left: 100, top: 100, width: 200, height: 30, fontFamily, fontWeight, kioskVariable: variable,
  });
  const { layout, parts } = buildScreenLayout([text('event_name', 'Pacifico', 400), text('event_date', 'DM Sans', 500)],
    'home', { version: 6 });
  assert.deepEqual(planFonts(layout), ['screen-home-v6-font-1.ttf']);
  assert.deepEqual(parts.fonts.map((f) => f.name), planFonts(layout));
  const plan = publishedPlan(layout, urlFor);
  assert.deepEqual(plan.texts.map((t) => t.font_file), [`${BASE}screen-home-v6-font-1.ttf`, null]);
  assert.deepEqual(planFonts(plan).map(urlLastSegment), ['screen-home-v6-font-1.ttf']);
  assert.deepEqual(normalizeScreenLayout(plan).texts.map((t) => [t.font, t.weight, t.font_file]),
    [['Pacifico', 400, `${BASE}screen-home-v6-font-1.ttf`], ['DM Sans', 500, null]]);
  // Aperçu dans l'éditeur : les polices gardent leur nom (famille déjà chargée par la page).
  assert.equal(publishedPlan(layout, urlFor, (n) => n).texts[0].font_file, 'screen-home-v6-font-1.ttf');
});

test('police non récupérée : textes en DM Sans, avertissement', () => {
  const layout = {
    texts: [
      { variable: 'event_name', font: 'Pacifico', weight: 650, font_file: 'screen-home-v2-font-1.ttf' },
      { variable: 'event_date', font: 'Lobster', weight: 400, font_file: 'screen-home-v2-font-2.ttf' },
    ],
  };
  assert.equal(withoutFonts(layout, []), layout);
  assert.deepEqual(withoutFonts(layout, ['screen-home-v2-font-1.ttf']).texts, [
    { variable: 'event_name', font: 'DM Sans', weight: 600, font_file: null },
    layout.texts[1],
  ]);
  assert.match(fontFetchWarning({ family: 'Pacifico' }).message, /Pacifico n'a pas pu être récupérée : la borne écrira ses textes en DM Sans/);
  assert.equal(screenFontContentType('screen-home-v2-font-1.otf'), 'font/otf');
  assert.equal(screenFontContentType('screen-home-v2-font-1.ttf'), 'font/ttf');
});

test('dernier segment : comme la borne (sans ?, #, et décodé)', () => {
  assert.equal(urlLastSegment(`${BASE}screen-home-v2-bg.png?t=1#x`), 'screen-home-v2-bg.png');
  assert.equal(urlLastSegment('https://a/b/mon%20fichier.png'), 'mon fichier.png');
  assert.equal(urlLastSegment('https://a/b/%E0%A4%A.png'), '%E0%A4%A.png');
});

test('nettoyage : fichiers des autres versions de cet écran seulement', () => {
  const names = [
    'screen-home-v2-bg.png', 'screen-home-v2-btn-start.png', 'screen-home-v3-bg.png',
    'screen-home-v3-bg-neutral.png', 'screen-home-v1-btn-gallery.png',
    'screen-result-v2-bg.png', 'screen-asset-abc.png', 'logo.png', 'screen-home-v2-bg.png.bak',
    'screen-home-v2-font-1.ttf', 'screen-home-v3-font-1.otf', 'screen-home-v1-font-2.woff2',
  ];
  assert.deepEqual(staleScreenFiles(names, 'home', 3), [
    'screen-home-v2-bg.png', 'screen-home-v2-btn-start.png', 'screen-home-v1-btn-gallery.png',
    'screen-home-v2-font-1.ttf',
  ]);
  assert.deepEqual(staleScreenFiles(names, 'result', 3), ['screen-result-v2-bg.png']);
  assert.deepEqual(staleScreenFiles(null, 'home', 1), []);
});

test('taille : brouillon et plan au-delà de la limite → message clair', () => {
  assert.equal(draftSizeProblem({ objects: [] }), null);
  const heavy = { objects: [{ type: 'path', path: 'x'.repeat(SCREEN_DRAFT_MAX_BYTES) }] };
  assert.match(draftSizeProblem(heavy), /trop lourd .* Mo au maximum/);
  const plan = { texts: Array.from({ length: 2000 }, () => ({ variable: 'copies', color: '#000000', font: 'DM Sans' })) };
  assert.match(planSizeProblem(plan), /trop lourd .* Ko au maximum/);
});

test('images importées : data URLs trouvées dans les groupes et remplacées par leur adresse', () => {
  const png = 'data:image/png;base64,AAAA';
  const webp = 'data:image/webp;base64,BBBB';
  const state = {
    bg: '#fff',
    objects: [
      { type: 'image', src: png },
      { type: 'group', objects: [{ type: 'image', src: webp }, { type: 'image', src: png }] },
      { type: 'image', src: 'https://a/b.png' },
      { type: 'rect', clipPath: { type: 'image', src: webp } },
    ],
  };
  assert.deepEqual(inlineImageSources(state), [png, webp]);
  const out = replaceImageSources(state, new Map([[png, 'https://s/p.png'], [webp, 'https://s/w.png']]));
  assert.equal(out.objects[0].src, 'https://s/p.png');
  assert.equal(out.objects[0].crossOrigin, 'anonymous');
  assert.equal(out.objects[1].objects[0].src, 'https://s/w.png');
  assert.equal(out.objects[2].src, 'https://a/b.png');
  assert.equal(out.objects[3].clipPath.src, 'https://s/w.png');
  assert.equal(state.objects[0].src, png, 'le brouillon d’origine ne change pas');
  assert.deepEqual(inlineImageSources(out), []);
  assert.equal(dataUrlMime(webp), 'image/webp');
  assert.equal(screenAssetName('ab12', 'image/jpeg'), 'screen-asset-ab12.jpg');
  assert.equal(screenAssetName('ab12', 'image/webp'), 'screen-asset-ab12.png');
});

test('images importées inutiles : ni dans un brouillon ni dans un plan publié (LAB-317)', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/kiosk-backgrounds/org/o1/';
  const home = {
    kind: 'home',
    draft_json: { objects: [
      { type: 'image', src: `${base}screen-asset-aa11.png` },
      { type: 'group', objects: [{ type: 'image', src: `${base}screen-asset-bb22.jpg?x=1` }] },
      { type: 'rect', clipPath: { type: 'image', src: `${base}screen-asset-cc33.png` } },
      { type: 'image', src: 'data:image/png;base64,AAAA' },
      { type: 'image', src: 'https://ailleurs/screen-asset.png' },
    ] },
    published: { background: `${base}screen-home-v2-bg.png`, buttons: [{ image: `${base}screen-home-v2-btn-start.png` }] },
  };
  assert.deepEqual([...screenAssetNames(home.draft_json)], ['screen-asset-aa11.png', 'screen-asset-bb22.jpg', 'screen-asset-cc33.png']);
  // Plan publié qui (par sécurité) référencerait une image importée : gardée elle aussi.
  const result = { kind: 'result', draft_json: { objects: [{ type: 'image', src: `${base}screen-asset-dd44.png` }] },
    published: { background: `${base}screen-asset-ee55.png`, buttons: [] } };
  const keep = referencedScreenFiles([home, result, null]);
  const folder = [
    'screen-asset-aa11.png', 'screen-asset-bb22.jpg', 'screen-asset-cc33.png', 'screen-asset-dd44.png',
    'screen-asset-ee55.png', 'screen-asset-ff66.png', 'screen-asset-0a0a.jpg',
    'screen-home-v2-bg.png', 'screen-home-preview.png', 'bg-event.jpg', 'screen-asset-ZZ.png',
  ];
  assert.deepEqual(unusedScreenAssets(folder, keep), ['screen-asset-ff66.png', 'screen-asset-0a0a.jpg']);
  // Images de la séance d'édition en cours (adresses complètes acceptées) : gardées aussi.
  assert.deepEqual(unusedScreenAssets(folder, [...keep, `${base}screen-asset-ff66.png`]), ['screen-asset-0a0a.jpg']);
  assert.deepEqual(unusedScreenAssets(folder, referencedScreenFiles([])).length, 7);
});

test('état des cartes : modèle, brouillon, publié, modifications non publiées', () => {
  assert.equal(screenStatus(null).label, "Modèle d'origine, pas encore modifié");
  assert.equal(screenStatus({ draft_json: { objects: [] }, published: null, published_version: 4 }).label, 'Brouillon');
  const pub = screenStatus({
    draft_json: {}, draft_updated_at: '2026-11-15T10:00:00Z',
    published: { version: 3 }, published_version: 3, published_at: '2026-11-15T10:00:00Z',
  });
  assert.equal(pub.published, true);
  assert.equal(pub.version, 3);
  assert.match(pub.label, /^Publié v3 le 15 novembre 2026/);
  assert.equal(pub.unpublishedChanges, false);
  const changed = screenStatus({
    draft_json: {}, draft_updated_at: '2026-11-15T11:00:00Z',
    published: { version: 3 }, published_version: 3, published_at: '2026-11-15T10:00:00Z',
  });
  assert.equal(changed.unpublishedChanges, true);
});

test('lignes par écran', () => {
  assert.deepEqual(screensByKind([{ kind: 'result', id: 1 }, { kind: 'autre' }]), { home: null, result: { kind: 'result', id: 1 } });
});

test('couleur d’un texte vivant au format de la borne (#RRGGBB ou #AARRGGBB)', () => {
  assert.equal(kioskColor('#6e5140'), '#6E5140');
  assert.equal(kioskColor('#abc'), '#AABBCC');
  assert.equal(kioskColor('#abc8'), '#88AABBCC');
  assert.equal(kioskColor('#11223380'), '#80112233');
  assert.equal(kioskColor('rgb(255, 0, 0)'), '#FF0000');
  assert.equal(kioskColor('rgba(10,20,30,0.5)'), '#800A141E');
  assert.equal(kioskColor('rgb(100% 0% 0% / 50%)'), '#80FF0000');
  assert.equal(kioskColor('White'), '#FFFFFF');
  for (const bad of ['hsl(1,2%,3%)', '', null, { type: 'linear' }, 'rgb(1,2)', '#12']) {
    assert.equal(kioskColor(bad), '#1B241F', String(bad));
  }
  const { layout } = buildScreenLayoutFromState({
    bg: '#fff',
    objects: [{ type: 'textbox', left: 100, top: 100, width: 200, height: 40, text: '1', fontFamily: 'DM Sans', fill: 'rgba(0,0,0,1)', kioskVariable: 'copies' }],
  }, 'result');
  assert.equal(layout.texts[0].color, '#000000');
});
