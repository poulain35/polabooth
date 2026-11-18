import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CANVAS_SIZES,
  canvasToPrintScale,
  compositePlacements,
  coverSourceRect,
  fullFrameZone,
  hasTransparentArea,
  printPixelSize,
  zoneFromRect,
} from './kioskComposite.js';

// Cas communs avec les tests de la borne (CompositeService).
const FIXTURE = JSON.parse(
  readFileSync(new URL('../../../docs/specs/fixtures/kiosk-composite-cases.json', import.meta.url), 'utf8'),
);

const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} : ${actual} ≠ ${expected}`);

test('tailles du tirage (cas communs) : (int)(mm / 25,4 × dpi)', () => {
  for (const [format, { dpi, w, h }] of Object.entries(FIXTURE.print_sizes)) {
    assert.deepEqual(printPixelSize(format, dpi), { w, h }, format);
  }
});

for (const c of FIXTURE.cases) {
  test(`montage (cas commun) — ${c.name}`, () => {
    const result = compositePlacements({ format: c.format, dpi: c.dpi, zones: c.zones, photos: c.photos });
    assert.deepEqual(result.print, c.expected.print);
    close(result.scale, c.expected.scale, 1e-5, 'échelle');
    assert.equal(result.fullFrame, c.expected.full_frame);
    assert.equal(result.placements.length, c.expected.placements.length);
    result.placements.forEach((p, i) => {
      const e = c.expected.placements[i];
      assert.equal(p.photoIndex, e.photo_index, `zone ${i} : photo`);
      [p.dest.left, p.dest.top, p.dest.right, p.dest.bottom].forEach((v, k) => close(v, e.dest[k], 0.01, `zone ${i} dest[${k}]`));
      [p.source.left, p.source.top, p.source.right, p.source.bottom].forEach((v, k) =>
        close(v, e.source[k], 0.01, `zone ${i} source[${k}]`),
      );
      close(p.angle, e.angle, 1e-4, `zone ${i} angle`);
      close(p.pivot.x, e.pivot[0], 0.01, `zone ${i} pivot x`);
      close(p.pivot.y, e.pivot[1], 0.01, `zone ${i} pivot y`);
    });
  });
}

test('échelle canvas → tirage : largeur du tirage / largeur du canvas', () => {
  close(canvasToPrintScale('portrait'), 1181 / 400, 1e-6, 'portrait');
  close(canvasToPrintScale('stripV'), 590 / 200, 1e-6, 'stripV');
  assert.throws(() => canvasToPrintScale('carré'), /Format inconnu/);
  assert.throws(() => printPixelSize('toString'), /Format inconnu/);
});

test('zone plein cadre : tout le canvas du format', () => {
  for (const [format, { w, h }] of Object.entries(CANVAS_SIZES)) {
    assert.deepEqual(fullFrameZone(format), { left: 0, top: 0, width: w, height: h, angle: 0 });
  }
});

test('cover centré : remplit la zone sans déformer', () => {
  // Photo 3:2 dans une zone carrée : bandes coupées à gauche et à droite.
  assert.deepEqual(coverSourceRect(6000, 4000, 100, 100), { left: 1000, top: 0, right: 5000, bottom: 4000 });
  // Photo portrait dans une zone paysage : haut et bas coupés.
  const portrait = coverSourceRect(4000, 6000, 300, 100);
  [[portrait.left, 0], [portrait.top, 2333.333], [portrait.right, 4000], [portrait.bottom, 3666.667]].forEach(([v, e], k) =>
    close(v, e, 0.01, `portrait[${k}]`),
  );
  // Même proportion : rien n'est coupé.
  assert.deepEqual(coverSourceRect(600, 400, 300, 200), { left: 0, top: 0, right: 600, bottom: 400 });
});

test('zone depuis photoZones.js : rectangle centré → coin haut gauche', () => {
  assert.deepEqual(zoneFromRect({ cx: 200, cy: 229.25, width: 360, height: 418.5, angle: 0 }), {
    left: 20, top: 20, width: 360, height: 418.5, angle: 0,
  });
});

test('dernière photo répétée et échelle d’aperçu', () => {
  const zones = [0, 1, 2].map((i) => ({ left: i * 100, top: 0, width: 100, height: 100, angle: 0 }));
  const { placements } = compositePlacements({
    format: 'stripH', zones, photos: [{ width: 10, height: 10 }, { width: 20, height: 20 }], scale: 1,
  });
  assert.deepEqual(placements.map((p) => p.photoIndex), [0, 1, 1]);
  assert.deepEqual(placements[2].dest, { left: 200, top: 0, right: 300, bottom: 100, width: 100, height: 100 });
  assert.throws(() => compositePlacements({ format: 'stripH', zones, photos: [] }), /Aucune photo/);
});

test('décor : au moins 5 % transparent (un pixel sur 4 par axe)', () => {
  const image = (width, height, alphaAt) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = alphaAt(x, y);
    return { data, width, height };
  };
  assert.equal(hasTransparentArea(image(40, 40, () => 255)), false);
  assert.equal(hasTransparentArea(image(40, 40, () => 0)), true);
  // 100 points examinés : 5 transparents suffisent, 4 non.
  assert.equal(hasTransparentArea(image(40, 40, (x, y) => (y === 0 && x < 20 ? 0 : 255))), true);
  assert.equal(hasTransparentArea(image(40, 40, (x, y) => (y === 0 && x < 16 ? 0 : 255))), false);
  // Seuil à 128 : alpha 127 compte comme transparent, 128 non.
  assert.equal(hasTransparentArea(image(4, 4, () => 127)), true);
  assert.equal(hasTransparentArea(image(4, 4, () => 128)), false);
});
