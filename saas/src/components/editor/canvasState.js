// État du canvas : sérialisation (historique, sauvegarde, envoi), relecture et fonds en dégradé.
import { Gradient } from '../../lib/fabric.js';
import { isKioskFormat } from '../../utils/formats';
import { isTransparentBackground } from '../../lib/kioskScreenLayout';
import { loadLiveFont } from '../../utils/kioskFonts';
import { findPhotoZones } from '../../lib/photoZones';
import { reapplyTextEffects } from '../../utils/textEffects';
import { withCrossOrigin } from '../../lib/designImages';
import { loadFontsOf } from '../../lib/fontUsage';
import { DEFAULT_BG_COLOR, addPhotoZones, applyPhotoZoneStyle } from './canvasStyle';

const CUSTOM_PROPS = [
  'fontFamily', 'fontWeight', 'fontStyle', 'underline', 'overline', 'linethrough',
  'charSpacing', 'textAlign', 'originX', 'originY', 'rx', 'ry',
  'isPhotoZone', 'lockRotation', 'textTransform',
  'locked', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY',
  'hasControls', 'hoverCursor',
  'isSticker', 'stickerTintColor',
  'textEffect', 'textEffectParams',
  // Écrans de la borne (LAB-296) : bouton, texte vivant, emplacement, « personnalisé seulement ».
  'kioskAction', 'kioskVariable', 'kioskSlot', 'personalizedOnly',
];

// ─── Gradient helpers ─────────────────────────────────────────────────────────

const GRADIENT_COORDS = {
  'to-b':  { x1: 0,   y1: 0,   x2: 0,   y2: 1   },
  'to-r':  { x1: 0,   y1: 0,   x2: 1,   y2: 0   },
  'to-br': { x1: 0,   y1: 0,   x2: 1,   y2: 1   },
  'to-bl': { x1: 1,   y1: 0,   x2: 0,   y2: 1   },
};

function buildFabricGradient({ width, height }, { direction, color1, color2 }) {
  if (direction === 'radial') {
    const r = Math.max(width, height) / 2;
    return new Gradient({
      type: 'radial',
      gradientUnits: 'pixels',
      coords: {
        r1: 0,
        r2: r,
        x1: width / 2,
        y1: height / 2,
        x2: width / 2,
        y2: height / 2,
      },
      colorStops: [
        { offset: 0, color: color1 },
        { offset: 1, color: color2 },
      ],
    });
  }
  const c = GRADIENT_COORDS[direction] || GRADIENT_COORDS['to-b'];
  return new Gradient({
    type: 'linear',
    gradientUnits: 'pixels',
    coords: {
      x1: c.x1 * width,
      y1: c.y1 * height,
      x2: c.x2 * width,
      y2: c.y2 * height,
    },
    colorStops: [
      { offset: 0, color: color1 },
      { offset: 1, color: color2 },
    ],
  });
}

export function applyGradientToCanvas(canvas, grad, dims) {
  const fabricGrad = buildFabricGradient(dims, grad);
  canvas.backgroundColor = fabricGrad;
  canvas.renderAll();
}

export function serializeState(canvas, bgMeta) {
  return JSON.stringify({
    bg:         canvas.backgroundColor,
    bgType:     bgMeta?.bgType     ?? 'solid',
    bgGradient: bgMeta?.bgGradient ?? null,
    // _toObject : un objet d'une sélection multiple est enregistré à sa vraie place (toObject seul
    // le donnerait relatif à la sélection).
    objects:    canvas.getObjects().map((o) => canvas._toObject(o, 'toObject', CUSTOM_PROPS)),
  });
}

export async function restoreFromJSON(canvas, format, jsonStr) {
  const state = JSON.parse(jsonStr);
  // Injecter crossOrigin dans les données JSON avant chargement —
  // le reviver s'applique trop tard, l'image commence déjà à charger sans le flag.
  // Groupes et masques compris : leurs images sont aussi rangées dans le stockage (LAB-348).
  const objects = withCrossOrigin(state.objects);

  // Pre-load all fonts referenced in the JSON so Fabric gets correct metrics.
  // On hard refresh the browser cache is empty — without this step text renders
  // with a fallback font until the Google Font finishes downloading.
  // Textes des groupes compris : les boutons de la borne ont leur propre police (LAB-324).
  // Seules les polices du modèle sont téléchargées : les polices importées sont déclarées sans
  // être chargées (registerCustomFonts, LAB-347).
  // Textes vivants des écrans de la borne : la police à la graisse publiée, même hors de index.html (LAB-331).
  if (isKioskFormat(format)) {
    await Promise.all(objects.filter((o) => o?.kioskVariable).map((o) => loadLiveFont(o.fontFamily, o.fontWeight)));
  }
  await loadFontsOf(objects);

  // Écrans de la borne (LAB-296) : un fond transparent reste transparent (la borne pose l'image
  // de l'événement dessous, D8). Ailleurs, comportement inchangé : fond absent = blanc.
  const keepTransparent = isKioskFormat(format) && isTransparentBackground(state.bg);
  const bg = keepTransparent ? '' : (state.bg || DEFAULT_BG_COLOR);

  await canvas.loadFromJSON(
    { version: '5.3.0', objects, background: keepTransparent ? '' : (typeof state.bg === 'string' ? state.bg : DEFAULT_BG_COLOR) },
  );
  if (state.bgType === 'gradient' && state.bgGradient) {
    applyGradientToCanvas(canvas, state.bgGradient, { width: format.canvasWidth, height: format.canvasHeight });
  } else {
    canvas.backgroundColor = bg;
  }
  // Zones rangées dans un groupe comprises : sinon les zones par défaut seraient rajoutées en double.
  const zones = findPhotoZones(canvas.getObjects());
  if (zones.length === 0) addPhotoZones(canvas, format);
  else zones.forEach((o) => applyPhotoZoneStyle(o));
  reapplyTextEffects(canvas);
  canvas.renderAll();
  // Second render once the browser confirms ALL fonts are ready —
  // catches any font that was still in-flight when the first render ran.
  document.fonts.ready.then(() => {
    try { canvas.renderAll(); } catch (_) { /* canvas already disposed */ }
  });
  return { bgType: state.bgType ?? 'solid', bgGradient: state.bgGradient ?? null, bgColor: keepTransparent ? 'transparent' : (state.bg || DEFAULT_BG_COLOR) };
}
