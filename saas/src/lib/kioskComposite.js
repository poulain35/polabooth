// Montage du tirage comme la borne, pour l'aperçu (spec docs/specs/apercu-borne.md). Module miroir
// pur de kiosk/PolaKiosk/Services/CompositeService.cs (CreateCompositeAsync, PrintPixelSize,
// CanvasToPrintScale, FullFrameZone, CoverSourceRect, HasTransparentArea). Les zones viennent de
// photoZones.js (même géométrie que ParsePhotoZones). La borne calcule en float 32 bits : les
// calculs passent par Math.fround pour donner les mêmes nombres.
// Cas communs : docs/specs/fixtures/kiosk-composite-cases.json, lus aussi par les tests de la borne.

const f = Math.fround;

/** Dimensions canvas SaaS par format (CompositeService.CanvasSizes). */
export const CANVAS_SIZES = Object.freeze({
  portrait: Object.freeze({ w: 400, h: 600 }),
  landscape: Object.freeze({ w: 600, h: 400 }),
  stripV: Object.freeze({ w: 200, h: 600 }),
  stripH: Object.freeze({ w: 600, h: 200 }),
});

/** Dimensions physiques en mm (CompositeService.PhysicalSizes). */
const PHYSICAL_SIZES_MM = Object.freeze({
  portrait: Object.freeze({ w: 100, h: 150 }),
  landscape: Object.freeze({ w: 150, h: 100 }),
  stripV: Object.freeze({ w: 50, h: 150 }),
  stripH: Object.freeze({ w: 150, h: 50 }),
});

const DEFAULT_DPI = 300;

function known(table, format) {
  const size = Object.hasOwn(table, format) ? table[format] : null;
  if (!size) throw new Error(`Format inconnu : ${format}`);
  return size;
}

/** CompositeService.PrintPixelSize : taille du tirage en pixels (troncature, comme la borne). */
export function printPixelSize(format, dpi = DEFAULT_DPI) {
  const mm = known(PHYSICAL_SIZES_MM, format);
  const mmPerInch = f(25.4);
  return {
    w: Math.trunc(f(f(f(mm.w) / mmPerInch) * dpi)),
    h: Math.trunc(f(f(f(mm.h) / mmPerInch) * dpi)),
  };
}

/** CompositeService.CanvasToPrintScale : échelle canvas SaaS → pixels du tirage. */
export function canvasToPrintScale(format, dpi = DEFAULT_DPI) {
  const canvas = known(CANVAS_SIZES, format);
  return f(printPixelSize(format, dpi).w / canvas.w);
}

/** CompositeService.FullFrameZone : zone couvrant tout le canvas (modèle sans zone photo). */
export function fullFrameZone(format) {
  const canvas = known(CANVAS_SIZES, format);
  return { left: 0, top: 0, width: canvas.w, height: canvas.h, angle: 0 };
}

/**
 * Zone de la borne (PhotoZone : left, top, width, height, angle en px canvas) depuis le rectangle
 * centré de photoZones.js ({ cx, cy, width, height, angle }).
 */
export function zoneFromRect({ cx, cy, width, height, angle = 0 }) {
  return { left: cx - width / 2, top: cy - height / 2, width, height, angle };
}

/**
 * CompositeService.CoverSourceRect : partie de la photo à dessiner pour remplir la zone sans
 * déformer, centrée (cover). Coordonnées dans la photo d'origine.
 */
export function coverSourceRect(srcW, srcH, destW, destH) {
  const scale = f(Math.max(f(destW / srcW), f(destH / srcH)));
  const offsetX = f(f(f(f(srcW * scale) - destW) / 2) / scale);
  const offsetY = f(f(f(f(srcH * scale) - destH) / 2) / scale);
  return {
    left: offsetX,
    top: offsetY,
    right: f(offsetX + f(destW / scale)),
    bottom: f(offsetY + f(destH / scale)),
  };
}

/**
 * Placement de chaque photo sur le tirage, dans l'ordre des zones (CreateCompositeAsync) :
 *   - modèle sans zone : une zone plein cadre (`fullFrame` vrai) ;
 *   - moins de photos que de zones : la dernière photo est répétée ;
 *   - rectangle de destination = zone × échelle, photo recadrée en cover centré, tournée de l'angle
 *     de la zone autour du centre du rectangle.
 * `photos` : tailles des photos ({ width, height }), au moins une.
 * `scale` permet de dessiner l'aperçu à une autre taille que celle du tirage (par défaut : l'échelle
 * de la borne au DPI donné).
 */
export function compositePlacements({ format, zones = [], photos, dpi = DEFAULT_DPI, scale = null }) {
  if (!Array.isArray(photos) || photos.length === 0) throw new Error('Aucune photo à assembler.');
  const print = printPixelSize(format, dpi);
  const s = scale == null ? canvasToPrintScale(format, dpi) : f(scale);
  const fullFrame = zones.length === 0;
  const drawZones = fullFrame ? [fullFrameZone(format)] : zones;

  const placements = drawZones.map((zone, i) => {
    const photoIndex = Math.min(i, photos.length - 1);
    const photo = photos[photoIndex];
    const left = f(f(zone.left) * s);
    const top = f(f(zone.top) * s);
    const right = f(f(f(zone.left) + f(zone.width)) * s);
    const bottom = f(f(f(zone.top) + f(zone.height)) * s);
    const dest = { left, top, right, bottom, width: f(right - left), height: f(bottom - top) };
    return {
      photoIndex,
      dest,
      source: coverSourceRect(photo.width, photo.height, dest.width, dest.height),
      angle: f(zone.angle ?? 0),
      // SKRect.MidX / MidY : left + width / 2.
      pivot: { x: f(left + f(dest.width / 2)), y: f(top + f(dest.height / 2)) },
    };
  });

  return { print, scale: s, fullFrame, placements };
}

/**
 * CompositeService.HasTransparentArea : vrai si au moins 5 % du décor est transparent (alpha < 128),
 * un pixel sur 4 par axe examiné. `data` : RGBA (ImageData), `width` × `height`. Modèle sans zone photo : un
 * décor sans partie transparente n'est pas posé, la photo est imprimée seule.
 */
export function hasTransparentArea({ data, width, height }) {
  let sampled = 0;
  let transparent = 0;
  for (let y = 0; y < height; y += 4) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 4) {
      sampled++;
      if (data[row + x * 4 + 3] < 128) transparent++;
    }
  }
  return transparent * 20 >= sampled;
}

/** Message de l'aperçu pour un modèle sans zone photo (spec, cas limites). */
export const NO_ZONE_MESSAGE = "Ce modèle n'a pas de zone photo : la photo remplira tout le tirage.";
