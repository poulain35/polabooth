// Modèles d'origine des écrans de la borne (LAB-296) : reproduction modifiable de l'accueil 1b
// (HomeView.xaml) et de l'écran de partage (ResultView.xaml), au format de l'éditeur
// (`serializeState` : {bg, bgType, bgGradient, objects}). Module PUR.
//
// Les vues de la borne sont dessinées sur une surface de 1280×800 ; le canvas de l'éditeur fait
// 960×540 (export 1920×1080). Une surface 1280×800 posée en 1920×1080 est étirée ×1,35 et
// décalée de 96 px : en px canvas, x = 48 + 0,675·x_borne, y = 0,675·y_borne.
// Seul écart voulu : les boutons sont agrandis à 75 px de haut sur la surface (≥ 100 px
// d'export, taille conseillée des contrôles D11).

import { VARIABLE_SAMPLES } from './kioskScreenLayout.js';

/** Couleurs de la borne (App.xaml). */
export const KIOSK_COLORS = Object.freeze({
  cream: '#F7F1E7',
  creamDark: '#EFE6D6',
  paper: '#FFFDF8',
  forest: '#24412F',
  sage: '#9DB09A',
  mint: '#D6E8E0',
  blush: '#EBC9C3',
  brown: '#6E5140',
  dark: '#1B241F',
});

export const KIOSK_FONT_TITLE = 'Fraunces';
export const KIOSK_FONT_TEXT = 'DM Sans';

const K = 0.675;
const r2 = (v) => Math.round(v * 100) / 100;
const X = (x) => r2(48 + x * K);
const Y = (y) => r2(y * K);
const S = (v) => r2(v * K);

const C = KIOSK_COLORS;
// Marge intérieure du texte centré d'un bouton : un texte allongé dans l'éditeur passe à la ligne
// avant les bords arrondis (LAB-324).
const BUTTON_PAD = 20;
const SHADOW = { color: 'rgba(27,36,31,0.18)', blur: 16, offsetX: 0, offsetY: 6 };

// ── Fabrique d'objets sérialisés (coordonnées de la surface 1280×800 de la borne) ──

function rect({ x, y, w, h, fill, radius = 0, stroke = null, strokeWidth = 0, ...rest }) {
  return {
    type: 'rect',
    originX: 'left', originY: 'top',
    left: X(x), top: Y(y), width: S(w), height: S(h),
    fill, stroke, strokeWidth: stroke ? S(strokeWidth) : 0,
    rx: S(radius), ry: S(radius),
    ...rest,
  };
}

/** Rectangle tourné autour de son centre (cx, cy). */
function centeredRect({ cx, cy, w, h, angle, fill, radius = 0, ...rest }) {
  return {
    type: 'rect',
    originX: 'center', originY: 'center',
    left: X(cx), top: Y(cy), width: S(w), height: S(h), angle,
    fill, stroke: null, strokeWidth: 0,
    rx: S(radius), ry: S(radius),
    ...rest,
  };
}

// Rayon = moitié exacte du diamètre, sans arrondi à part : Fabric recalcule la largeur depuis le
// rayon à la relecture, un écart de 0,01 px faisait croire à une modification après annulation (LAB-317).
function circle({ x, y, d, fill, stroke = null, strokeWidth = 0, ...rest }) {
  return {
    type: 'circle',
    originX: 'left', originY: 'top',
    left: X(x), top: Y(y), radius: S(d) / 2, width: S(d), height: S(d),
    fill, stroke, strokeWidth: stroke ? S(strokeWidth) : 0,
    ...rest,
  };
}

// Hauteur d'une zone de texte Fabric : n lignes de taille·1,13·interligne, la dernière sans
// interligne (Fabric la recalcule au chargement ; elle sert au plan avant la 1re ouverture).
const textHeight = (size, lineHeight, lines) => r2(S(size) * 1.13 * (lineHeight * (lines - 1) + 1));

