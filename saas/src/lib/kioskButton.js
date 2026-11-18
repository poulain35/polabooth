// Réglage d'un bouton de la borne (LAB-324) : textes et forme d'un groupe Fabric 5 marqué
// `kioskAction`, sans le dégrouper (l'action resterait sur un groupe disparu). Module PUR : il
// manipule des objets Fabric par leurs propriétés et leurs méthodes `set` / `initDimensions`.
//
// Règles :
// - Forme réglée : la plus grande forme du groupe (surface de sa boîte), la première du groupe en
//   cas d'égalité. Images et textes exclus. Accueil : la pilule, pas la pastille.
// - Texte modifié : les textes placés dessous ou dessus suivent, l'ensemble des textes garde son
//   centre, et la forme grandit ou rétrécit d'autant (marges gardées). Un Textbox (modèles) garde
//   sa largeur et passe à la ligne ; un texte simple (outil « Bouton ») s'élargit. La forme ne
//   descend pas sous la taille minimale d'un bouton, sauf si elle était déjà plus petite.
// - Contour : la boîte extérieure de la forme ne bouge pas, la forme est réduite de l'épaisseur
//   (Fabric pose le contour à cheval sur le bord) : le PNG recadré sur le groupe n'est pas coupé.
// - Le groupe est ensuite recalculé autour de ses enfants, en gardant son centre, son angle et
//   son échelle.

import { boundingBox, kioskColor, isTransparentBackground, ownMatrix } from './kioskScreenLayout.js';

const TEXT_TYPES = new Set(['text', 'i-text', 'textbox']);
const SHAPE_TYPES = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'triangle']);
const EPS = 0.5;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const isTextObject = (o) => TEXT_TYPES.has(o?.type);
export const isKioskButton = (o) => o?.type === 'group' && !!o.kioskAction;

const childrenOf = (g) => (Array.isArray(g?._objects) ? g._objects : Array.isArray(g?.objects) ? g.objects : []);
const area = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);
const union = (boxes) => boxes.reduce((u, b) => ({
  minX: Math.min(u.minX, b.minX), minY: Math.min(u.minY, b.minY),
  maxX: Math.max(u.maxX, b.maxX), maxY: Math.max(u.maxY, b.maxY),
}));
const center = (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** Textes directs du groupe, du haut vers le bas puis de gauche à droite. */
function sortedTexts(group) {
  return childrenOf(group)
    .map((object, index) => ({ object, index, box: boundingBox(object) }))
    .filter((t) => isTextObject(t.object))
    .sort((a, b) => (Math.abs(a.box.minY - b.box.minY) > EPS ? a.box.minY - b.box.minY : a.box.minX - b.box.minX));
}

/**
 * Champs du panneau : un par texte du bouton. `index` = place du texte dans le groupe.
 * Un texte : « Texte du bouton » ; deux textes l'un sous l'autre (tuile) : « Titre », « Sous-titre ».
 */
export function buttonTextFields(group) {
  const texts = sortedTexts(group);
  if (texts.length === 1) return [{ index: texts[0].index, label: 'Texte du bouton' }];
  if (texts.length === 2 && texts[1].box.minY >= texts[0].box.maxY - EPS) {
    return [{ index: texts[0].index, label: 'Titre' }, { index: texts[1].index, label: 'Sous-titre' }];
  }
  return texts.map((t, i) => ({ index: t.index, label: `Texte ${i + 1}` }));
}

/** Texte du groupe sous un point (coordonnées du groupe) ; le plus petit s'ils se chevauchent. */
export function textIndexAt(group, point) {
  let best = null;
  for (const t of sortedTexts(group)) {
    const b = t.box;
    if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) continue;
    if (!best || area(b) < area(best.box)) best = t;
  }
  return best ? best.index : null;
}

/** Forme du bouton : la plus grande forme du groupe (la première en cas d'égalité), ou null. */
export function buttonShape(group) {
  let best = null;
  let bestArea = -1;
  for (const o of childrenOf(group)) {
    if (!SHAPE_TYPES.has(o.type)) continue;
    const a = area(boundingBox(o));
    if (a > bestArea + 1e-9) { best = o; bestArea = a; }
  }
  return best;
}

