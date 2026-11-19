import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Point, Rect, util } from './fabric.js';
import {
  findPhotoZones,
  flattenObjects,
  photoZoneRect,
  withoutPhotoZones,
  zoneRectFromMatrix,
} from './photoZones.js';

// Vecteur commun avec kiosk/PolaKiosk.Tests/Services/CompositeServiceTests.cs (ParsePhotoZones) :
// mêmes designs, mêmes rectangles attendus (left, top, width, height, angle en px canvas).
const zone = (o) => new Rect({ strokeWidth: 0, fill: 'transparent', isPhotoZone: true, ...o });
const deco = (o) => new Rect({ fill: 'red', ...o });
const group = (props) => {
  const g = new Group([
    zone({ left: 20, top: 30, width: 160, height: 120 }),
    deco({ left: 200, top: 100, width: 100, height: 50 }),
  ]);
  g.set(props);
  return g;
};

const CASES = {
  'zone de premier niveau inchangée': {
    build: () => [zone({ left: 18, top: 20, width: 360, height: 418.5 })],
    expected: [18, 20, 360, 418.5, 0],
  },
  'groupe simple': { build: () => [group({})], expected: [20, 30, 160, 120, 0] },
  'groupe mis à l’échelle': {
    build: () => [group({ left: 10, top: 40, scaleX: 1.5, scaleY: 0.5 })],
    expected: [10, 40, 240, 60, 0],
  },
  'groupe tourné de 90° (origine au centre)': {
    build: () => [group({ originX: 'center', originY: 'center', left: 200, top: 300, angle: 90 })],
    expected: [120.5, 179.5, 160, 120, 90],
  },
  'groupe tourné de 30° et agrandi': {
    build: () => [group({ left: 120, top: 80, angle: 30, scaleX: 1.2, scaleY: 1.2 })],
    expected: [71.1384, 118.3538, 192, 144, 30],
  },
  'groupes imbriqués': {
    build: () => {
      const inner = new Group([
        zone({ left: 40, top: 60, width: 100, height: 80, scaleX: 1.5 }),
        deco({ left: 160, top: 60, width: 40, height: 40 }),
      ]);
      inner.set({ scaleX: 0.5, scaleY: 0.5 });
      const outer = new Group([inner, deco({ left: 20, top: 300, width: 300, height: 60 })]);
      outer.set({ left: 60, top: 100, angle: -20, scaleX: 1.25, scaleY: 1.25 });
      return [outer];
    },
    expected: [89.2159, 73.9096, 93.75, 50, -20],
  },
  'groupe en miroir horizontal': { build: () => [group({ flipX: true })], expected: [141, 30, 160, 120, 0] },
  'groupe en miroir vertical et tourné': {
    build: () => [group({ flipY: true, angle: 30 })],
    expected: [-21.218, 62.8275, 160, 120, 30],
  },
};

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-3, `${label} : ${actual} ≠ ${expected}`);

for (const [name, { build, expected }] of Object.entries(CASES)) {
  test(`photoZoneRect — ${name}`, () => {
    const zones = findPhotoZones(build());
    assert.equal(zones.length, 1);
    const { cx, cy, width, height, angle } = photoZoneRect(zones[0]);
    const [left, top, w, h, a] = expected;
    close(cx - width / 2, left, 'left');
    close(cy - height / 2, top, 'top');
    close(width, w, 'width');
    close(height, h, 'height');
    close(angle, a, 'angle');
  });
}

test('photoZoneRect — les coins coïncident avec la géométrie Fabric, groupes compris', () => {
  for (const { build } of Object.values(CASES)) {
    const [z] = findPhotoZones(build());
    const { cx, cy, width, height, angle } = photoZoneRect(z);
    const t = (angle * Math.PI) / 180;
    const ours = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = (sx * width) / 2, y = (sy * height) / 2;
      return [cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)];
    });
    const m = z.calcTransformMatrix();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = util.transformPoint(new Point((sx * z.width) / 2, (sy * z.height) / 2), m);
      assert.ok(ours.some(([x, y]) => Math.abs(x - p.x) < 1e-6 && Math.abs(y - p.y) < 1e-6));
    }
  }
});

test('zoneRectFromMatrix — un miroir ne retourne jamais la photo', () => {
  // Miroir horizontal pur : même rectangle, à l'endroit.
  // Miroir vertical pur : la rotation de 180° équivalente est évitée.
  for (const matrix of [[-1, 0, 0, 1, 50, 60], [1, 0, 0, -1, 50, 60]]) {
    const r = zoneRectFromMatrix(matrix, 100, 80);
    assert.deepEqual([r.cx, r.cy, r.width, r.height], [50, 60, 100, 80]);
    assert.ok(Math.abs(r.angle) < 1e-9, `angle ${r.angle}`);
  }
});

test('findPhotoZones / flattenObjects — ordre d’empilement, groupes déroulés', () => {
  const a = zone({ left: 0, top: 0, width: 10, height: 10 });
  const b = deco({ left: 20, top: 0, width: 10, height: 10 });
  const c = zone({ left: 40, top: 0, width: 10, height: 10 });
  const d = deco({ left: 60, top: 0, width: 10, height: 10 });
  const objects = [a, new Group([b, new Group([c])]), d];
  assert.deepEqual(findPhotoZones(objects), [a, c]);
  assert.deepEqual(flattenObjects(objects), [a, b, c, d]);
});

test('withoutPhotoZones — retire les zones des groupes sérialisés et les groupes vidés', () => {
  const objects = [
    { type: 'rect', isPhotoZone: true },
    { type: 'group', left: 5, objects: [{ type: 'rect', isPhotoZone: true }, { type: 'text', text: 'Léa' }] },
    { type: 'group', objects: [{ type: 'group', objects: [{ type: 'rect', isPhotoZone: true }] }] },
    { type: 'image' },
  ];
  assert.deepEqual(withoutPhotoZones(objects), [
    { type: 'group', left: 5, objects: [{ type: 'text', text: 'Léa' }] },
    { type: 'image' },
  ]);
  assert.deepEqual(withoutPhotoZones(undefined), []);
});
