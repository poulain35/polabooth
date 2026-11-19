// Passage à Fabric 7 (LAB-435) : un design enregistré par Fabric 5 garde exactement la même géométrie,
// et le JSON réécrit par Fabric 7 reste celui que la borne sait lire (origines, types, zones photo).
import './fabricTestEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BaseFabricObject, Canvas, FabricImage, IText, Rect, config, util } from './fabric.js';
import { findPhotoZones, flattenObjects, photoZoneRect } from './photoZones.js';

// Design écrit par Fabric 5.5.2 (canvas.toJSON(['isPhotoZone', 'rx', 'ry']), NUM_FRACTION_DIGITS 6,
// comme l'éditeur), champs par défaut retirés : zone en haut à gauche, cercle centré tourné, groupe
// centré tourné et agrandi (enfants haut gauche et centrés), groupes imbriqués avec miroir, rectangle
// arrondi tourné. Valeurs attendues calculées par Fabric 5.5.2 sur le même JSON relu
// (calcTransformMatrix de chaque objet dessiné, photoZoneRect de chaque zone : cx, cy, w, h, angle).
const FABRIC5_OBJECTS = [
  { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', left: 18, top: 20, width: 360, height: 418.5, fill: 'transparent', stroke: null, strokeWidth: 0, scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, rx: 0, ry: 0, isPhotoZone: true },
  { type: 'circle', version: '5.5.2', originX: 'center', originY: 'center', left: 300, top: 500, width: 80, height: 80, fill: '#2e7d32', stroke: null, strokeWidth: 1, scaleX: 1.5, scaleY: 1, angle: 45, flipX: false, flipY: false, radius: 40 },
  {
    type: 'group', version: '5.5.2', originX: 'center', originY: 'center', left: 200, top: 300, width: 285.37914, height: 172, fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0, scaleX: 1.2, scaleY: 1.2, angle: 30, flipX: false, flipY: false,
    objects: [
      { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', left: -142.68957, top: -86, width: 160, height: 120, fill: 'transparent', stroke: null, strokeWidth: 0, scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, rx: 0, ry: 0, isPhotoZone: true },
      { type: 'rect', version: '5.5.2', originX: 'center', originY: 'center', left: 87.31043, top: 9, width: 100, height: 50, fill: '#c0392b', stroke: null, strokeWidth: 1, scaleX: 1, scaleY: 1, angle: 15, flipX: false, flipY: false, rx: 0, ry: 0 },
      { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', left: 37.31043, top: 44, width: 40, height: 20, fill: '#c0392b', stroke: null, strokeWidth: 1, scaleX: 1, scaleY: 2, angle: 0, flipX: false, flipY: false, rx: 0, ry: 0 },
    ],
  },
  {
    type: 'group', version: '5.5.2', originX: 'left', originY: 'top', left: 60, top: 100, width: 301, height: 321.5, fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0, scaleX: 1.25, scaleY: 1.25, angle: -20, flipX: false, flipY: false,
    objects: [
      {
        type: 'group', version: '5.5.2', originX: 'left', originY: 'top', left: -130.5, top: -160.75, width: 150, height: 100.5, fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0, scaleX: 0.5, scaleY: 0.5, angle: 0, flipX: true, flipY: false,
        objects: [
          { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', left: -75, top: -29.75, width: 100, height: 80, fill: 'transparent', stroke: null, strokeWidth: 0, scaleX: 1.5, scaleY: 1, angle: 0, flipX: false, flipY: false, rx: 0, ry: 0, isPhotoZone: true },
          { type: 'rect', version: '5.5.2', originX: 'center', originY: 'center', left: 45, top: -29.75, width: 40, height: 40, fill: '#c0392b', stroke: null, strokeWidth: 1, scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, rx: 0, ry: 0 },
        ],
      },
      { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', left: -150.5, top: 99.75, width: 300, height: 60, fill: '#c0392b', stroke: null, strokeWidth: 1, scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, rx: 0, ry: 0 },
    ],
  },
  { type: 'rect', version: '5.5.2', originX: 'left', originY: 'top', left: 50, top: 520, width: 120, height: 60, fill: '#fff', stroke: '#000', strokeWidth: 3, scaleX: 1, scaleY: 1, angle: -10, flipX: false, flipY: false, rx: 12, ry: 12 },
];

const FABRIC5_MATRICES = [
  ['rect', 1, 0, 0, 1, 198, 229.25],
  ['circle', 1.06066, 1.06066, -0.707107, 0.707107, 300, 500],
  ['rect', 1.03923, 0.6, -0.6, 1.03923, 150.451088, 235.366265],
  ['rect', 0.848528, 0.848528, -0.848528, 0.848528, 285.33566, 361.739332],
  ['rect', 1.03923, 0.6, -1.2, 2.078461, 221.078361, 402.236239],
  ['rect', -0.880962, 0.320644, 0.213763, 0.587308, 140.473044, 110.949429],
  ['rect', -0.587308, 0.213763, 0.213763, 0.587308, 105.493685, 97.07643],
  ['rect', 1.174616, -0.427525, 0.427525, 1.174616, 361.189501, 377.470651],
  ['rect', 0.984808, -0.173648, 0.173648, 0.984808, 116.035594, 540.342081],
];

const FABRIC5_ZONES = [
  [198, 229.25, 360, 418.5, 0],
  [150.451088, 235.366265, 192, 144, 30],
  [140.473044, 110.949429, 93.75, 50, -20],
];

const CUSTOM_PROPS = (() => {
  const src = readFileSync(new URL('../components/editor/canvasState.js', import.meta.url), 'utf8');
  const start = src.indexOf('const CUSTOM_PROPS = [');
  return [...src.slice(start, src.indexOf('];', start)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

const copy = (o) => JSON.parse(JSON.stringify(o));
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${label} : ${actual} ≠ ${expected}`);

function assertFabric5Geometry(objects, label) {
  const flat = flattenObjects(objects);
  assert.equal(flat.length, FABRIC5_MATRICES.length, `${label} : nombre d’objets`);
  flat.forEach((o, i) => {
    const [type, ...matrix] = FABRIC5_MATRICES[i];
    assert.equal(o.type, type, `${label} : type de l’objet ${i}`);
    o.calcTransformMatrix().forEach((v, k) => close(v, matrix[k], `${label} : objet ${i}, matrice[${k}]`));
  });
  const zones = findPhotoZones(objects);
  assert.equal(zones.length, FABRIC5_ZONES.length, `${label} : nombre de zones`);
  zones.forEach((z, i) => {
    const { cx, cy, width, height, angle } = photoZoneRect(z);
    [cx, cy, width, height, angle].forEach((v, k) => close(v, FABRIC5_ZONES[i][k], `${label} : zone ${i}, valeur ${k}`));
  });
}

// Fabric 5 n'écrivait pas toujours les origines (modèles écrits à la main, anciens designs) : sans
// elles, Fabric 7 prendrait le centre. On retire celles qui valent la valeur par défaut de Fabric 5.
const withoutDefaultOrigins = (objects) => objects.map((o) => {
  const { originX, originY, objects: children, ...rest } = o;
  return {
    ...rest,
    ...(originX !== 'left' ? { originX } : {}),
    ...(originY !== 'top' ? { originY } : {}),
    ...(children ? { objects: withoutDefaultOrigins(children) } : {}),
  };
});

test('défauts de Fabric 5 forcés : origine haut gauche, clic droit libre, 6 décimales, types', () => {
  const rect = new Rect({ left: 10, top: 20, width: 30, height: 40 });
  assert.equal(rect.originX, 'left');
  assert.equal(rect.originY, 'top');
  const center = rect.getCenterPoint();
  assert.deepEqual([center.x, center.y], [25.5, 40.5]);
  assert.equal(BaseFabricObject.ownDefaults.originX, 'left');
  assert.equal(Canvas.ownDefaults.stopContextMenu, false);
  assert.equal(Canvas.ownDefaults.fireRightClick, false);
  assert.equal(Canvas.ownDefaults.fireMiddleClick, false);
  assert.equal(config.NUM_FRACTION_DIGITS, 6);
  assert.equal(rect.type, 'rect');
  assert.equal(rect.toObject().type, 'rect');
  assert.equal(new IText('Léa').type, 'i-text');
  assert.equal(new IText('Léa').toObject().type, 'i-text');
});

test('design de Fabric 5 relu par Fabric 7 : mêmes positions, mêmes zones photo', async () => {
  const objects = await util.enlivenObjects(copy(FABRIC5_OBJECTS));
  assertFabric5Geometry(objects, 'Fabric 5');
  // Les champs de position eux-mêmes ne bougent pas (left/top restent ceux du JSON).
  objects.forEach((o, i) => {
    assert.equal(o.left, FABRIC5_OBJECTS[i].left);
    assert.equal(o.top, FABRIC5_OBJECTS[i].top);
    assert.equal(o.originX, FABRIC5_OBJECTS[i].originX);
  });
});

test('design de Fabric 5 sans origines écrites : haut gauche, comme Fabric 5', async () => {
  const objects = await util.enlivenObjects(withoutDefaultOrigins(copy(FABRIC5_OBJECTS)));
  assertFabric5Geometry(objects, 'sans origines');
});

test('JSON réécrit par Fabric 7 : originX, originY, isPhotoZone et types de Fabric 5', async () => {
  const objects = await util.enlivenObjects(copy(FABRIC5_OBJECTS));
  objects[4].set({ kioskAction: 'gallery', locked: true, textEffect: 'shadow', textEffectParams: { blur: 4 } });
  const saved = copy(objects.map((o) => o.toObject(CUSTOM_PROPS)));

  const walk = (list, path = '') => list.forEach((o, i) => {
    const where = `${path}${i}`;
    assert.ok(['left', 'center'].includes(o.originX), `${where} : originX ${o.originX}`);
    assert.ok(['top', 'center'].includes(o.originY), `${where} : originY ${o.originY}`);
    assert.match(o.type, /^(rect|circle|group)$/, `${where} : type ${o.type}`);
    if (o.objects) walk(o.objects, `${where}.`);
  });
  walk(saved);
  assert.equal(saved[0].isPhotoZone, true);
  assert.equal(saved[2].objects[0].isPhotoZone, true);
  assert.equal(saved[3].objects[0].objects[0].isPhotoZone, true);
  // La borne lit left/top et les origines telles quelles : mêmes valeurs qu'en Fabric 5.
  saved.forEach((o, i) => {
    assert.equal(o.originX, FABRIC5_OBJECTS[i].originX);
    assert.equal(o.originY, FABRIC5_OBJECTS[i].originY);
    close(o.left, FABRIC5_OBJECTS[i].left, `left ${i}`);
    close(o.top, FABRIC5_OBJECTS[i].top, `top ${i}`);
  });
  assert.equal(saved[4].kioskAction, 'gallery');

  // Relu une deuxième fois : même géométrie, propriétés à nous gardées.
  const reloaded = await util.enlivenObjects(saved);
  assertFabric5Geometry(reloaded, 'aller-retour Fabric 7');
  assert.equal(reloaded[4].kioskAction, 'gallery');
  assert.equal(reloaded[4].locked, true);
  assert.equal(reloaded[4].textEffect, 'shadow');
  assert.deepEqual(reloaded[4].textEffectParams, { blur: 4 });
});

test('image introuvable : le reste du design se charge, l’image garde sa place et son adresse', async () => {
  const src = 'https://stockage.example/designs/disparue.png';
  const image = {
    type: 'image', version: '5.5.2', left: 40, top: 60, width: 200, height: 100, scaleX: 0.5, scaleY: 0.5,
    angle: 10, src, crossOrigin: 'anonymous', filters: [],
  };
  const warn = console.warn;
  console.warn = () => {};
  let objects;
  try {
    objects = await util.enlivenObjects([copy(FABRIC5_OBJECTS[0]), image]);
  } finally {
    console.warn = warn;
  }
  assert.equal(objects.length, 2);
  const [, img] = objects;
  assert.ok(img instanceof FabricImage);
  assert.equal(img.missingImage, true);
  assert.deepEqual([img.left, img.top, img.width, img.height, img.angle], [40, 60, 200, 100, 10]);
  const out = img.toObject(CUSTOM_PROPS);
  assert.equal(out.type, 'image');
  assert.equal(out.src, src);
  assert.deepEqual(out.filters, []);
  assert.deepEqual([out.left, out.top, out.width, out.height, out.scaleX], [40, 60, 200, 100, 0.5]);
});
