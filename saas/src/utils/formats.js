/**
 * Format definitions for photobooth templates.
 * Canvas sizes are display dimensions (editor).
 * Export dimensions are the final high-resolution output.
 * Scale factor: exportWidth / canvasWidth (always 6x here).
 */

// All formats share pxPerMm = canvasWidth / physicalWidthMm = 4 px/mm.
// Default bleed 3 mm = 12 px (standard for print).
const PX_PER_MM = 4;
const DEFAULT_BLEED_MM = 3;

export const FORMATS = {
  portrait: {
    id: 'portrait',
    label: 'Portrait',
    subtitle: '10×15 cm · 1 photo',
    canvasWidth: 400,
    canvasHeight: 600,
    exportWidth: 2400,
    exportHeight: 3600,
    pxPerMm: PX_PER_MM,
    bleedMm: DEFAULT_BLEED_MM,
    photoZones: [
      { x: 18, y: 20, w: 360, h: 2511 / 6, label: 'Photo 1' },
    ],
  },
  landscape: {
    id: 'landscape',
    label: 'Paysage',
    subtitle: '15×10 cm · 1 photo',
    canvasWidth: 600,
    canvasHeight: 400,
    exportWidth: 3600,
    exportHeight: 2400,
    pxPerMm: PX_PER_MM,
    bleedMm: DEFAULT_BLEED_MM,
    photoZones: [
      { x: 21, y: 17, w: 560, h: 1775 / 6, label: 'Photo 1' },
    ],
  },
  stripV: {
    id: 'stripV',
    label: 'Bandelette verticale',
    subtitle: '5×15 cm · 3 photos',
    canvasWidth: 200,
    canvasHeight: 600,
    exportWidth: 1200,
    exportHeight: 3600,
    pxPerMm: PX_PER_MM,
    bleedMm: DEFAULT_BLEED_MM,
    photoZones: [
      { x: 10, y: 10,  w: 180, h: 150, label: 'Photo 1' },
      { x: 10, y: 165, w: 180, h: 150, label: 'Photo 2' },
      { x: 10, y: 319, w: 180, h: 150, label: 'Photo 3' },
    ],
  },
  stripH: {
    id: 'stripH',
    label: 'Bandelette horizontale',
    subtitle: '15×5 cm · 3 photos',
    canvasWidth: 600,
    canvasHeight: 200,
    exportWidth: 3600,
    exportHeight: 1200,
    pxPerMm: PX_PER_MM,
    bleedMm: DEFAULT_BLEED_MM,
    photoZones: [
      { x: 11,        y: 10, w: 880 / 6, h: 1090 / 6, label: 'Photo 1' },
      { x: 980 / 6,   y: 10, w: 880 / 6, h: 1090 / 6, label: 'Photo 2' },
      { x: 1895 / 6,  y: 10, w: 880 / 6, h: 1090 / 6, label: 'Photo 3' },
    ],
  },
};

export const FORMAT_LIST = Object.values(FORMATS);

/** Creates a checkerboard pattern canvas (for photo zone fill in editor). */
export function makeCheckerCanvas() {
  const size = 12;
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(0, 0, size, size);
  ctx.fillRect(size, size, size, size);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(size, 0, size, size);
  ctx.fillRect(0, size, size, size);
  return c;
}
