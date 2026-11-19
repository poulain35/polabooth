// Plan (« layout ») des écrans de la borne composés par l'admin (LAB-296, spec
// docs/specs/ecrans-borne-admin.md, « Contrat du plan »). Module PUR : il lit l'état sérialisé de
// l'éditeur (objets `toObject(CUSTOM_PROPS)`, comme `serializeState`) et ne touche ni à Fabric ni
// au DOM.
//
// - buildScreenLayout : objets de l'éditeur → plan en px d'export sur 1920×1080 + contrôles D11.
// - normalizeScreenLayout : lecture d'un plan publié, avec les règles que la borne applique
//   (`ScreenLayout.Parse`). Cas de test communs : docs/specs/fixtures/kiosk-screen-layout-cases.json.

import { zoneRectFromMatrix } from './photoZones.js';
import { clamp } from './format.js';

const SCREEN_SIZE = Object.freeze({ w: 1920, h: 1080 });

/** Zone vue sur un écran 16:10, en px d'export (même valeur que KIOSK_SAFE_ZONE_EXPORT). */
export const SAFE_ZONE = Object.freeze({ x: 96, y: 0, w: 1728, h: 1080 });

/** Cadenas d'accès admin de l'accueil, réservé à la borne, en px d'export. */
export const LOCK_ZONE = Object.freeze({ x: 1716, y: 32, w: 76, h: 76 });

/** Taille conseillée d'un bouton, en px d'export (environ 74 px sur la borne). */
export const MIN_BUTTON_SIZE = 100;

/** Sortes de plan lues par la borne (`layout.kind`). */
export const SCREEN_KINDS = Object.freeze(['home', 'result']);

/**
 * Variantes de l'accueil par format du cadre photo de l'événement : la RPC kiosk_get_screens
 * (et l'export .pola) choisit celle du format du cadre principal, sinon `home` (portrait).
 * Chaque variante est une ligne de kiosk_screens (`kind` = identifiant de l'écran) et publie un
 * plan de sorte `home`.
 */
export const HOME_FORMAT_SCREENS = Object.freeze({
  portrait: 'home',
  landscape: 'home_landscape',
  stripH: 'home_strip_h',
  stripV: 'home_strip_v',
});

/** Écrans composés par l'admin (lignes de kiosk_screens), dans l'ordre des cartes. */
export const SCREEN_IDS = Object.freeze(['home', 'home_landscape', 'home_strip_h', 'home_strip_v', 'result']);

/** Vrai pour un écran d'accueil (toutes variantes). */
export function isHomeScreen(id) {
  return Object.values(HOME_FORMAT_SCREENS).includes(id);
}

/** Sorte du plan publié par un écran : 'home' pour toutes les variantes de l'accueil. */
export function screenLayoutKind(id) {
  return isHomeScreen(id) ? 'home' : id;
}

/** Format du cadre photo d'une variante de l'accueil ('portrait', 'landscape'…), null sinon. */
export function homeScreenFormat(id) {
  return Object.keys(HOME_FORMAT_SCREENS).find((f) => HOME_FORMAT_SCREENS[f] === id) ?? null;
}

/** Variante de l'accueil pour un format de cadre photo (portrait ou inconnu : 'home'). */
export function homeScreenForFormat(format) {
  return (Object.hasOwn(HOME_FORMAT_SCREENS, format ?? '') && HOME_FORMAT_SCREENS[format]) || 'home';
}

/** Valeurs permises par écran (identiques à `allowed` des cas de test communs). */
export const ALLOWED = Object.freeze({
  home: Object.freeze({
    actions: Object.freeze(['start', 'gallery']),
    variables: Object.freeze(['event_name', 'event_date']),
    slots: Object.freeze(['last_photo']),
  }),
  result: Object.freeze({
    actions: Object.freeze(['print', 'copies_minus', 'copies_plus', 'email', 'qr', 'retake', 'finish']),
    variables: Object.freeze(['copies', 'prints_remaining', 'print_status', 'countdown', 'share_status']),
    slots: Object.freeze(['photo_preview']),
  }),
});

export const ACTION_LABELS = Object.freeze({
  start: 'Commencer',
  gallery: 'Photos',
  print: 'Imprimer',
  copies_minus: 'Un exemplaire de moins (−)',
  copies_plus: 'Un exemplaire de plus (+)',
  email: 'Email',
  qr: 'QR code',
  retake: 'Reprendre',
  finish: 'Terminer',
});