/** Couleur lisible par le sélecteur (#RRGGBB ou 'transparent'). */
export function colorForInput(value) {
  if (typeof value !== 'string' || isTransparentBackground(value)) return 'transparent';
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const c = kioskColor(value);
  return c.length === 9 ? `#${c.slice(3)}` : c;
}

const hasStroke = (o) => !!o.stroke && !isTransparentBackground(o.stroke) && num(o.strokeWidth) > 0;
const isRotated = (o) => Math.abs(num(o.angle) % 360) > 1e-6 || o.skewX || o.skewY;

/** Réglages de la forme pour le panneau (contour en px canvas). */
export function buttonShapeStyle(group) {
  const shape = buttonShape(group);
  if (!shape) return null;
  const isRect = shape.type === 'rect';
  return {
    type: shape.type,
    fill: typeof shape.fill === 'string' ? shape.fill : 'transparent',
    hasRadius: isRect,
    radius: isRect ? Math.min(num(shape.rx), num(shape.width) / 2, num(shape.height) / 2) : 0,
    radiusMax: isRect ? Math.min(num(shape.width), num(shape.height)) / 2 : 0,
    stroke: hasStroke(shape) ? shape.stroke : null,
    strokeWidth: hasStroke(shape) ? num(shape.strokeWidth) : 0,
    strokeMax: Math.max(0, Math.min(...outerSize(shape)) / 2 - 1),
  };
}

// Taille extérieure (contour compris) d'un enfant, dans les coordonnées du groupe.
function outerSize(o) {
  const sw = num(o.strokeWidth, 1);
  const sx = Math.abs(num(o.scaleX, 1));
  const sy = Math.abs(num(o.scaleY, 1));
  if (o.strokeUniform) return [num(o.width) * sx + sw, num(o.height) * sy + sw];
  return [(num(o.width) + sw) * sx, (num(o.height) + sw) * sy];
}

// Place le centre d'un objet (coordonnées de son parent), quelle que soit son origine.
function setCenter(o, c) {
  const m = ownMatrix(o);
  o.set({ left: num(o.left) + c.x - m.cx, top: num(o.top) + c.y - m.cy });
}

// Donne à la forme la taille extérieure (w, h) et le contour `sw`, centre gardé.
function resizeShape(o, w, h, sw) {
  const c = { x: ownMatrix(o).cx, y: ownMatrix(o).cy };
  const sx = Math.abs(num(o.scaleX, 1));
  const sy = Math.abs(num(o.scaleY, 1));
  const inner = (outer, s) => Math.max(1, o.strokeUniform ? (outer - sw) / s : outer / s - sw);
  const wasPill = o.type === 'rect' && num(o.rx) >= Math.min(num(o.width), num(o.height)) / 2 - 0.01;
  if (o.type === 'rect') {
    const width = inner(w, sx);
    const height = inner(h, sy);
    const max = Math.min(width, height) / 2;
    const rx = wasPill ? max : Math.min(num(o.rx), max);
    o.set({ width, height, rx, ry: rx, strokeWidth: sw });
  } else if (o.type === 'circle') {
    // Rayon au centième, largeur = 2 × rayon exactement (relecture stable, LAB-317).
    o.set({ strokeWidth: sw, radius: r2(Math.max(inner(w, sx), inner(h, sy)) / 2) });
  } else if (o.type === 'ellipse') {
    o.set({ strokeWidth: sw, rx: inner(w, sx) / 2, ry: inner(h, sy) / 2 });
  } else {
    o.set({ strokeWidth: sw });
    const [nw, nh] = outerSize(o);
    o.set({ scaleX: num(o.scaleX, 1) * (w / nw), scaleY: num(o.scaleY, 1) * (h / nh) });
  }
  setCenter(o, c);
  o.dirty = true;
}

/**
 * Recalcule la boîte du groupe autour de ses enfants (coordonnées relatives au centre), sans
 * toucher à sa transformation : le contenu reste à sa place à l'écran.
 */
