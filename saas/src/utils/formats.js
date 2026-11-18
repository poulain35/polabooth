/**
 * Format definitions for photobooth templates.
 * Canvas sizes are display dimensions (editor).
 * Export dimensions are the final high-resolution output.
 * Scale factor: exportWidth / canvasWidth (6x for print formats, 2x for HOME_FORMAT).
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

/**
 * Écran d'accueil de la borne (LAB-289) : 16:9, affiché en 960×540, exporté en 1920×1080.
 * Volontairement HORS de FORMATS / FORMAT_LIST : ce n'est pas un format d'impression (pas de
 * fond perdu, pas de zone photo), il ne doit apparaître ni dans le choix du format du client,
 * ni dans allowed_formats, ni dans les adaptations de modèles, ni côté borne/.pola.
 */
// Écran 16:10 : le design rempli (« cover ») perd (1920 - 1080 × 16/10) / 2 = 96 px de chaque côté.
const HOME_SAFE_CROP_EXPORT_PX = (1920 - (1080 * 16) / 10) / 2;
// Repères relevés sur la borne (px de l'image 1920×1080) : pastille « Touchez l'écran pour
// commencer » centrée, bas à 76 px du bas, 103 px de haut ; les tuiles de format, le cadenas et le
// bouton « Photos » occupent la même bande. Bande réservée = pastille + 21 px de marge = 200 px.
const HOME_PILL_BOTTOM_EXPORT_PX = 76;
const HOME_PILL_HEIGHT_EXPORT_PX = 103;
const HOME_RESERVED_BOTTOM_EXPORT_PX = 200;
const HOME_CANVAS_SCALE = 960 / 1920;

export const HOME_FORMAT = {
  id: 'home',
  label: "Écran d'accueil",
  subtitle: '1920×1080 px · écran de la borne',
  canvasWidth: 960,
  canvasHeight: 540,
  exportWidth: 1920,
  exportHeight: 1080,
  pxPerMm: null,
  bleedMm: 0,
  photoZones: [],
  printable: false,
  // Bande coupée à gauche et à droite sur un écran 16:10, en px canvas.
  safeZoneInsetX: HOME_SAFE_CROP_EXPORT_PX * HOME_CANVAS_SCALE,
  // Pastille de la borne et bande du bas couverte par ses boutons, en px canvas.
  pillBottomInset: HOME_PILL_BOTTOM_EXPORT_PX * HOME_CANVAS_SCALE,
  pillHeight: HOME_PILL_HEIGHT_EXPORT_PX * HOME_CANVAS_SCALE,
  reservedBottom: HOME_RESERVED_BOTTOM_EXPORT_PX * HOME_CANVAS_SCALE,
};

/** Format par id : un format d'impression ou l'écran d'accueil ; null si inconnu. */
export function formatById(id) {
  if (id === HOME_FORMAT.id) return HOME_FORMAT;
  return FORMATS[id] ?? null;
}

/** Vrai pour l'écran d'accueil (pas de fond perdu, pas de zone photo, zone de sécurité 16:10). */
export function isHomeFormat(format) {
  return format?.id === HOME_FORMAT.id;
}

// ── Écrans de la borne composés par l'admin (LAB-296) ──────────────────────────────────────
// Même géométrie que l'écran d'accueil du client (960×540 → 1920×1080), sans pastille ni bande
// réservée : les boutons font partie du dessin. Hors de FORMATS et de formatById, pour que
// l'éditeur du client (/e/:code) ne les propose jamais.

/** Zone vue sur un écran 16:10 (1728×1080 centrée), en px d'export 1920×1080. */
export const KIOSK_SAFE_ZONE_EXPORT = Object.freeze({
  x: HOME_SAFE_CROP_EXPORT_PX,
  y: 0,
  w: 1920 - 2 * HOME_SAFE_CROP_EXPORT_PX,
  h: 1080,
});

// Cadenas d'accès admin de l'accueil : bouton 56×56 à 24 px du coin haut droit de la surface
// 1280×800 (HomeView.xaml), surface étirée en 1920×1080 (×1,35, décalée de 96 px) → 1716..1792,
// 32..108 (arrondi).
export const KIOSK_LOCK_ZONE_EXPORT = Object.freeze({ x: 1716, y: 32, w: 76, h: 76 });

const KIOSK_SCREEN_BASE = {
  canvasWidth: 960,
  canvasHeight: 540,
  exportWidth: 1920,
  exportHeight: 1080,
  pxPerMm: null,
  bleedMm: 0,
  photoZones: [],
  printable: false,
  kiosk: true,
  safeZoneExport: KIOSK_SAFE_ZONE_EXPORT,
};

const KIOSK_HOME_FORMAT = Object.freeze({
  ...KIOSK_SCREEN_BASE,
  id: 'kiosk_home',
  screenKind: 'home',
  label: 'Accueil de la borne',
  subtitle: '1920×1080 px · écran de la borne',
  lockZoneExport: KIOSK_LOCK_ZONE_EXPORT,
});

const KIOSK_RESULT_FORMAT = Object.freeze({
  ...KIOSK_SCREEN_BASE,
  id: 'kiosk_result',
  screenKind: 'result',
  label: 'Partage (borne)',
  subtitle: '1920×1080 px · écran de partage de la borne',
  lockZoneExport: null,
});

const KIOSK_SCREEN_FORMATS = Object.freeze({
  home: KIOSK_HOME_FORMAT,
  result: KIOSK_RESULT_FORMAT,
});

/** Vrai pour un écran de la borne composé par l'admin (kiosk_home, kiosk_result). */
export function isKioskFormat(format) {
  return format?.kiosk === true;
}

/** Format d'un écran de la borne par son type ('home' | 'result') ; null si inconnu. */
export function kioskFormatByKind(kind) {
  return KIOSK_SCREEN_FORMATS[kind] ?? null;
}