/** Texte posé dans le bouton créé par l'outil « Bouton ». */
export const ACTION_BUTTON_TEXTS = Object.freeze({
  start: "Touchez l'écran pour commencer",
  gallery: 'Photos',
  print: 'Imprimer',
  copies_minus: '−',
  copies_plus: '+',
  email: 'Email',
  qr: 'QR code',
  retake: 'Refaire les photos',
  finish: 'Terminer',
});

export const VARIABLE_LABELS = Object.freeze({
  event_name: "Nom de l'événement",
  event_date: 'Date',
  copies: "Nombre d'exemplaires",
  prints_remaining: 'Tirages restants',
  print_status: "État de l'impression",
  countdown: 'Compte à rebours',
  share_status: "État de l'envoi",
});

/**
 * Valeur d'exemple écrite dans un texte vivant (la borne la remplace par la vraie). Ce sont des
 * textes que la borne affiche vraiment (kioskScreenState.js, copie de ses règles), un par texte,
 * pour régler la taille du texte. Vérifié par kioskScreenState.test.js.
 */
export const VARIABLE_SAMPLES = Object.freeze({
  event_name: 'Camille & Thomas',
  event_date: 'Samedi 12 juin 2027',
  copies: '1',
  prints_remaining: 'encore 120 tirages possibles',
  print_status: 'Impression…',
  countdown: "Retour à l'accueil dans 30 s",
  share_status: 'Préparation de votre photo…',
});

export const SLOT_LABELS = Object.freeze({
  last_photo: 'Dernière photo',
  photo_preview: 'Aperçu de la photo',
});

/**
 * Polices embarquées dans la borne (jamais téléchargées) et leurs graisses. Toute autre police d'un
 * texte vivant part avec le plan sous forme de fichier TTF ou OTF (`font_file`, LAB-331).
 */
export const EMBEDDED_FONTS = Object.freeze({
  Fraunces: Object.freeze([600]),
  'DM Sans': Object.freeze([400, 500, 600, 700]),
});

/** Police de repli de la borne : fichier absent ou illisible, police non embarquable. */
export const FALLBACK_FONT = 'DM Sans';

/**
 * Réglage de l'événement qui peut masquer un bouton sur la borne (form_config.kiosk) : note de
 * l'éditeur sur chaque bouton. `start` n'est jamais masqué.
 */
export const ACTION_EVENT_NOTES = Object.freeze({
  gallery: "Masqué sur la borne si l'événement coupe le bouton « Photos », ou tant qu'il n'a aucune photo.",
  print: "Masqué sur la borne si l'événement coupe le bouton « Imprimer » (tout le bloc d'impression disparaît).",
  copies_minus: "Masqué sur la borne si l'événement coupe le bouton « Imprimer » (tout le bloc d'impression disparaît).",
  copies_plus: "Masqué sur la borne si l'événement coupe le bouton « Imprimer » (tout le bloc d'impression disparaît).",
  email: "Masqué sur la borne si l'événement coupe le bouton « Email ».",
  qr: "Masqué sur la borne si l'événement coupe le bouton « QR Code ».",
  retake: "Masqué sur la borne si l'événement coupe le bouton « Reprendre », et quand l'invité vient de la galerie.",
  finish: "Masqué sur la borne si l'événement coupe le bouton « Accueil » : l'écran revient seul à l'accueil.",
});

// Ce que l'absence d'un bouton coûte aux invités (avertissement D11). `start` est facultatif
// (D5 : toucher n'importe où lance la séance) ; `finish` manquant est bloquant.
const MISSING_ACTION_WARNINGS = {
  gallery: 'les invités ne pourront pas revoir les photos de l’événement',
  print: 'les invités ne pourront pas imprimer leur photo',
  copies_minus: 'les invités ne pourront pas retirer un exemplaire',
  copies_plus: 'les invités ne pourront pas ajouter un exemplaire',
  email: 'les invités ne pourront pas recevoir la photo par email',
  qr: 'les invités ne pourront pas récupérer la photo par QR code',
  retake: 'les invités ne pourront pas refaire leurs photos',
};

const DEFAULT_TEXT_COLOR = '#1B241F';
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;

/** Nom d'une image publiée : screen-{kind}-v{n}-{partie}.png (partie : bg, bg-neutral, btn-{action}). */
export function screenImageName(kind, version, part) {
  return `screen-${kind}-v${version}-${part}.png`;
}

/** Nom du fichier de police n (1, 2…) d'une version publiée : unique, aussi dans le `.pola`. */
export function screenFontName(kind, version, index, ext) {
  return `screen-${kind}-v${version}-font-${index}.${ext}`;
}

