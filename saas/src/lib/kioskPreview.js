// Aperçu sur la borne (spec docs/specs/apercu-borne.md, LAB-307) : préparation des images et
// géométrie de la fenêtre. Module pur, sans React : la fenêtre (KioskPreview.jsx) ne reçoit que ce
// que renvoient ces fonctions, jamais le canvas de l'éditeur (D10).
import { util } from './fabric.js';
import { exportAsHighResPNG, exportScreenParts } from '../utils/export.js';
import { HOME_FORMAT, isHomeFormat } from '../utils/formats.js';
import { findPhotoZones, photoZoneRect } from './photoZones.js';
import { zoneFromRect } from './kioskComposite.js';
import { buildScreenLayoutFromState } from './kioskScreenLayout.js';
import { screenSourceFromParts } from './kioskDesignedScreen.js';

/** Écrans proposés : 16:10 (écran 12" de la borne) par défaut, 16:9 au choix (D1). */
export const PREVIEW_SCREENS = Object.freeze([
  Object.freeze({ id: '16:10', label: '16:10', detail: '1280×800', width: 1280, height: 800 }),
  Object.freeze({ id: '16:9', label: '16:9', detail: '1920×1080', width: 1920, height: 1080 }),
]);
export const DEFAULT_PREVIEW_SCREEN = PREVIEW_SCREENS[0];

export function previewScreenById(id) {
  return PREVIEW_SCREENS.find((s) => s.id === id) ?? DEFAULT_PREVIEW_SCREEN;
}

export const PREVIEW_MESSAGES = Object.freeze({
  preparing: "Préparation de l'aperçu…",
  failed: "L'aperçu n'a pas pu être préparé. Votre design n'a pas changé.",
  photosHint: 'Visible dès la première photo',
  photoTooLarge: 'Cette photo est trop lourde : 20 Mo au maximum.',
  photoWrongType: 'Choisissez une photo JPEG, PNG ou WebP.',
  photoUnreadable: "Cette photo n'a pas pu être lue. Essayez-en une autre.",
});

/**
 * Exporte le design avec la fonction de l'envoi (même PNG que la borne recevra) et lit ses zones
 * photo, en px canvas du format (PhotoZone de la borne). Ne touche ni à l'historique ni à l'état
 * « modifié » : l'export remet le canvas dans son état d'origine.
 */
export async function prepareDesignPreview(canvas, format, exportPng = exportAsHighResPNG) {
  if (isHomeFormat(format)) {
    return { kind: 'home', formatId: HOME_FORMAT.id, pngUrl: await exportPng(canvas, HOME_FORMAT), zones: [] };
  }
  const zones = findPhotoZones(canvas.getObjects()).map((zone) => zoneFromRect(photoZoneRect(zone)));
  const pngUrl = await exportPng(canvas, format, { punchZones: true });
  return { kind: 'print', formatId: format.id, pngUrl, zones };
}

// Zones photo et groupes qui en contiennent, sans le reste (images comprises : rien à charger).
// Un groupe sérialisé garde sa taille et sa place, le vider de ses décors ne déplace pas les zones.
function zonesOnly(objects) {
  return (objects ?? []).flatMap((o) => {
    if (o?.isPhotoZone) return [o];
    if (o?.type !== 'group' || !Array.isArray(o.objects)) return [];
    const children = zonesOnly(o.objects);
    return children.length ? [{ ...o, objects: children }] : [];
  });
}

/** Zones photo d'un design enregistré (canvas_json, objet ou texte), comme prepareDesignPreview. */
export async function zonesFromCanvasJson(canvasJson) {
  const state = typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson;
  const kept = zonesOnly(state?.objects);
  if (!kept.length) return [];
  const objects = await util.enlivenObjects(kept);
  return findPhotoZones(objects).map((zone) => zoneFromRect(photoZoneRect(zone)));
}

/**
 * Source de l'aperçu pour un design déjà envoyé (fiche de l'événement) : son PNG final, celui que
 * la borne reçoit, et les zones lues dans canvas_json. Rien n'est exporté.
 */
export async function prepareStoredDesignPreview({ kind, format, finalPngUrl, canvasJson }) {
  if (kind === 'home') return { kind: 'home', formatId: HOME_FORMAT.id, pngUrl: finalPngUrl, zones: [] };
  return { kind: 'print', formatId: format, pngUrl: finalPngUrl, zones: await zonesFromCanvasJson(canvasJson) };
}

/**
 * Source de l'aperçu « Écran composé » (LAB-309) depuis l'éditeur des écrans de la borne : le même
 * découpage que la publication (plan, puis images exportées par parties), sans rien envoyer.
 * `state` : état de l'éditeur (getState().canvasJson), sélection relâchée. Lève une erreur si la
 * borne refuserait le plan.
 */
