import { fabric } from 'fabric';

// Référence au _renderText prototype — capturée une fois au chargement du module
const ORIG_RENDER_TEXT = fabric.Text.prototype._renderText;

export const EFFECT_DEFS = [
  { id: 'none',    label: 'Aucun',      preview: {} },
  { id: 'shadow',  label: 'Ombre',      preview: { textShadow: '3px 4px 8px rgba(0,0,0,0.55)' } },
  { id: 'lift',    label: 'Levée',      preview: { textShadow: '3px 4px 0px rgba(0,0,0,0.75)' } },
  { id: 'outline', label: 'Contour',    preview: { WebkitTextStroke: '2px #ef4444', color: 'white' } },
  { id: 'echo',    label: 'Écho',       preview: { textShadow: '6px 6px 0 #6366f1, 3px 3px 0 #818cf8' } },
  { id: 'neon',    label: 'Néon',       preview: { textShadow: '0 0 8px #0ff, 0 0 18px #0ff', color: '#0ff', background: '#111' } },
  { id: 'glitch',  label: 'Glitch',     preview: { textShadow: '-4px 0 #f00, 4px 0 #0ff' } },
  { id: 'bevel',   label: 'Biseautage', preview: { textShadow: '-1px -1px 0 rgba(255,255,255,0.8), 2px 2px 2px rgba(0,0,0,0.5)' } },
];