/** 'ttf' | 'otf' d'après l'adresse d'une police, sinon null (WOFF, WOFF2, extension inconnue). */
export function fontFileExtension(url) {
  const m = typeof url === 'string' ? url.split(/[?#]/)[0].match(/\.(ttf|otf)$/i) : null;
  return m ? m[1].toLowerCase() : null;
}

const NAMED_COLORS = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  gray: '#808080', grey: '#808080', yellow: '#FFFF00', orange: '#FFA500', purple: '#800080', pink: '#FFC0CB' };

const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0').toUpperCase();

/**
 * Couleur d'un texte vivant au format de la borne : `#RRGGBB`, ou `#AARRGGBB` si elle est
 * transparente en partie (la borne refuse le reste). Accepte #RGB, #RGBA, #RRGGBB, #RRGGBBAA,
 * rgb(), rgba() et quelques noms ; sinon, couleur par défaut.
 */
export function kioskColor(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  let r, g, b, a = 1;
  let m;
  if ((m = v.match(/^#([0-9a-f]{3,4})$/))) {
    [r, g, b] = [...m[1].slice(0, 3)].map((c) => parseInt(c + c, 16));
    if (m[1].length === 4) a = parseInt(m[1][3] + m[1][3], 16) / 255;
  } else if ((m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/))) {
    [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    if (m[2]) a = parseInt(m[2], 16) / 255;
  } else if ((m = v.match(/^rgba?\(([^)]+)\)$/))) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return DEFAULT_TEXT_COLOR;
    const channel = (p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p));
    [r, g, b] = parts.slice(0, 3).map(channel);
    if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (![r, g, b, a].every(Number.isFinite)) return DEFAULT_TEXT_COLOR;
  } else if (Object.hasOwn(NAMED_COLORS, v)) {
    return NAMED_COLORS[v];
  } else {
    return DEFAULT_TEXT_COLOR;
  }
  const rgb = `${hex2(r)}${hex2(g)}${hex2(b)}`;
  const alpha = clamp(a, 0, 1);
  return alpha >= 1 ? `#${rgb}` : `#${hex2(alpha * 255)}${rgb}`;
}

/** Vrai si un fond de canvas sérialisé (`state.bg`) est transparent (damier dans l'éditeur). */
export function isTransparentBackground(bg) {
  if (bg === null || bg === undefined || bg === '' || bg === 'transparent') return true;
  if (typeof bg !== 'string') return false;
  const m = bg.replace(/\s+/g, '').match(/^rgba\((?:[^,]+,){3}([^)]+)\)$/i);
  return !!m && Number(m[1]) === 0;
}

// ── Normalisation (règles des cas de test communs) ──────────────────────────────────────────

