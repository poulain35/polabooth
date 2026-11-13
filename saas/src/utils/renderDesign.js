import { fabric } from 'fabric';
import { reapplyTextEffects } from './textEffects';
import { exportAsHighResPNG } from './export';
import { preloadCustomFonts } from '../lib/supabase';

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
    return new fabric.Gradient({
      type: 'radial',
      gradientUnits: 'pixels',
      coords: { r1: 0, r2: r, x1: width / 2, y1: height / 2, x2: width / 2, y2: height / 2 },
      colorStops: [{ offset: 0, color: color1 }, { offset: 1, color: color2 }],
    });
  }
  const c = GRADIENT_COORDS[direction] || GRADIENT_COORDS['to-b'];
  return new fabric.Gradient({
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
  const state = typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson;

  // Inject crossOrigin before load so remote images don't taint the canvas
  // (toDataURL would throw). The JSON reviver runs too late — the image has
  // already started loading without the flag.
  const objects = (state.objects ?? []).map((o) =>
    o.type === 'image' && typeof o.src === 'string' && o.src.startsWith('http')
      ? { ...o, crossOrigin: 'anonymous' }
      : o
  );

  // Register custom (uploaded) fonts as FontFaces first — otherwise document.fonts.load
  // below has no source for them and Fabric falls back to a default font at export.
  await preloadCustomFonts();

  // Pre-load referenced fonts so Fabric measures text with correct metrics.
  const textObjects = objects.filter((o) => o.type === 'i-text' || o.type === 'text');
  if (textObjects.length > 0) {
    const fontDescriptors = [...new Set(
      textObjects.flatMap((o) => {
        if (!o.fontFamily) return [];
        const style  = o.fontStyle === 'italic' ? 'italic ' : '';
        const weight = o.fontWeight || 400;
        return [`${style}${weight} 16px "${o.fontFamily}"`];
      })
    )];
    await Promise.allSettled(fontDescriptors.map((d) => document.fonts.load(d)));
  }

  const canvas = new fabric.StaticCanvas(null, {
    width: format.canvasWidth,
    height: format.canvasHeight,
    enableRetinaScaling: false,
  });

  try {
    await new Promise((resolve) => {
      canvas.loadFromJSON(
        { version: '5.3.0', objects, background: typeof state.bg === 'string' ? state.bg : '#ffffff' },
        () => {
          if (state.bgType === 'gradient' && state.bgGradient) {
            canvas.setBackgroundColor(
              buildFabricGradient({ width: format.canvasWidth, height: format.canvasHeight }, state.bgGradient),
              () => {}
            );
          } else {
            canvas.backgroundColor = state.bg || '#ffffff';
          }
          reapplyTextEffects(canvas);
          canvas.renderAll();
          resolve();
        }
      );
    });

    // Second render once the browser confirms all fonts are ready.
    await document.fonts.ready;
    canvas.renderAll();

    return await exportAsHighResPNG(canvas, format, options);
  } finally {
    canvas.dispose();
  }
}