export const EFFECT_DEFAULTS = {
  none:    {},
  shadow:  { color: '#000000', opacity: 0.65, blur: 10, offsetX: 5, offsetY: 5 },
  lift:    { color: '#000000', opacity: 0.8,  offsetX: 6, offsetY: 6 },
  outline: { color: '#ef4444', width: 2 },
  echo:    { color: '#6366f1', offsetX: 8, offsetY: 8 },
  neon:    { color: '#00ffcc' },
  glitch:  { offset: 6 },
  bevel:   { depth: 4, lightColor: '#ffffff', shadowColor: '#334155' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgba(hex, opacity = 1) {
  if (!hex || !hex.startsWith('#')) return `rgba(0,0,0,${opacity})`;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function resetOverrides(obj) {
  if (Object.prototype.hasOwnProperty.call(obj, '_renderText')) delete obj._renderText;
  // Utiliser obj.set() pour que Fabric marque l'objet dirty → re-render immédiat
  obj.set({
    shadow:         null,
    stroke:         null,
    strokeWidth:    0,
    paintFirst:     'fill',
    objectCaching:  true,   // réactivé par défaut
  });
  obj.dirty = true;
}

// ── Main apply function ───────────────────────────────────────────────────────

export function applyTextEffect(obj) {
  if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;

  const type   = obj.textEffect   || 'none';
  const params = obj.textEffectParams || EFFECT_DEFAULTS[type] || {};

  resetOverrides(obj);
  if (type === 'none') return;

  // ── Ombre portée ─────────────────────────────────────────────────────────
  if (type === 'shadow') {
    const { color = '#000000', opacity = 0.65, blur = 10, offsetX = 5, offsetY = 5 } = params;
    obj.set('shadow', new fabric.Shadow({ color: hexToRgba(color, opacity), blur, offsetX, offsetY }));
    return;
  }

  // ── Levée (hard shadow) ───────────────────────────────────────────────────
  if (type === 'lift') {
    const { color = '#000000', opacity = 0.8, offsetX = 6, offsetY = 6 } = params;
    obj.set('shadow', new fabric.Shadow({ color: hexToRgba(color, opacity), blur: 0, offsetX, offsetY }));
    return;
  }

  // ── Contour ───────────────────────────────────────────────────────────────
  if (type === 'outline') {
    const { color = '#ef4444', width = 2 } = params;
    obj.set({ stroke: color, strokeWidth: width, paintFirst: 'stroke' });
    return;
  }

  // Pour les effets ci-dessous, on override _renderText et on DÉSACTIVE le cache Fabric
  // (objectCaching=true clipperait les ombres au bounding box du texte).
  obj.objectCaching = false;

  // ── Écho ─────────────────────────────────────────────────────────────────
  if (type === 'echo') {
    const { color = '#6366f1', offsetX = 8, offsetY = 8 } = params;
    obj._renderText = function(ctx) {
      const origFill  = this.fill;
      const origAlpha = ctx.globalAlpha;
      // Copies d'écho du plus lointain au plus proche
      for (let i = 3; i >= 1; i--) {
        const t = i / 3;
        ctx.globalAlpha = origAlpha * (0.2 + t * 0.3);
        this.fill = color;
        ctx.save();
        ctx.translate(offsetX * t, offsetY * t);
        ORIG_RENDER_TEXT.call(this, ctx);
        ctx.restore();
      }
      // Texte principal
      this.fill     = origFill;
      ctx.globalAlpha = origAlpha;
      ORIG_RENDER_TEXT.call(this, ctx);
    };
    return;
  }

  // ── Néon ──────────────────────────────────────────────────────────────────
  if (type === 'neon') {
    const { color = '#00ffcc' } = params;
    obj._renderText = function(ctx) {
      // Halo externe large
      ctx.shadowColor   = color;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur    = 40;
      ORIG_RENDER_TEXT.call(this, ctx);
      // Halo intermédiaire
      ctx.shadowBlur = 20;
      ORIG_RENDER_TEXT.call(this, ctx);
      // Core brillant
      ctx.shadowBlur = 8;
      ORIG_RENDER_TEXT.call(this, ctx);
      // Texte final sans ombre
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ORIG_RENDER_TEXT.call(this, ctx);
    };
    return;
  }

  // ── Glitch ────────────────────────────────────────────────────────────────
  if (type === 'glitch') {
    const { offset = 6 } = params;
    obj._renderText = function(ctx) {
      // Canal rouge décalé à droite
      ctx.shadowColor   = 'rgba(255,0,60,0.9)';
      ctx.shadowBlur    = 0;
      ctx.shadowOffsetX = offset;
      ctx.shadowOffsetY = 0;
      ORIG_RENDER_TEXT.call(this, ctx);
      // Canal cyan décalé à gauche
      ctx.shadowColor   = 'rgba(0,240,255,0.9)';
      ctx.shadowOffsetX = -offset;
      ORIG_RENDER_TEXT.call(this, ctx);
      // Texte central sans ombre
      ctx.shadowColor   = 'transparent';
      ctx.shadowBlur    = 0;
      ctx.shadowOffsetX = 0;
      ORIG_RENDER_TEXT.call(this, ctx);
    };
    return;
  }

  // ── Biseautage ────────────────────────────────────────────────────────────
  if (type === 'bevel') {
    const { depth = 4, lightColor = '#ffffff', shadowColor = '#334155' } = params;
    obj._renderText = function(ctx) {
      // Ombre sombre bas-droite
      ctx.shadowColor   = hexToRgba(shadowColor, 0.85);
      ctx.shadowBlur    = 2;
      ctx.shadowOffsetX = depth;
      ctx.shadowOffsetY = depth;
      ORIG_RENDER_TEXT.call(this, ctx);
      // Reflet lumineux haut-gauche
      ctx.shadowColor   = hexToRgba(lightColor, 0.9);
      ctx.shadowBlur    = 1;
      ctx.shadowOffsetX = -Math.max(1, depth * 0.6);
      ctx.shadowOffsetY = -Math.max(1, depth * 0.6);
      ORIG_RENDER_TEXT.call(this, ctx);
      // Texte principal propre
      ctx.shadowColor   = 'transparent';
      ctx.shadowBlur    = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ORIG_RENDER_TEXT.call(this, ctx);
    };
    return;
  }
}

/**
 * Ré-applique les effets sur tous les objets texte d'un canvas
 * (nécessaire après loadFromJSON / undo / redo car les overrides d'instance sont perdus).
 */
export function reapplyTextEffects(canvas) {
  canvas.getObjects().forEach((o) => {
    if (o.textEffect && o.textEffect !== 'none') applyTextEffect(o);
  });
}