/** Famille sans guillemets ni espaces autour ('' si ce n'est pas un texte). */
function cleanFontFamily(family) {
  return typeof family === 'string' ? family.replace(/['"]/g, '').trim() : '';
}

/** 'Fraunces' | 'DM Sans' si la famille est embarquée dans la borne (casse ignorée), sinon null. */
export function embeddedFontName(family) {
  const f = cleanFontFamily(family).toLowerCase();
  if (f.startsWith('fraunces')) return 'Fraunces';
  if (f === 'dm sans') return 'DM Sans';
  return null;
}

/** Graisse numérique depuis une valeur Fabric ('normal', 'bold', '600', 600) ; null si illisible. */
function numericWeight(weight) {
  if (weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = typeof weight === 'string' && weight.trim() !== '' ? Number(weight) : weight;
  return isFiniteNumber(n) ? n : null;
}

/** Graisse la plus proche parmi `weights` (égalité, ex. 450 : la plus fine ; illisible : 400). */
export function nearestWeight(weights, weight) {
  const n = numericWeight(weight) ?? 400;
  return weights.reduce((best, w) => (Math.abs(w - n) < Math.abs(best - n) ? w : best));
}

/**
 * Police d'un texte vivant telle que la borne l'écrit : `{font, weight, font_file}`.
 * - Fraunces (600) et DM Sans (400 à 700) : embarquées, `font_file` toujours null.
 * - Autre famille avec un fichier : gardée, graisse arrondie entre 100 et 900 (400 par défaut).
 * - Autre famille sans fichier, ou famille vide : DM Sans à la graisse la plus proche.
 */
export function liveFont(font, weight, fontFile) {
  const family = cleanFontFamily(font);
  const embedded = embeddedFontName(family);
  if (embedded || family === '' || typeof fontFile !== 'string' || fontFile === '') {
    const name = embedded ?? FALLBACK_FONT;
    return { font: name, weight: nearestWeight(EMBEDDED_FONTS[name], weight), font_file: null };
  }
  const n = numericWeight(weight);
  return { font: family, weight: n === null ? 400 : clamp(Math.round(n), 100, 900), font_file: fontFile };
}

const validBox = (o) =>
  isFiniteNumber(o.x) && isFiniteNumber(o.y) && isFiniteNumber(o.w) && isFiniteNumber(o.h) && o.w > 0 && o.h > 0;

/**
 * Plan publié → plan lu par la borne, ou null s'il est refusé (la borne affiche l'écran standard).
 * Les valeurs inconnues sont écartées et listées dans `ignored` ({type, value}, dans l'ordre du plan).
 */
export function normalizeScreenLayout(layout) {
  if (!isObject(layout)) return null;
  if (typeof layout.kind !== 'string' || !Object.hasOwn(ALLOWED, layout.kind)) return null;
  const allowed = ALLOWED[layout.kind];
  const size = layout.size;
  if (!isObject(size) || size.w !== SCREEN_SIZE.w || size.h !== SCREEN_SIZE.h) return null;
  if (!isFiniteNumber(layout.version) || layout.version <= 0) return null;
  const transparent = layout.transparent_background === true;
  const hasBackground = typeof layout.background === 'string' && layout.background !== '';
  if (!hasBackground && !transparent) return null;

  const ignored = [];
  const buttons = [];
  const seenActions = new Set();
  for (const b of Array.isArray(layout.buttons) ? layout.buttons : []) {
    if (!isObject(b)) continue;
    const ok =
      allowed.actions.includes(b.action) &&
      !seenActions.has(b.action) &&
      typeof b.image === 'string' && b.image !== '' &&
      validBox(b);
    if (!ok) {
      ignored.push({ type: 'button', value: b.action ?? null });
      continue;
    }
    seenActions.add(b.action);
    buttons.push({ action: b.action, x: b.x, y: b.y, w: b.w, h: b.h, image: b.image });
  }

  const texts = [];
  for (const t of Array.isArray(layout.texts) ? layout.texts : []) {
    if (!isObject(t)) continue;
    if (!allowed.variables.includes(t.variable) || !validBox(t)) {
      ignored.push({ type: 'text', value: t.variable ?? null });
      continue;
    }
    texts.push({
      variable: t.variable,
      x: t.x, y: t.y, w: t.w, h: t.h,
      angle: isFiniteNumber(t.angle) ? t.angle : 0,
      ...liveFont(t.font, t.weight, t.font_file),
      size: isFiniteNumber(t.size) && t.size > 0 ? t.size : 40,
      color: typeof t.color === 'string' && t.color !== '' ? t.color : DEFAULT_TEXT_COLOR,
      align: TEXT_ALIGNS.has(t.align) ? t.align : 'left',
      uppercase: t.uppercase === true,
      char_spacing: isFiniteNumber(t.char_spacing) ? t.char_spacing : 0,
      max_lines: isFiniteNumber(t.max_lines) ? clamp(Math.round(t.max_lines), 1, 3) : 1,
      personalized_only: t.personalized_only === true,
    });
  }

  const slots = [];
  const seenSlots = new Set();
  for (const s of Array.isArray(layout.slots) ? layout.slots : []) {
    if (!isObject(s)) continue;
    if (!allowed.slots.includes(s.slot) || seenSlots.has(s.slot) || !validBox(s)) {
      ignored.push({ type: 'slot', value: s.slot ?? null });
      continue;
    }
    seenSlots.add(s.slot);
    slots.push({
      slot: s.slot,
      x: s.x, y: s.y, w: s.w, h: s.h,
      angle: isFiniteNumber(s.angle) ? s.angle : 0,
      radius: isFiniteNumber(s.radius) && s.radius > 0 ? s.radius : 0,
    });
  }

  return {
    version: layout.version,
    kind: layout.kind,
    background: hasBackground ? layout.background : null,
    background_neutral:
      typeof layout.background_neutral === 'string' && layout.background_neutral !== ''
        ? layout.background_neutral
        : null,
    transparent_background: transparent,
    buttons,
    texts,
    slots,
    ignored,
  };
}

// ── Géométrie Fabric 5 (reproduite en pur, sur l'état sérialisé) ────────────────────────────

const ORIGIN_OFFSETS = { left: -0.5, top: -0.5, center: 0, right: 0.5, bottom: 0.5 };
const originOffset = (o) => (isFiniteNumber(o) ? o - 0.5 : ORIGIN_OFFSETS[o] ?? -0.5);
const num = (v, d) => (isFiniteNumber(v) ? v : d);

/** Dimensions transformées (échelle et contour compris), comme `_getTransformedDimensions`. */
function transformedDimensions(o) {
  const strokeWidth = num(o.strokeWidth, o.type === 'group' ? 0 : 1);
  const width = num(o.width, 0);
  const height = num(o.height, 0);
  const sx = num(o.scaleX, 1);
  const sy = num(o.scaleY, 1);
  if (o.strokeUniform) return { x: width * sx + strokeWidth, y: height * sy + strokeWidth };
  return { x: (width + strokeWidth) * sx, y: (height + strokeWidth) * sy };
}

/** Matrice propre de l'objet (relative à son parent), comme `calcOwnMatrix` (sans biais). */
export function ownMatrix(o) {
  const dim = transformedDimensions(o);
  const left = num(o.left, 0);
  const top = num(o.top, 0);
  const rad = (num(o.angle, 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Centre = origine (left, top) + décalage vers le centre, tourné autour de l'origine.
  const dx = -originOffset(o.originX) * dim.x;
  const dy = -originOffset(o.originY) * dim.y;
  const cx = left + dx * cos - dy * sin;
  const cy = top + dx * sin + dy * cos;
  const sx = num(o.scaleX, 1) * (o.flipX ? -1 : 1);
  const sy = num(o.scaleY, 1) * (o.flipY ? -1 : 1);
  return { matrix: [cos * sx, sin * sx, -sin * sy, cos * sy, cx, cy], dim, cos, sin, cx, cy };
}

/** Boîte englobante alignée sur les axes, en px canvas (comme `getBoundingRect`). */
export function boundingBox(o) {
  const { dim, cos, sin, cx, cy } = ownMatrix(o);
  const hw = (Math.abs(dim.x * cos) + Math.abs(dim.y * sin)) / 2;
  const hh = (Math.abs(dim.x * sin) + Math.abs(dim.y * cos)) / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

/**
 * Débord de l'ombre d'un objet (et de ses enfants), en px canvas, par côté. Comme Fabric 5
 * (`_setShadow`) : décalage multiplié par l'échelle, flou par l'échelle moyenne (sauf
 * `nonScaling`), et décalages dans les axes de l'écran (non tournés). Le flou compte en entier
 * de chaque côté, décalage en plus ou en moins.
 */
function shadowPadding(o, parentScale = { x: 1, y: 1 }) {
  const scale = { x: parentScale.x * Math.abs(num(o.scaleX, 1)), y: parentScale.y * Math.abs(num(o.scaleY, 1)) };
  const pad = { left: 0, top: 0, right: 0, bottom: 0 };
  const sh = isObject(o.shadow) ? o.shadow : null;
  if (sh && sh.color !== 'transparent') {
    const k = sh.nonScaling ? { x: 1, y: 1 } : scale;
    const blur = Math.max(0, num(sh.blur, 0)) * (k.x + k.y) / 2;
    const dx = num(sh.offsetX, 0) * k.x;
    const dy = num(sh.offsetY, 0) * k.y;
    pad.left = Math.max(0, blur - dx);
    pad.right = Math.max(0, blur + dx);
    pad.top = Math.max(0, blur - dy);
    pad.bottom = Math.max(0, blur + dy);
  }
  for (const child of childrenOf(o)) {
    if (!isObject(child)) continue;
    const c = shadowPadding(child, scale);
    for (const side of Object.keys(pad)) pad[side] = Math.max(pad[side], c[side]);
  }
  return pad;
}

/** Boîte englobante élargie du débord de l'ombre (le PNG du bouton ne la coupe pas). */
function withShadow(box, o) {
  const p = shadowPadding(o);
  return { minX: box.minX - p.left, minY: box.minY - p.top, maxX: box.maxX + p.right, maxY: box.maxY + p.bottom };
}

// Écart de calcul flottant (cos 90° ≈ 6e-17…) ignoré : sans lui, un bord entier gagnerait un pixel vide.
const PIXEL_EPSILON = 1e-6;
const floorPx = (v) => Math.floor(v + PIXEL_EPSILON);
const ceilPx = (v) => Math.ceil(v - PIXEL_EPSILON);

/**
 * Boîte en px d'export entiers {x, y, w, h} qui contient toute la boîte : début arrondi vers le bas,
 * fin vers le haut. Arrondir au plus proche rognait le pixel du bord (contour des boutons arrondis).
 */
function exportBox({ minX, minY, maxX, maxY }, scale) {
  const x = floorPx(minX * scale);
  const y = floorPx(minY * scale);
  return { x, y, w: ceilPx(maxX * scale) - x, h: ceilPx(maxY * scale) - y };
}

/** Rectangle non tourné centré sur l'objet + angle autour du centre, en px d'export. */
function rotatedBox(o, scale) {
  const { matrix } = ownMatrix(o);
  const r = zoneRectFromMatrix(matrix, num(o.width, 0), num(o.height, 0));
  const w = Math.round(r.width * scale);
  const h = Math.round(r.height * scale);
  return {
    x: Math.round(r.cx * scale - w / 2),
    y: Math.round(r.cy * scale - h / 2),
    w,
    h,
    angle: round2(r.angle) || 0,
    scaleY: Math.abs(num(o.scaleY, 1)),
  };
}

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, zone) => a.x >= zone.x && a.y >= zone.y && a.x + a.w <= zone.x + zone.w && a.y + a.h <= zone.y + zone.h;

// Lignes affichées par une zone de texte Fabric (hauteur = n·taille·1,13·interligne, la dernière
// sans interligne) : estimation à partir de la hauteur enregistrée.
function estimatedLines(o) {
  const fontSize = num(o.fontSize, 40);
  const lineHeight = num(o.lineHeight, 1.16);
  const height = num(o.height, 0);
  if (fontSize <= 0 || lineHeight <= 0 || height <= 0) return 1;
  return Math.max(1, Math.round((height / (fontSize * 1.13) - 1) / lineHeight + 1));
}

const childrenOf = (o) => (Array.isArray(o?.objects) ? o.objects : Array.isArray(o?._objects) ? o._objects : []);

function hasMarkedChild(o) {
  return childrenOf(o).some((c) => c?.kioskAction || c?.kioskVariable || c?.kioskSlot || hasMarkedChild(c));
}

const quote = (s) => `« ${s} »`;

/**
 * Objets de l'éditeur (sérialisés) → plan du contrat + contrôles de publication (D11).
 *
 * @param {object[]} objects  `state.objects` de `serializeState` (premier niveau du canvas).
 * @param {string} kind  identifiant de l'écran (SCREEN_IDS) : noms des fichiers ; ses règles sont
 *   celles de sa sorte de plan (screenLayoutKind).
 * @param {object} [opts]
 * @param {number} [opts.version=1]                 numéro de la version publiée (noms d'images).
 * @param {number} [opts.canvasWidth=960]           largeur du canvas de l'éditeur (export ×2).
 * @param {boolean} [opts.transparentBackground=false]  fond du canvas transparent (D8).
 * @param {{name: string, url: string}[]} [opts.customFonts]  polices importées (`custom_fonts`).
 * @returns {{
 *   layout: object,
 *   blocking: {code: string, message: string}[],
 *   warnings: {code: string, message: string}[],
 *   parts: {
 *     background: {name: string|null, objectIndices: number[]},
 *     backgroundNeutral: {name: string, objectIndices: number[]} | null,
 *     buttons: {action: string, name: string, objectIndex: number, box: object}[],
 *     liveIndices: number[],
 *     fonts: {name: string, family: string, weight: number, source: 'google'|'custom', url: string|null}[],
 *   }
 * }}
 *   `objectIndices` : objets de premier niveau à garder visibles pour exporter ce fond (tous les
 *   autres sont masqués) ; `buttons[].objectIndex` : objet à exporter seul, à la taille de `box`.
 *   `fonts` : fichiers de police à joindre (`texts[].font_file` = `name`) ; `source` google = à
 *   récupérer par la fonction google-font-file, custom = fichier `url` du bucket `fonts`.
 */
export function buildScreenLayout(objects, kind, opts = {}) {
  const layoutKind = screenLayoutKind(kind);
  if (!Object.hasOwn(ALLOWED, layoutKind)) throw new Error(`Écran inconnu : ${kind}`);
  const allowed = ALLOWED[layoutKind];
  const version = opts.version ?? 1;
  const canvasWidth = opts.canvasWidth ?? 960;
  const scale = SCREEN_SIZE.w / canvasWidth;
  const transparent = opts.transparentBackground === true;
  const list = Array.isArray(objects) ? objects : [];

  const blocking = [];
  const warnings = [];
  const block = (code, message) => blocking.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  const buttons = [];
  const texts = [];
  const slots = [];
  const buttonParts = [];
  const bareBoxes = new Map(); // bouton du plan → sa boîte sans l'ombre (messages des contrôles)
  const liveIndices = [];
  const decorIndices = [];
  const actionCounts = new Map();

  // Polices des textes vivants (LAB-331) : un fichier par famille importée, par famille et graisse
  // pour Google (fichiers statiques, une graisse chacun).
  const customFonts = new Map(
    (Array.isArray(opts.customFonts) ? opts.customFonts : [])
      .filter((f) => isObject(f) && typeof f.name === 'string')
      .map((f) => [f.name, f]),
  );
  const fonts = [];
  const fontFor = (fontFamily, fontWeight, label) => {
    const family = cleanFontFamily(fontFamily);
    if (family === '' || embeddedFontName(family)) return liveFont(family, fontWeight, null);
    const custom = customFonts.get(family);
    const ext = custom ? fontFileExtension(custom.url) : 'ttf';
    if (!ext) {
      warn(
        'live_font_format',
        `Le texte vivant ${quote(label)} utilise ${family}, importée en WOFF ou WOFF2 : la borne écrira ce texte en DM Sans. Importez-la en TTF ou OTF pour la garder.`,
      );
      return liveFont(FALLBACK_FONT, fontWeight, null);
    }
    const { weight } = liveFont(family, fontWeight, ext);
    const source = custom ? 'custom' : 'google';
    let part = fonts.find((f) => f.family === family && (source === 'custom' || f.weight === weight));
    if (!part) {
      part = { name: screenFontName(kind, version, fonts.length + 1, ext), family, weight, source, url: custom?.url ?? null };
      fonts.push(part);
    }
    return { font: family, weight, font_file: part.name };
  };

  list.forEach((o, index) => {
    if (!isObject(o)) return;
    if (o.visible === false) return;
    if (hasMarkedChild(o)) {
      warn(
        'marked_in_group',
        'Un bouton, un texte vivant ou un emplacement est rangé dans un groupe : la borne ne le verra pas. Dégroupez-le.',
      );
    }

    if (o.kioskSlot) {
      liveIndices.push(index);
      if (!allowed.slots.includes(o.kioskSlot)) {
        warn('unknown_slot', `L'emplacement ${quote(o.kioskSlot)} n'existe pas sur cet écran : il sera ignoré.`);
        return;
      }
      if (slots.some((s) => s.slot === o.kioskSlot)) {
        warn('duplicate_slot', `L'emplacement ${quote(SLOT_LABELS[o.kioskSlot])} figure deux fois : seul le premier sera utilisé.`);
        return;
      }
      const box = rotatedBox(o, scale);
      const rx = num(o.rx, 0) * Math.abs(num(o.scaleX, 1)) * scale;
      slots.push({ slot: o.kioskSlot, x: box.x, y: box.y, w: box.w, h: box.h, angle: box.angle, radius: Math.round(rx) });
      return;
    }

    if (o.kioskVariable) {
      liveIndices.push(index);
      if (!allowed.variables.includes(o.kioskVariable)) {
        warn('unknown_variable', `Le texte vivant ${quote(o.kioskVariable)} n'existe pas sur cet écran : il sera ignoré.`);
        return;
      }
      const box = rotatedBox(o, scale);
      const minLines = o.kioskVariable === 'event_name' ? 2 : 1;
      texts.push({
        variable: o.kioskVariable,
        x: box.x, y: box.y, w: box.w, h: box.h,
        angle: box.angle,
        ...fontFor(o.fontFamily, o.fontWeight, VARIABLE_LABELS[o.kioskVariable]),
        size: Math.max(1, Math.round(num(o.fontSize, 40) * box.scaleY * scale)),
        color: kioskColor(o.fill),
        align: TEXT_ALIGNS.has(o.textAlign) ? o.textAlign : 'left',
        uppercase: o.textTransform === 'uppercase',
        char_spacing: num(o.charSpacing, 0),
        max_lines: clamp(Math.max(estimatedLines(o), minLines), 1, 3),
        personalized_only: o.personalizedOnly === true,
      });
      return;
    }

    if (o.kioskAction) {
      if (!allowed.actions.includes(o.kioskAction)) {
        warn('unknown_action', `L'action ${quote(o.kioskAction)} n'existe pas sur cet écran : l'objet restera dans le décor.`);
        decorIndices.push(index);
        return;
      }
      liveIndices.push(index);
      const count = (actionCounts.get(o.kioskAction) ?? 0) + 1;
      actionCounts.set(o.kioskAction, count);
      if (count > 1) return; // bloquant, signalé plus bas ; seul le premier est dans le plan
      // Boîte = image du bouton : ombre comprise, sinon le recadrage la couperait.
      const bounds = boundingBox(o);
      const box = exportBox(withShadow(bounds, o), scale);
      const name = screenImageName(kind, version, `btn-${o.kioskAction}`);
      const button = { action: o.kioskAction, ...box, image: name };
      buttons.push(button);
      bareBoxes.set(button, exportBox(bounds, scale));
      buttonParts.push({ action: o.kioskAction, name, objectIndex: index, box });
      return;
    }

    decorIndices.push(index);
  });

  // ── Contrôles bloquants ──
  // Le bouton lui-même est dans la zone, seule son ombre en sort : le message le dit (LAB-317).
  for (const b of buttons) {
    const label = quote(ACTION_LABELS[b.action]);
    const bare = bareBoxes.get(b);
    if (!inside(b, SAFE_ZONE)) {
      block('outside_safe_zone', inside(bare, SAFE_ZONE)
        ? `L'ombre du bouton ${label} sort de la zone vue sur un écran 16:10 : réduisez-la ou rapprochez le bouton du centre.`
        : `Le bouton ${label} sort de la zone vue sur un écran 16:10 : rapprochez-le du centre.`);
    }
    if (layoutKind === 'home' && intersects(b, LOCK_ZONE)) {
      block('on_lock_zone', intersects(bare, LOCK_ZONE)
        ? `Le bouton ${label} est sur la zone du cadenas, réservée à la borne : déplacez-le.`
        : `L'ombre du bouton ${label} déborde sur la zone du cadenas, réservée à la borne : réduisez-la ou éloignez le bouton.`);
    }
  }
  for (const [action, count] of actionCounts) {
    if (count > 1) {
      block(
        'duplicate_action',
        `L'action ${quote(ACTION_LABELS[action])} figure sur ${count} boutons : chaque action ne peut figurer qu'une fois.`,
      );
    }
  }
  if (layoutKind === 'result') {
    if (!slots.some((s) => s.slot === 'photo_preview')) {
      block('missing_photo_preview', 'Il manque l’emplacement « Aperçu de la photo » : les invités ne verraient pas leur photo.');
    }
    if (!buttons.some((b) => b.action === 'finish')) {
      block('missing_finish', 'Il manque le bouton « Terminer » : les invités ne pourraient pas revenir à l’accueil.');
    }
  }

  // ── Avertissements ──
  for (const b of buttons) {
    if (b.w < MIN_BUTTON_SIZE || b.h < MIN_BUTTON_SIZE) {
      warn(
        'small_button',
        `Le bouton ${quote(ACTION_LABELS[b.action])} est petit (${b.w}×${b.h} px) : visez au moins ${MIN_BUTTON_SIZE}×${MIN_BUTTON_SIZE} px pour le doigt.`,
      );
    }
  }
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      if (intersects(buttons[i], buttons[j])) {
        warn(
          'overlapping_buttons',
          `Les boutons ${quote(ACTION_LABELS[buttons[i].action])} et ${quote(ACTION_LABELS[buttons[j].action])} se chevauchent : le toucher risque de lancer le mauvais.`,
        );
      }
    }
  }
  for (const action of allowed.actions) {
    if (!actionCounts.has(action) && MISSING_ACTION_WARNINGS[action]) {
      warn('missing_action', `Pas de bouton ${quote(ACTION_LABELS[action])} : ${MISSING_ACTION_WARNINGS[action]}.`);
    }
  }

  // ── Fonds ──
  const hasDecor = decorIndices.length > 0;
  const background = transparent && !hasDecor ? null : screenImageName(kind, version, 'bg');
  const neutralIndices = decorIndices.filter((i) => list[i].personalizedOnly !== true);
  const needsNeutral = layoutKind === 'home' && neutralIndices.length !== decorIndices.length;
  const backgroundNeutral = needsNeutral
    ? { name: screenImageName(kind, version, 'bg-neutral'), objectIndices: neutralIndices }
    : null;

  const layout = {
    version,
    kind: layoutKind,
    size: { w: SCREEN_SIZE.w, h: SCREEN_SIZE.h },
    background,
    background_neutral: backgroundNeutral?.name ?? null,
    transparent_background: transparent,
    buttons,
    texts,
    slots,
  };

  return {
    layout,
    blocking,
    warnings,
    parts: {
      background: { name: background, objectIndices: decorIndices },
      backgroundNeutral,
      buttons: buttonParts,
      liveIndices,
      fonts,
    },
  };
}

/**
 * Raccourci : état de l'éditeur (`serializeState`, objet ou chaîne) → buildScreenLayout.
 * Le fond transparent est lu dans `state.bg` (D8).
 */
export function buildScreenLayoutFromState(state, kind, opts = {}) {
  const s = typeof state === 'string' ? JSON.parse(state) : state ?? {};
  const transparent = (s.bgType ?? 'solid') !== 'gradient' && isTransparentBackground(s.bg);
  return buildScreenLayout(s.objects ?? [], kind, { transparentBackground: transparent, ...opts });
}
