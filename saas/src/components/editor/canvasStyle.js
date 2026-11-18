// Réglages de Fabric pour l'éditeur, couleurs du canevas et zones photo (jamais exportées).
import { fabric } from 'fabric';
import { BLANK_TEMPLATE } from '../../templates/index';

// Fabric sérialise left/top/scaleX/scaleY avec NUM_FRACTION_DIGITS décimales (défaut 2).
// Avec 2 décimales, scaleX=1.0018 devient 1.00 → décalage de 1-3 px à la relecture.
// 6 décimales donnent une précision < 0.01 px canvas, largement suffisant.
fabric.Object.NUM_FRACTION_DIGITS = 6;

// ─── Global Fabric.js control style ──────────────────────────────────────────
Object.assign(fabric.Object.prototype, {
  borderColor:        '#3F51E0',
  borderScaleFactor:  1.5,
  cornerColor:        '#3F51E0',
  cornerStrokeColor:  '#ffffff',
  cornerSize:         10,
  cornerStyle:        'circle',
  transparentCorners: false,
  padding:            6,
});

// Padding (in canvas units) added around the upper canvas so selection handles
// remain visible when an object overflows the template boundary.
export const CANVAS_OVERFLOW_PAD = 100;
// Fond de la zone de travail autour du canevas : peint aussi par Fabric sur la marge ci-dessus, d'où une
// couleur fixe (le canevas ne lit pas les variables CSS). Jamais exportée.
export const CANVAS_WORKSPACE = '#F3F4F7';
// Repères de la borne (zone de sécurité, pastille, boutons) et fond de coupe : jamais exportés.
export const KIOSK_GUIDE_COLOR = '#0ea5e9';
export const BLEED_COLOR = '#ef4444';
// Fond d'un design sans couleur enregistrée : celui de la page blanche.
export const DEFAULT_BG_COLOR = BLANK_TEMPLATE.bgColor;

// ─── Couleurs d'accent du canevas ─────────────────────────────────────────────
// Bleu de la palette dans l'admin ; noyer dans l'éditeur du client (style du site, LAB-355). Les zones photo
// sont masquées à l'export : ces couleurs ne sont jamais imprimées.
export const ADMIN_CANVAS_ACCENT  = { accent: '#3F51E0', zoneFill: '#ECEFFE', zoneShape: '#CBD2FA', zoneLabel: '#3243C9' };
export const CLIENT_CANVAS_ACCENT = { accent: '#6A4128', zoneFill: '#F4EBDF', zoneShape: '#E4D3BE', zoneLabel: '#6A4128' };
let canvasAccent = ADMIN_CANVAS_ACCENT;
// Dégradé proposé par défaut pour le fond : pastels de la palette (ciel vers rose) dans l'admin,
// couleurs du site chez le client.
export const ADMIN_DEFAULT_GRADIENT  = { direction: 'to-b', color1: '#DCEEFB', color2: '#FCE0E8' };
export const CLIENT_DEFAULT_GRADIENT = { direction: 'to-b', color1: '#6A4128', color2: '#E4D3BE' };

export function setCanvasAccent(palette) {
  canvasAccent = palette;
  fabric.Object.prototype.borderColor = palette.accent;
  fabric.Object.prototype.cornerColor = palette.accent;
}

// ─── Fabric.js helpers ────────────────────────────────────────────────────────

export function applyPhotoZoneStyle(rect) {
  rect.set({ fill: 'transparent', stroke: 'transparent', strokeWidth: 0, strokeDashArray: [] });

  rect._render = function(ctx) {
    const w  = this.width;
    const h  = this.height;
    const hw = w / 2;
    const hh = h / 2;
    const sx = this.scaleX || 1;
    const sy = this.scaleY || 1;
    // Effective screen-space dimensions (for visibility thresholds & fixed-size elements)
    const sw = w * sx;
    const sh = h * sy;
    const minScreen = Math.min(sw, sh);

    // ── Background (local coords — scales naturally) ──
    ctx.fillStyle = canvasAccent.zoneFill;
    ctx.fillRect(-hw, -hh, w, h);

    // ── Person silhouette (local coords — scales with zone) ──
    if (minScreen >= 48) {
      const s = Math.min(w, h) * 0.35;
      ctx.fillStyle = canvasAccent.zoneShape;
      ctx.beginPath();
      ctx.arc(0, -s * 0.42, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, s * 0.28, s * 0.38, s * 0.45, 0, Math.PI, 0);
      ctx.fill();
    }

    // ── Label + border in screen-space so they stay legible at any scale ──
    ctx.save();
    ctx.scale(1 / sx, 1 / sy); // undo Fabric's scale → 1:1 screen pixels

    if (minScreen >= 56) {
      const fontSize = Math.min(13, Math.max(10, minScreen * 0.075));
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = canvasAccent.zoneLabel;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Zone photo', 0, sh / 2 - fontSize * 1.1);
    }

    ctx.strokeStyle = canvasAccent.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(-sw / 2 + 0.75, -sh / 2 + 0.75, sw - 1.5, sh - 1.5);
    ctx.setLineDash([]);

    ctx.restore();
  };
}

export function createPhotoZoneRect(zone) {
  const rect = new fabric.Rect({
    left: zone.x, top: zone.y, width: zone.w, height: zone.h,
    isPhotoZone: true,
    locked: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hasControls: false,
    hoverCursor: 'default',
    selectable: true,
    evented: true,
  });
  applyPhotoZoneStyle(rect);
  return rect;
}

export function addPhotoZones(canvas, format) {
  format.photoZones.forEach((zone) => {
    const rect = createPhotoZoneRect(zone);
    canvas.add(rect);
    canvas.sendToBack(rect);
  });
}