function text({ x, y, w, value, font = KIOSK_FONT_TEXT, weight = 400, size, color, align = 'left',
  charSpacing = 0, lineHeight = 1.16, lines = 1, ...rest }) {
  return {
    type: 'textbox',
    originX: 'left', originY: 'top',
    left: X(x), top: Y(y), width: S(w), height: textHeight(size, lineHeight, lines),
    text: value,
    fontFamily: font, fontWeight: weight, fontSize: S(size), fontStyle: 'normal',
    fill: color, textAlign: align, charSpacing, lineHeight,
    stroke: null, strokeWidth: 0,
    // Sans `styles`, Fabric 5 relit le Textbox avec styles = undefined et toObject() lève une
    // exception : l'éditeur ne pourrait plus enregistrer (serializeState).
    styles: [],
    ...rest,
  };
}

function arch({ x, y, w, h, fill }) {
  const r = w / 2;
  return {
    type: 'path',
    originX: 'left', originY: 'top',
    left: X(x), top: Y(y), width: S(w), height: S(h),
    fill, stroke: null, strokeWidth: 0,
    path: [
      ['M', 0, S(r)],
      ['A', S(r), S(r), 0, 0, 1, S(w), S(r)],
      ['L', S(w), S(h)],
      ['L', 0, S(h)],
      ['Z'],
    ],
  };
}

/**
 * Groupe à la boîte (x, y, w, h) de la surface ; les enfants sont donnés en coordonnées de la
 * surface et rendus relatifs au centre du groupe (format sérialisé de Fabric 5).
 */
function group({ x, y, w, h, children, ...rest }) {
  const gcx = X(x) + S(w) / 2;
  const gcy = Y(y) + S(h) / 2;
  return {
    type: 'group',
    originX: 'left', originY: 'top',
    left: X(x), top: Y(y), width: S(w), height: S(h),
    strokeWidth: 0,
    objects: children.map((c) => ({ ...c, left: r2(c.left - gcx), top: r2(c.top - gcy) })),
    ...rest,
  };
}

// ── Accueil 1b ──

function brandObject({ brandName, logo }) {
  // Logo de la société dans une boîte de 280×48 (comme HomeView), sinon son nom en Fraunces.
  if (logo?.url && logo.width > 0 && logo.height > 0) {
    const k = Math.min(S(280) / logo.width, S(48) / logo.height);
    return {
      type: 'image',
      originX: 'left', originY: 'top',
      left: X(80), top: Y(64), width: logo.width, height: logo.height,
      scaleX: r2(k * 1e4) / 1e4, scaleY: r2(k * 1e4) / 1e4,
      src: logo.url, crossOrigin: 'anonymous',
      strokeWidth: 0,
    };
  }
  return text({
    x: 80, y: 64, w: 400, value: brandName || 'Votre société',
    font: KIOSK_FONT_TITLE, weight: 600, size: 24, color: C.forest,
  });
}

