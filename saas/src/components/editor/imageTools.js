// Images de l'éditeur : SVG en bitmap, photos importées, teinte des stickers, réduction avant détourage.
import { PHOTO_JPEG_QUALITY, needsStorage, planPhotoEncoding } from '../../lib/designImages';

// Convertit un SVG (string) en data URL PNG via un canvas offscreen.
// Évite de charger le SVG comme milliers d'objets Fabric.js (lent sur les gros fichiers).
export function svgToBitmap(svgString, maxPx = 3600) {
  return new Promise((resolve) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const nw    = img.naturalWidth  || maxPx;
      const nh    = img.naturalHeight || maxPx;
      // Pas de Math.min(1, ...) — on upscale le vecteur SVG à la résolution cible
      const scale = maxPx / Math.max(nw, nh);
      const oc    = document.createElement('canvas');
      oc.width    = Math.round(nw * scale);
      oc.height   = Math.round(nh * scale);
      oc.getContext('2d').drawImage(img, 0, 0, oc.width, oc.height);
      URL.revokeObjectURL(url);
      resolve(oc.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ─── Images rangées dans le stockage (LAB-348) ───────────────────────────────

// Sources des images vivantes du canvas à ranger, groupes et masques compris (Fabric : getSrc()).
export function liveImageSources(objects, found = new Set()) {
  for (const o of objects ?? []) {
    if (!o) continue;
    if (o.type === 'image' && typeof o.getSrc === 'function') {
      const src = o.getSrc();
      if (needsStorage(src)) found.add(src);
    }
    if (typeof o.getObjects === 'function') liveImageSources(o.getObjects(), found);
    if (o.clipPath) liveImageSources([o.clipPath], found);
  }
  return found;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Vrai si l'image a au moins un pixel transparent (échantillon réduit à 256 px de côté).
function imageHasAlpha(img) {
  const side = 256;
  const ratio = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const oc = document.createElement('canvas');
  oc.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  oc.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = oc.getContext('2d');
  ctx.drawImage(img, 0, 0, oc.width, oc.height);
  const { data } = ctx.getImageData(0, 0, oc.width, oc.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

// Photo importée prête à ajouter : réduite à la résolution d'export du format (maxPx) et en
// PNG, JPEG ou WebP, ou le fichier d'origine s'il convient déjà. Renvoie l'élément <img> chargé.
export async function preparePhoto(file, maxPx) {
  const original = await readAsDataURL(file);
  const img = await loadImageElement(original);
  const type = (file.type || '').toLowerCase();
  const plan = planPhotoEncoding({ type, size: file.size, width: img.naturalWidth, height: img.naturalHeight, maxPx });
  if (plan.keep) return img;
  // PNG proposé pour une image peut-être transparente : JPEG si elle est en fait opaque.
  const outType = plan.type === 'image/png' && !imageHasAlpha(img) ? 'image/jpeg' : plan.type;
  const oc = document.createElement('canvas');
  oc.width = plan.width;
  oc.height = plan.height;
  const ctx = oc.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, plan.width, plan.height);
  return loadImageElement(oc.toDataURL(outType, outType === 'image/jpeg' ? PHOTO_JPEG_QUALITY : undefined));
}

// ─── Couleur de sticker ───────────────────────────────────────────────────────

export function tintGroup(group, color, isTransparent) {
  group.getObjects().forEach((child) => {
    if (child.type === 'group') {
      tintGroup(child, color, isTransparent);
    } else {
      tintElement(child, color, isTransparent);
    }
  });
}

export function tintElement(el, color, isTransparent) {
  if (!Object.prototype.hasOwnProperty.call(el, '_origFill'))   el._origFill   = el.fill;
  if (!Object.prototype.hasOwnProperty.call(el, '_origStroke')) el._origStroke = el.stroke;

  if (isTransparent) {
    el.set({ fill: el._origFill, stroke: el._origStroke });
  } else {
    if (el.fill   && el.fill   !== 'none') el.set({ fill:   color });
    if (el.stroke && el.stroke !== 'none') el.set({ stroke: color });
  }
}