function refitGroup(group) {
  const kids = childrenOf(group);
  if (!kids.length) return;
  const [a, b, c, d, e, f] = ownMatrix(group).matrix;
  const u = union(kids.map(boundingBox));
  const k = center(u);
  for (const o of kids) {
    o.set({ left: num(o.left) - k.x, top: num(o.top) - k.y });
    o.setCoords?.();
  }
  const abs = { x: a * k.x + c * k.y + e, y: b * k.x + d * k.y + f };
  group.set({ width: u.maxX - u.minX, height: u.maxY - u.minY });
  setCenter(group, abs);
  group.dirty = true;
  group.setCoords?.();
}

const shiftY = (o, dy) => { if (dy) o.set({ top: num(o.top) + dy }); };

/**
 * Modifie un texte du bouton (`index` = place dans le groupe) avec des propriétés Fabric (text,
 * fontFamily, fontWeight, fontSize, fill…) et adapte la forme et le groupe.
 * @param {{minSize?: number}} [opts] taille minimale d'un bouton, px canvas.
 * @returns {boolean} faux si l'objet n'est pas un texte du groupe.
 */
export function applyButtonTextChange(group, index, props, { minSize = 0 } = {}) {
  const kids = childrenOf(group);
  const target = kids[index];
  if (!isTextObject(target)) return false;
  const texts = kids.filter(isTextObject);
  const before = new Map(texts.map((t) => [t, boundingBox(t)]));
  const unionBefore = union([...before.values()]);
  const shape = buttonShape(group);

  target.set(props);
  target.initDimensions?.();

  // Textes au-dessus ou au-dessous du texte modifié : ils suivent ses bords.
  const b0 = before.get(target);
  const b1 = boundingBox(target);
  for (const t of texts) {
    if (t === target) continue;
    const b = before.get(t);
    if (b.minY >= b0.maxY - EPS) shiftY(t, b1.maxY - b0.maxY);
    else if (b.maxY <= b0.minY + EPS) shiftY(t, b1.minY - b0.minY);
  }

  // L'ensemble des textes garde son centre.
  const unionMoved = union(texts.map(boundingBox));
  const c0 = center(unionBefore);
  const c1 = center(unionMoved);
  for (const t of texts) t.set({ left: num(t.left) + c0.x - c1.x, top: num(t.top) + c0.y - c1.y });

  if (shape && !isRotated(shape)) {
    const [w0, h0] = outerSize(shape);
    const dW = (unionMoved.maxX - unionMoved.minX) - (unionBefore.maxX - unionBefore.minX);
    const dH = (unionMoved.maxY - unionMoved.minY) - (unionBefore.maxY - unionBefore.minY);
    const w = Math.max(w0 + dW, Math.min(w0, minSize));
    const h = Math.max(h0 + dH, Math.min(h0, minSize));
    if (Math.abs(w - w0) > 1e-6 || Math.abs(h - h0) > 1e-6) resizeShape(shape, w, h, num(shape.strokeWidth, 1));
  }

  target.dirty = true;
  refitGroup(group);
  return true;
}

/**
 * Règle la forme du bouton : `fill`, `radius` (arrondi d'un rectangle, px canvas), `stroke`
 * (couleur, null = sans contour) et `strokeWidth` (px canvas). La boîte extérieure de la forme
 * ne bouge pas : la forme est réduite ou agrandie de l'écart d'épaisseur du contour.
 * @returns {boolean} faux si le groupe n'a pas de forme.
 */
export function applyButtonShapeChange(group, props) {
  const shape = buttonShape(group);
  if (!shape) return false;
  if ('fill' in props) shape.set({ fill: props.fill });
  if ('stroke' in props || 'strokeWidth' in props) {
    const stroke = 'stroke' in props ? props.stroke : shape.stroke;
    const [w, h] = outerSize(shape);
    const max = Math.max(0, Math.min(w, h) / 2 - 1);
    const sw = stroke ? r2(Math.min(max, Math.max(0, num(props.strokeWidth, num(shape.strokeWidth))))) : 0;
    shape.set({ stroke: stroke || null });
    resizeShape(shape, w, h, sw);
    refitGroup(group);
  }
  if ('radius' in props && shape.type === 'rect') {
    const max = Math.min(num(shape.width), num(shape.height)) / 2;
    const rx = r2(Math.min(max, Math.max(0, num(props.radius))));
    shape.set({ rx, ry: rx });
  }
  shape.dirty = true;
  group.dirty = true;
  return true;
}