function homeObjects(opts) {
  const startW = 540;
  const galleryX = 1280 - 32 - 160;
  const galleryY = 800 - 40 - 75;
  // Tirage de l'événement penché à −4° au centre de la colonne de droite (720..1250).
  const print = { cx: 985, cy: 400, angle: -4 };
  return [
    arch({ x: 1280 + 60 - 600, y: 800 + 40 - 720, w: 600, h: 720, fill: C.mint }),
    circle({ x: 1280 - 470 - 110, y: 80, d: 110, fill: C.blush }),
    brandObject(opts),
    text({
      x: 80, y: 250, w: 640, value: 'BIENVENUE AU PHOTOBOOTH DE',
      weight: 600, size: 17, color: C.brown, charSpacing: 150, personalizedOnly: true,
    }),
    text({
      x: 80, y: 290, w: 640, value: VARIABLE_SAMPLES.event_name,
      font: KIOSK_FONT_TITLE, weight: 600, size: 96, color: C.forest, lineHeight: 0.95, lines: 2,
      kioskVariable: 'event_name', personalizedOnly: true,
    }),
    text({
      x: 80, y: 520, w: 640, value: VARIABLE_SAMPLES.event_date,
      size: 22, color: C.brown, kioskVariable: 'event_date', personalizedOnly: true,
    }),
    group({
      x: 80, y: 662, w: startW, h: 75, kioskAction: 'start',
      children: [
        rect({ x: 80, y: 662, w: startW, h: 75, fill: C.forest, radius: 37.5 }),
        circle({ x: 108, y: 692, d: 14, fill: C.blush }),
        text({
          x: 136, y: 685, w: startW - 28 - 14 - 14 - 34, value: "Touchez l'écran pour commencer",
          weight: 600, size: 24, color: C.cream,
        }),
      ],
    }),
    centeredRect({ ...print, w: 360, h: 530, fill: C.paper, radius: 6, shadow: SHADOW }),
    centeredRect({ ...print, w: 336, h: 506, fill: C.sage, radius: 4, kioskSlot: 'last_photo' }),
    group({
      x: galleryX, y: galleryY, w: 160, h: 75, kioskAction: 'gallery',
      children: [
        // Le PNG du bouton est recadré sur la boîte du groupe. Fabric place le bord extérieur du
        // contour en `left` et lui donne `width + strokeWidth` : la largeur est réduite du contour,
        // sans décalage, pour que le contour tienne dans la boîte (LAB-318).
        rect({ x: galleryX, y: galleryY, w: 158.5, h: 73.5, fill: C.paper, radius: 36.75, stroke: C.forest, strokeWidth: 1.5 }),
        text({ x: galleryX + BUTTON_PAD, y: galleryY + 27, w: 160 - 2 * BUTTON_PAD, value: 'Photos', weight: 600, size: 18, color: C.forest, align: 'center' }),
      ],
    }),
  ];
}

// ── Partage ──

