import { Gradient, StaticCanvas } from '../lib/fabric.js';
import { reapplyTextEffects } from './textEffects';
import { exportAsHighResPNG, exportScreenParts } from './export';
import { kioskFormatByKind } from './formats';
import { ensureKioskFonts } from './kioskFonts';
import { registerCustomFonts } from '../lib/supabase';
import { loadFontsOf } from '../lib/fontUsage';
import { buildScreenLayoutFromState } from '../lib/kioskScreenLayout';
import { screenSourceFromParts } from '../lib/kioskDesignedScreen';
import { withCrossOrigin } from '../lib/designImages';

// Gradient helpers — mirror Editor.jsx so an offscreen render reproduces the
// same background as the live editor. Keep in sync if the editor's math changes.
const GRADIENT_COORDS = {
  'to-b':  { x1: 0, y1: 0, x2: 0, y2: 1 },
  'to-r':  { x1: 0, y1: 0, x2: 1, y2: 0 },
  'to-br': { x1: 0, y1: 0, x2: 1, y2: 1 },
  'to-bl': { x1: 1, y1: 0, x2: 0, y2: 1 },
};

function buildFabricGradient({ width, height }, { direction, color1, color2 }) {
  if (direction === 'radial') {
    const r = Math.max(width, height) / 2;
    return new Gradient({
      type: 'radial',
      gradientUnits: 'pixels',
      coords: { r1: 0, r2: r, x1: width / 2, y1: height / 2, x2: width / 2, y2: height / 2 },
      colorStops: [{ offset: 0, color: color1 }, { offset: 1, color: color2 }],
    });
  }
  const c = GRADIENT_COORDS[direction] || GRADIENT_COORDS['to-b'];
  return new Gradient({
    type: 'linear',
    gradientUnits: 'pixels',
    coords: { x1: c.x1 * width, y1: c.y1 * height, x2: c.x2 * width, y2: c.y2 * height },
    colorStops: [{ offset: 0, color: color1 }, { offset: 1, color: color2 }],
  });
}


/**
 * Re-renders a stored design (canvas_json) into an offscreen Fabric canvas and
 * exports it as a high-res PNG. Unlike the stored final_png_url — which is frozen
 * at submit time with transparent photo zones — this lets the caller pick the
 * `punchZones` mode (e.g. false for a "fond plein" export with the template
 * background showing through the photo areas).
 *
 * `canvasJson` accepts the serializeState shape { bg, bgType, bgGradient, objects },
 * either as an object (jsonb from Supabase) or a JSON string.
 */
export async function renderDesignToPng(canvasJson, format, options = {}) {
  return withOffscreenDesign(canvasJson, format, (canvas) => exportAsHighResPNG(canvas, format, options));
}

/**
 * Écran de la borne composé (LAB-309) rendu hors écran : un état d'éditeur (brouillon, modèle
 * d'origine) devient la source de l'aperçu « Écran composé », par le même découpage que la
 * publication (buildScreenLayoutFromState puis exportScreenParts). Null si la borne refuserait
 * le plan (elle afficherait alors son écran standard).
 */
export async function renderScreenSource(canvasJson, kind) {
  const format = kioskFormatByKind(kind);
  const state = typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson;
  await ensureKioskFonts();
  return withOffscreenDesign(state, format, (canvas) => {
    const { layout, parts } = buildScreenLayoutFromState(state, kind, { canvasWidth: format.canvasWidth });
    return screenSourceFromParts(layout, exportScreenParts(canvas, format, parts));
  });
}

/** Charge un état d'éditeur dans un canvas Fabric hors écran, appelle `render(canvas)`, puis le libère. */
async function withOffscreenDesign(canvasJson, format, render) {
  const state = typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson;

  // Inject crossOrigin before load so remote images don't taint the canvas
  // (toDataURL would throw). The JSON reviver runs too late — the image has
  // already started loading without the flag. Groupes et masques compris : leurs images sont
  // aussi rangées dans le stockage (LAB-348).
  const objects = withCrossOrigin(state.objects);

  // Polices importées déclarées d'abord (sans téléchargement, LAB-347) : sinon document.fonts.load
  // n'a pas de source pour elles et Fabric exporte avec une police de secours.
  await registerCustomFonts().catch(() => {});

  // Puis seulement les polices des textes du modèle, groupes et zones de texte compris,
  // pour que Fabric mesure le texte avec les bonnes métriques.
  await loadFontsOf(objects);

  const canvas = new StaticCanvas(null, {
    width: format.canvasWidth,
    height: format.canvasHeight,
    enableRetinaScaling: false,
  });

  try {
    await canvas.loadFromJSON(
      { version: '5.3.0', objects, background: typeof state.bg === 'string' ? state.bg : '#ffffff' },
    );
    if (state.bgType === 'gradient' && state.bgGradient) {
      canvas.backgroundColor = buildFabricGradient(
        { width: format.canvasWidth, height: format.canvasHeight }, state.bgGradient,
      );
    } else {
      canvas.backgroundColor = state.bg || '#ffffff';
    }
    reapplyTextEffects(canvas);
    canvas.renderAll();

    // Second render once the browser confirms all fonts are ready.
    await document.fonts.ready;
    canvas.renderAll();

    return await render(canvas);
  } finally {
    canvas.dispose();
  }
}