export function prepareScreenPreview(canvas, state, format, exportParts = exportScreenParts) {
  const kind = format.screenKind;
  const { layout, parts } = buildScreenLayoutFromState(state, kind, { canvasWidth: format.canvasWidth });
  const source = screenSourceFromParts(layout, exportParts(canvas, format, parts));
  if (!source) throw new Error("Plan de l'écran refusé par la borne.");
  return source;
}

// ─── Photos ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Photo d'exemple de chaque zone : une différente par zone tant qu'il y en a assez, à partir de
 * `offset` (« Autres photos » le fait avancer).
 */
export function samplePhotoOrder(zoneCount, sampleCount, offset = 0) {
  if (sampleCount <= 0) return [];
  const count = Math.max(1, zoneCount);
  const start = ((offset % sampleCount) + sampleCount) % sampleCount;
  return Array.from({ length: count }, (_, i) => (start + i) % sampleCount);
}

/** Décalage suivant pour « Autres photos » : toutes les zones changent de photo. */
export function nextSampleOffset(offset, zoneCount, sampleCount) {
  if (sampleCount <= 0) return 0;
  const step = Math.min(Math.max(1, zoneCount), sampleCount);
  return (offset + (step === sampleCount ? 1 : step)) % sampleCount;
}

export const USER_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const USER_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/** Photo de l'utilisateur (D4) : null si elle est acceptée, sinon le message à afficher. */
export function userPhotoError(file) {
  if (!file) return null;
  if (!USER_PHOTO_TYPES.includes(file.type)) return PREVIEW_MESSAGES.photoWrongType;
  if (file.size > USER_PHOTO_MAX_BYTES) return PREVIEW_MESSAGES.photoTooLarge;
  return null;
}

// ─── Géométrie ──────────────────────────────────────────────────────────────────────────────────

/** Image en `UniformToFill` (cover centré) dans une boîte : taille et position, dans la boîte. */
export function coverBox(srcW, srcH, boxW, boxH) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { width, height, left: (boxW - width) / 2, top: (boxH - height) / 2, scale };
}

/** Taille réduite pour tenir dans un espace sans déformer (Viewbox Uniform). */
export function fitScale(contentW, contentH, availW, availH) {
  if (!(contentW > 0 && contentH > 0 && availW > 0 && availH > 0)) return 0;
  return Math.min(availW / contentW, availH / contentH);
}

// Surface de l'accueil de la borne : 800 de haut, largeur à la proportion de l'écran (au moins 1200).
export const HOME_SURFACE_HEIGHT = 800;
const HOME_SURFACE_MIN_WIDTH = 1200;

export function homeSurfaceSize(screen) {
  return {
    width: Math.max(HOME_SURFACE_MIN_WIDTH, (HOME_SURFACE_HEIGHT * screen.width) / screen.height),
    height: HOME_SURFACE_HEIGHT,
  };
}

/**
 * Accueil du client sur un écran : surface (px de la surface), image 1920×1080 en cover et
 * bandes coupées en px de l'image (ce que l'écran ne montre pas).
 */
export function homeScreenGeometry(screen) {
  const surface = homeSurfaceSize(screen);
  const image = coverBox(HOME_FORMAT.exportWidth, HOME_FORMAT.exportHeight, surface.width, surface.height);
  const cutX = Math.max(0, -image.left) / image.scale;
  const cutY = Math.max(0, -image.top) / image.scale;
  return { surface, image, cut: { x: cutX, y: cutY } };
}

// Éléments de la borne posés sur l'accueil du client (HomeView.xaml), en px de la surface.
export const HOME_ELEMENTS = Object.freeze({
  pill: Object.freeze({ height: 76, paddingLeft: 28, paddingRight: 34, radius: 38, bottom: 56, dot: 14, dotGap: 16, fontSize: 24 }),
  tiles: Object.freeze({ width: 184, height: 156, bottom: 48, gap: 9, radius: 28, padding: 22 }),
  photos: Object.freeze({ right: 32, bottom: 40, height: 56, paddingLeft: 18, paddingRight: 24, fontSize: 18, icon: 22 }),
  lock: Object.freeze({ margin: 24, size: 56, icon: 24, opacity: 0.7 }),
  buttonRadius: 24,
});

/** Pastille (un format) ou tuiles (plusieurs formats), comme ShowCustomStartPill / ShowCustomTiles. */
export function homeStartMode(tiles) {
  return Array.isArray(tiles) && tiles.length > 1 ? 'tiles' : 'pill';
}