function resultObjects() {
  const col = 584; // colonne de droite : 584..1208
  const colW = 624;
  const tileW = 303;
  const stepper = (x, action, glyph) => group({
    x, y: 278, w: 76, h: 76, kioskAction: action,
    children: [
      circle({ x, y: 278, d: 74, fill: 'rgba(0,0,0,0)', stroke: 'rgba(247,241,231,0.5)', strokeWidth: 2 }),
      text({ x, y: 300, w: 76, value: glyph, weight: 400, size: 28, color: C.cream, align: 'center' }),
    ],
  });
  const tile = (x, action, fill, title, subtitle) => group({
    x, y: 486, w: tileW, h: 124, kioskAction: action,
    children: [
      rect({ x, y: 486, w: tileW, h: 124, fill, radius: 26 }),
      text({ x: x + 22, y: 520, w: tileW - 44, value: title, font: KIOSK_FONT_TITLE, weight: 600, size: 28, color: C.forest, lineHeight: 1 }),
      text({ x: x + 22, y: 556, w: tileW - 44, value: subtitle, size: 15, color: C.forest }),
    ],
  });
  const outline = (x, w, action, label) => group({
    x, y: 662, w, h: 75, kioskAction: action,
    children: [
      rect({ x, y: 662, w: w - 2, h: 73, fill: 'rgba(0,0,0,0)', radius: 36, stroke: C.sage, strokeWidth: 2 }),
      text({ x: x + BUTTON_PAD, y: 689, w: w - 2 * BUTTON_PAD, value: label, weight: 600, size: 17, color: C.forest, align: 'center' }),
    ],
  });

  return [
    arch({ x: -120, y: 90, w: 600, h: 760, fill: C.mint }),
    // Aperçu de la photo, penché à −2° au centre de la colonne de gauche (72..512).
    centeredRect({ cx: 292, cy: 400, w: 440, h: 600, angle: -2, fill: C.paper, radius: 6, shadow: SHADOW }),
    centeredRect({ cx: 292, cy: 400, w: 440, h: 600, angle: -2, fill: C.sage, radius: 6, kioskSlot: 'photo_preview' }),
    // Compte à rebours
    rect({ x: col, y: 64, w: 300, h: 36, fill: C.creamDark, radius: 18 }),
    text({ x: col + 16, y: 73, w: 268, value: VARIABLE_SAMPLES.countdown, weight: 500, size: 15, color: C.brown, kioskVariable: 'countdown' }),
    text({ x: col, y: 122, w: colW, value: 'Magnifique !', font: KIOSK_FONT_TITLE, weight: 600, size: 72, color: C.forest, lineHeight: 1 }),
    text({ x: col, y: 204, w: colW, value: 'Imprimez, envoyez ou récupérez vos photos.', size: 21, color: C.brown }),
    // Bloc d'impression (D10)
    rect({ x: col, y: 254, w: colW, h: 214, fill: C.forest, radius: 28 }),
    text({ x: col + 26, y: 276, w: 330, value: 'Imprimer', font: KIOSK_FONT_TITLE, weight: 600, size: 32, color: C.cream, lineHeight: 1 }),
    text({ x: col + 26, y: 314, w: 330, value: VARIABLE_SAMPLES.print_status, size: 15, color: C.mint, kioskVariable: 'print_status' }),
    text({ x: col + 26, y: 334, w: 330, value: VARIABLE_SAMPLES.prints_remaining, size: 15, color: C.mint, kioskVariable: 'prints_remaining' }),
    stepper(958, 'copies_minus', '−'),
    text({
      x: 1036, y: 297, w: 70, value: VARIABLE_SAMPLES.copies,
      font: KIOSK_FONT_TITLE, weight: 600, size: 34, color: C.cream, align: 'center', lineHeight: 1, kioskVariable: 'copies',
    }),
    stepper(1106, 'copies_plus', '+'),
    group({
      x: col + 26, y: 370, w: colW - 52, h: 75, kioskAction: 'print',
      children: [
        rect({ x: col + 26, y: 370, w: colW - 52, h: 75, fill: C.cream, radius: 20 }),
        text({ x: col + 26 + BUTTON_PAD, y: 395, w: colW - 52 - 2 * BUTTON_PAD, value: 'Imprimer', weight: 700, size: 21, color: C.forest, align: 'center' }),
      ],
    }),
    // Tuiles Email et QR code
    tile(col, 'email', C.mint, 'Email', 'Dans votre boîte mail'),
    tile(col + colW - tileW, 'qr', C.blush, 'QR code', 'Sur votre téléphone'),
    text({ x: col, y: 620, w: colW, value: VARIABLE_SAMPLES.share_status, size: 15, color: C.brown, kioskVariable: 'share_status' }),
    // Reprendre · Terminer
    outline(col, 234, 'retake', 'Refaire les photos'),
    outline(col + colW - 160, 160, 'finish', 'Terminer'),
  ];
}

/**
 * Modèle d'origine d'un écran, au format `serializeState` (objet).
 * @param {'home'|'result'} kind
 * @param {{brandName?: string, logo?: {url: string, width: number, height: number}}} [opts]
 *   accueil : nom de la société (à défaut « Votre société ») ou son logo (taille naturelle en px).
 */
export function kioskScreenTemplate(kind, opts = {}) {
  if (kind === 'home') return { bg: C.cream, bgType: 'solid', bgGradient: null, objects: homeObjects(opts) };
  if (kind === 'result') return { bg: C.cream, bgType: 'solid', bgGradient: null, objects: resultObjects() };
  throw new Error(`Écran inconnu : ${kind}`);
}

/** Même modèle en chaîne JSON, prête pour `<Editor initialCanvasJson>`. */
export function kioskScreenTemplateJson(kind, opts) {
  return JSON.stringify(kioskScreenTemplate(kind, opts));
}
