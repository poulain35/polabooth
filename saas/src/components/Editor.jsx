import { useRef, useEffect, useLayoutEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { fabric } from 'fabric';

// Fabric sérialise left/top/scaleX/scaleY avec NUM_FRACTION_DIGITS décimales (défaut 2).
// Avec 2 décimales, scaleX=1.0018 devient 1.00 → décalage de 1-3 px à la relecture.
// 6 décimales donnent une précision < 0.01 px canvas, largement suffisant.
fabric.Object.NUM_FRACTION_DIGITS = 6;

// ─── Global Fabric.js control style ──────────────────────────────────────────
Object.assign(fabric.Object.prototype, {
  borderColor:        '#6366f1',
  borderScaleFactor:  1.5,
  cornerColor:        '#6366f1',
  cornerStrokeColor:  '#ffffff',
  cornerSize:         10,
  cornerStyle:        'circle',
  transparentCorners: false,
  padding:            6,
});
import { Download, ChevronDown, Loader2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu';
import { Separator } from './ui/separator';
import Toolbar from './Toolbar';
import PropertiesPanel from './PropertiesPanel';
import TemplatesSidebar from './TemplatesSidebar';
import StickerPanel from './StickerPanel';
import AIBackgroundPanel from './AIBackgroundPanel';
import BatchImportModal from './BatchImportModal';
import { FORMATS } from '../utils/formats';
import { TEMPLATE_MAP } from '../templates/index';
import { exportAsHighResPNG, downloadPNG } from '../utils/export';
import { findPhotoZones } from '../lib/photoZones';
import { reapplyTextEffects } from '../utils/textEffects';
import { submitDesign, fetchDecorations, fetchDbTemplateById, preloadCustomFonts, removeImageBackground } from '../lib/supabase';
import BrandLogo from './BrandLogo';

// Padding (in canvas units) added around the upper canvas so selection handles
// remain visible when an object overflows the template boundary.
const CANVAS_OVERFLOW_PAD = 100;

// ─── Fabric.js helpers ────────────────────────────────────────────────────────

function applyPhotoZoneStyle(rect) {
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
    ctx.fillStyle = '#eef2ff';
    ctx.fillRect(-hw, -hh, w, h);

    // ── Person silhouette (local coords — scales with zone) ──
    if (minScreen >= 48) {
      const s = Math.min(w, h) * 0.35;
      ctx.fillStyle = '#c7d2fe';
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
      ctx.fillStyle = '#818cf8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Zone photo', 0, sh / 2 - fontSize * 1.1);
    }

    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(-sw / 2 + 0.75, -sh / 2 + 0.75, sw - 1.5, sh - 1.5);
    ctx.setLineDash([]);

    ctx.restore();
  };
}

function createPhotoZoneRect(zone) {
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

function addPhotoZones(canvas, format) {
  format.photoZones.forEach((zone) => {
    const rect = createPhotoZoneRect(zone);
    canvas.add(rect);
    canvas.sendToBack(rect);
  });
}

const CUSTOM_PROPS = [
  'fontFamily', 'fontWeight', 'fontStyle', 'underline', 'overline', 'linethrough',
  'charSpacing', 'textAlign', 'originX', 'originY', 'rx', 'ry',
  'isPhotoZone', 'lockRotation', 'textTransform',
  'locked', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY',
  'hasControls', 'hoverCursor',
  'isSticker', 'stickerTintColor',
  'textEffect', 'textEffectParams',
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
    return new fabric.Gradient({
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
  return new fabric.Gradient({
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

function applyGradientToCanvas(canvas, grad, dims) {
  const fabricGrad = buildFabricGradient(dims, grad);
  canvas.setBackgroundColor(fabricGrad, () => canvas.renderAll());
}

// Convertit un SVG (string) en data URL PNG via un canvas offscreen.
// Évite de charger le SVG comme milliers d'objets Fabric.js (lent sur les gros fichiers).
function svgToBitmap(svgString, maxPx = 3600) {
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

function serializeState(canvas, bgMeta) {
  return JSON.stringify({
    bg:         canvas.backgroundColor,
    bgType:     bgMeta?.bgType     ?? 'solid',
    bgGradient: bgMeta?.bgGradient ?? null,
    objects:    canvas.getObjects().map((o) => o.toObject(CUSTOM_PROPS)),
  });
}

async function restoreFromJSON(canvas, format, jsonStr) {
  const state = JSON.parse(jsonStr);
  // Injecter crossOrigin dans les données JSON avant chargement —
  // le reviver s'applique trop tard, l'image commence déjà à charger sans le flag.
  const objects = (state.objects ?? []).map((o) =>
    o.type === 'image' && typeof o.src === 'string' && o.src.startsWith('http')
      ? { ...o, crossOrigin: 'anonymous' }
      : o
  );

  // Pre-load all fonts referenced in the JSON so Fabric gets correct metrics.
  // On hard refresh the browser cache is empty — without this step text renders
  // with a fallback font until the Google Font finishes downloading.
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

  return new Promise((resolve) => {
    canvas.loadFromJSON(
      { version: '5.3.0', objects, background: typeof state.bg === 'string' ? state.bg : '#ffffff' },
      () => {
        if (state.bgType === 'gradient' && state.bgGradient) {
          applyGradientToCanvas(canvas, state.bgGradient, { width: format.canvasWidth, height: format.canvasHeight });
        } else {
          canvas.backgroundColor = state.bg || '#ffffff';
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
        resolve({ bgType: state.bgType ?? 'solid', bgGradient: state.bgGradient ?? null, bgColor: state.bg || '#ffffff' });
      }
    );
  });
}

// ─── Welcome card (première visite client) ────────────────────────────────────

// (WELCOME_KEY supprimé — la card se base désormais sur l'absence de design existant)

function WelcomeCard({ onClose }) {
  const steps = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
        </svg>
      ),
      title: 'Choisissez un modèle',
      desc: 'Le panneau Modèles est déjà ouvert — parcourez les exemples ou partez d\'une page blanche.',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
      title: 'Personnalisez votre design',
      desc: 'Ajoutez du texte (police, taille, couleur), vos propres images et des stickers.',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      title: 'Les zones photo sont réservées',
      desc: 'Les cadres en pointillés seront remplis avec vos photos le jour J — ne les supprimez pas.',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: 'Validez quand vous êtes prêt',
      desc: 'Cliquez sur "Valider" pour nous envoyer votre design. Vous pouvez sauvegarder et revenir autant de fois que vous voulez.',
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-md mx-auto overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-br from-primary to-violet-600 px-6 pt-6 pb-8">
          <div className="mb-4"><BrandLogo className="h-7 w-auto brightness-0 invert" textClassName="text-lg font-semibold text-white" /></div>
          <h2 className="text-xl font-bold text-white leading-snug">
            Bienvenue dans l'éditeur&nbsp;!
          </h2>
          <p className="text-primary/20 text-sm mt-1">
            Créez votre design en quelques minutes.
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                {step.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-3 bg-primary hover:bg-primary text-white text-sm font-semibold
              rounded-xl transition-colors shadow-sm shadow-primary/20"
          >
            C'est parti !
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function ConfirmModal({ pending, onConfirm, onCancel }) {
  if (!pending) return null;
  const { template, format } = pending;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-80 mx-4">
        <h3 className="font-semibold text-gray-900 mb-2">Remplacer le modèle ?</h3>
        <p className="text-sm text-gray-500 mb-5">
          Votre mise en page actuelle sera écrasée par le modèle{' '}
          <span className="font-medium text-gray-800">« {template.name} »</span>.
          {format.id !== pending.currentFormatId && (
            <> Le format passera à <span className="font-medium text-gray-800">{format.label}</span>.</>
          )}
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Annuler
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary transition-colors shadow-sm">
            Oui, remplacer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function CMenuItem({ label, icon, onClick, danger, kbd }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`flex items-center justify-between gap-2 w-full px-3 py-1.5 text-sm transition-colors rounded-md
        ${danger ? 'text-destructive hover:bg-destructive/10' : 'text-gray-700 hover:bg-primary/10 hover:text-primary'}`}
    >
      <span className="flex items-center gap-2.5">
        {icon && (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        )}
        {label}
      </span>
      {kbd && <span className="text-[10px] text-gray-400 shrink-0">{kbd}</span>}
    </button>
  );
}

function CMSubmenu({ label, icon, children }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  function show() { clearTimeout(timerRef.current); setOpen(true); }
  function scheduleHide() { timerRef.current = setTimeout(() => setOpen(false), 250); }

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center justify-between w-full px-3 py-1.5 text-sm text-gray-700
          hover:bg-primary/10 hover:text-primary transition-colors rounded-md"
      >
        <span className="flex items-center gap-2.5">
          {icon && (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
          )}
          {label}
        </span>
        <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-full top-0 -ml-px bg-card border border-gray-200
            rounded-xl shadow-2xl py-1.5 min-w-[190px] z-10"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function CMDivider() { return <Separator className="my-1" />; }

function ContextMenu({ pos: initialPos, onClose, actions }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999 }); // hidden until measured

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    let x = initialPos.x;
    let y = initialPos.y;
    if (x + width  > window.innerWidth)  x = Math.max(0, x - width);
    if (y + height > window.innerHeight) y = Math.max(0, y - height);
    setPos({ x, y });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { onCopy, onPaste, hasPaste, isPhotoZone,
          onDuplicate, onToggleLock, isLocked,
          onBringToFront, onBringForward, onSendBackward, onSendToBack,
          onAlignLeft, onAlignCenterH, onAlignRight,
          onAlignTop,  onAlignCenterV, onAlignBottom,
          onDelete } = actions;

  function run(fn) { fn?.(); onClose(); }

  return (
    <div
      ref={menuRef}
      className="fixed z-[60] bg-card border border-gray-200 rounded-xl shadow-2xl p-1.5 min-w-[210px]"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!isPhotoZone && (
        <CMenuItem label="Copier"    icon="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" kbd="Ctrl+C" onClick={() => run(onCopy)} />
      )}
      <CMenuItem label="Coller"    icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" kbd="Ctrl+V" onClick={() => run(onPaste)} danger={!hasPaste} />
      {!isPhotoZone && (
        <CMenuItem label="Dupliquer" icon="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" kbd="Ctrl+D" onClick={() => run(onDuplicate)} />
      )}

      <CMDivider />

      <CMenuItem
        label={isLocked ? 'Déverrouiller' : 'Verrouiller'}
        icon={isLocked
          ? 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
          : 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z'}
        onClick={() => run(onToggleLock)}
      />

      <CMDivider />

      <CMSubmenu label="Calques" icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10">
        <CMenuItem label="Premier plan"        icon="M5 11l7-7 7 7M5 19l7-7 7 7" onClick={() => run(onBringToFront)} />
        <CMenuItem label="Avancer d'un niveau" icon="M5 15l7-7 7 7"              onClick={() => run(onBringForward)} />
        <CMenuItem label="Reculer d'un niveau" icon="M19 9l-7 7-7-7"             onClick={() => run(onSendBackward)} />
        <CMenuItem label="Arrière-plan"        icon="M19 9l-7 7-7-7M19 17l-7 7-7-7" onClick={() => run(onSendToBack)} />
      </CMSubmenu>

      <CMSubmenu label="Aligner" icon="M4 6h16M4 12h16M4 18h16">
        <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Horizontal</p>
        <CMenuItem label="Gauche"  icon="M4 6h16M4 12h8M4 18h12"  onClick={() => run(onAlignLeft)} />
        <CMenuItem label="Centre"  icon="M4 6h16M8 12h8M6 18h12"  onClick={() => run(onAlignCenterH)} />
        <CMenuItem label="Droite"  icon="M4 6h16M12 12h8M8 18h12" onClick={() => run(onAlignRight)} />
        <CMDivider />
        <p className="px-3 pt-0.5 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Vertical</p>
        <CMenuItem label="Haut"    icon="M5 3h14M12 21V7"          onClick={() => run(onAlignTop)} />
        <CMenuItem label="Centre"  icon="M12 3v18M3 12h18"         onClick={() => run(onAlignCenterV)} />
        <CMenuItem label="Bas"     icon="M5 21h14M12 3v14"         onClick={() => run(onAlignBottom)} />
      </CMSubmenu>

      <CMDivider />

      <CMenuItem label="Effacer" danger
        icon="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        onClick={() => run(onDelete)} />
    </div>
  );
}

// ─── Floating object toolbar (mobile, Canva-style) ────────────────────────────

function FTBtn({ d, label, onClick, danger, active }) {
  return (
    <button onClick={onClick} title={label}
      className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors
        ${danger ? 'text-destructive/70 hover:bg-destructive/10 hover:text-destructive'
        : active ? 'text-amber-500 bg-amber-50'
        :          'text-gray-600 hover:bg-primary/10 hover:text-primary'}`}>
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </button>
  );
}

function FloatingObjectToolbar({ obj, version, cssZoom, canvasDivRef, onDelete, onDuplicate, onToggleLock, onOpenProperties }) {
  const ref = useRef(null);
  const [style, setStyle] = useState({ visibility: 'hidden', position: 'fixed', zIndex: 55 });

  useLayoutEffect(() => {
    const hidden = { visibility: 'hidden', position: 'fixed', zIndex: 55 };
    if (!obj || !canvasDivRef.current) { setStyle(hidden); return; }
    if ((obj.type === 'i-text' || obj.type === 'text') && obj.isEditing) { setStyle(hidden); return; }

    // canvasDivRef pointe sur le div CSS-transform (scale(cssZoom), transform-origin: top left)
    // Sa BCR donne le coin haut-gauche en coordonnées viewport après le scale
    const cr = canvasDivRef.current.getBoundingClientRect();

    const br = obj.getBoundingRect(true); // coordonnées canvas (Fabric zoom = 1)

    const centerX = cr.left + (br.left + br.width  / 2) * cssZoom;
    const topY    = cr.top  +  br.top                   * cssZoom;
    const botY    = cr.top  + (br.top + br.height)      * cssZoom;

    const toolbarH = ref.current?.offsetHeight ?? 48;
    const toolbarW = ref.current?.offsetWidth  ?? 220;
    // 56px = padding Fabric (6) + demi-coin (5) + rotatingPointOffset (40) + marge visuelle (5)
    const MARGIN   = 56;

    let top = topY - toolbarH - MARGIN;
    if (top < 56) top = botY + MARGIN;

    const left = Math.max(toolbarW / 2 + 4, Math.min(window.innerWidth - toolbarW / 2 - 4, centerX));

    setStyle({ visibility: 'visible', position: 'fixed', zIndex: 55, top, left, transform: 'translateX(-50%)' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, version, cssZoom]);

  if (!obj) return null;

  return (
    <div
      ref={ref}
      style={style}
      className="md:hidden flex items-center bg-card border border-gray-200 rounded-2xl shadow-xl px-1 py-1 gap-0.5"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <FTBtn
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        label="Modifier" onClick={onOpenProperties}
      />
      <Separator orientation="vertical" className="h-6 mx-0.5" />
      {!obj.isPhotoZone && (
        <FTBtn
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          label="Dupliquer" onClick={onDuplicate}
        />
      )}
      <FTBtn
        d={obj.locked
          ? 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
          : 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z'}
        label={obj.locked ? 'Déverrouiller' : 'Verrouiller'}
        onClick={onToggleLock}
        active={!!obj.locked}
      />
      <Separator orientation="vertical" className="h-6 mx-0.5" />
      <FTBtn
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        label="Supprimer" onClick={onDelete} danger
      />
    </div>
  );
}

// ─── Snap guide dimension label ──────────────────────────────────────────────

function DimPill({ x, y, value }) {
  const text = String(value);
  const w = Math.max(26, text.length * 5.5 + 12);
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-8} width={w} height={16} rx={4} fill="#6366f1" />
      <text
        textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={9} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >{text}</text>
    </g>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────

const Editor = forwardRef(function Editor({
  eventCode        = null,
  initialFormat    = null,
  initialCanvasJson = null,
  initialTemplate  = null,  // admin: pre-load a DB template { id, name, canvas_json }
  onSubmitSuccess  = null,
  onSaveTemplate   = null,  // admin only: ({ name, canvasJson, previewUrl, formatId }) => Promise
  onSaveRequest    = null,  // client: () => void — ouvre la modale de sauvegarde dans EditorPage
  onDirtyChange    = null,  // client: (isDirty: boolean) => void
  onHistoryOpen    = null,  // client: () => void — ouvre le panneau historique
  formatBleedOverrides = {}, // { [formatId]: bleedMm } — surcharge admin par format
  aiVisuals        = true,  // fonctionnalité ai_visuals : détourage et fond généré
} = {}, ref) {
  const isClientMode = Boolean(eventCode);

  const [currentFormat,   setCurrentFormat]   = useState(initialFormat ?? FORMATS.portrait);
  const [currentTemplate, setCurrentTemplate] = useState(initialTemplate ?? TEMPLATE_MAP.blank);
  const [activePanel,     setActivePanel]     = useState(
    isClientMode && !initialCanvasJson ? 'templates' : null
  );
  // Afficher la card d'accueil si le client n'a pas encore de design sauvegardé pour cet événement
  const [showWelcome, setShowWelcome] = useState(
    () => isClientMode && !initialCanvasJson
  );
  const [pendingChange,   setPendingChange]   = useState(null);
  const [decorations,     setDecorations]     = useState(null); // null = chargement

  // Chargement unique des décorations au montage du composant
  useEffect(() => {
    fetchDecorations().then(setDecorations).catch(() => setDecorations([]));
  }, []);

  // Submit state
  const [isSubmitting,      setIsSubmitting]      = useState(false);
  const [submitError,       setSubmitError]       = useState('');
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const [isSavingTemplate,  setIsSavingTemplate]  = useState(false);
  const [isSavingClient,    setIsSavingClient]    = useState(false);
  const [showBatchImport,   setShowBatchImport]   = useState(false);
  const [showPropertiesSheet, setShowPropertiesSheet] = useState(false);
  const [isRemovingBg,      setIsRemovingBg]      = useState(false);
  const [removeBgError,     setRemoveBgError]     = useState('');

  // Unsaved changes
  const [isDirty, setIsDirty] = useState(false);

  // Canvas refs
  const canvasElRef      = useRef(null);
  const fabricRef        = useRef(null);
  const historyRef       = useRef([]);
  const historyIdxRef    = useRef(-1);
  const isSavingRef      = useRef(false);
  const clipboardRef     = useRef(null);
  const initialLoadedRef = useRef(false); // true après le 1er chargement du design sauvegardé

  // Canvas-related state
  const [selectedObject, setSelectedObject] = useState(null); // actual Fabric object
  const [objectVersion,  setObjectVersion]  = useState(0);    // increments to trigger re-render
  const [bgColor,    setBgColor]    = useState(TEMPLATE_MAP.blank.bgColor || '#ffffff');
  const [bgType,     setBgType]     = useState('solid');
  const [bgGradient, setBgGradient] = useState({ direction: 'to-b', color1: '#6366f1', color2: '#8b5cf6' });
  const bgTypeRef     = useRef('solid');
  const bgGradientRef = useRef(null);
  const [canUndo,  setCanUndo]  = useState(false);
  const [canRedo,  setCanRedo]  = useState(false);
  const [isExporting,    setIsExporting]    = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [cssZoom,    setCssZoom]    = useState(1);  // CSS transform scale sur le wrapper canvas
  const cssZoomRef  = useRef(1);                    // mirror pour les handlers touch
  const fitScaleRef = useRef(1);                    // scale d'ajustement initial (mobile)
  const canvasAreaRef     = useRef(null); // zone scrollable (mesure largeur pour auto-fit)
  const canvasInnerDivRef = useRef(null); // div CSS-transform → utilisé pour positionner la toolbar flottante
  const pinchRef = useRef({ active: false, dist: 0, initZoom: 1 });

  // Snap guides & context menu
  const [snapGuides,  setSnapGuides]  = useState([]); // [{ type: 'h'|'v', pos: number }]
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const [snapGrid,    setSnapGrid]    = useState(false);
  const snapGridRef = useRef(false);

  // ── Close context menu on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [contextMenu]);

  // ── Recalcul du zoom quand le bottom sheet s'ouvre/ferme (mobile) ─────────────
  // La sheet prend 40 vh → le canvas visible au-dessus se réduit → on ré-ajuste le scale
  const SHEET_VH = 0.40; // doit correspondre au maxHeight du bottom sheet
  useEffect(() => {
    if (!canvasAreaRef.current || window.innerWidth >= 768) return;
    const fmt   = currentFormat;
    const PAD   = 8;
    const areaW = canvasAreaRef.current.clientWidth  - PAD * 2;
    const areaH = canvasAreaRef.current.clientHeight - PAD * 2;

    let newFit;
    if (showPropertiesSheet) {
      // La sheet couvre environ SHEET_VH * vh depuis le bas de la zone canvas
      const sheetH  = window.innerHeight * SHEET_VH;
      const availH  = Math.max(60, areaH - sheetH - 8); // 8px de marge au-dessus du sheet
      newFit = Math.min(1, areaW / (fmt.canvasWidth + CANVAS_OVERFLOW_PAD * 2), availH / (fmt.canvasHeight + CANVAS_OVERFLOW_PAD * 2));
    } else {
      newFit = Math.min(1, areaW / (fmt.canvasWidth + CANVAS_OVERFLOW_PAD * 2), Math.max(0.1, areaH / (fmt.canvasHeight + CANVAS_OVERFLOW_PAD * 2)));
    }
    fitScaleRef.current = newFit;
    cssZoomRef.current  = newFit;
    setCssZoom(newFit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPropertiesSheet, currentFormat.id]);

  // ── Canvas initialization ────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasElRef.current) return;

    const fmt = currentFormat;
    const tpl = currentTemplate;

    // Canvas agrandi : (W+2P)×(H+2P) + viewportTransform [1,0,0,1,P,P]
    // → les objets en coordonnées template (0..W, 0..H) s'affichent au centre
    // → les poignées dépassant du template restent visibles dans le gris
    const P = CANVAS_OVERFLOW_PAD;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width:  fmt.canvasWidth  + P * 2,
      height: fmt.canvasHeight + P * 2,
      backgroundColor: tpl?.bgColor || '#ffffff',
      preserveObjectStacking: true,
      selection: true,
    });
    fabricRef.current = canvas;

    // Décaler le rendu de P unités → (0,0) template = pixel (P,P) sur le canvas
    canvas.setViewportTransform([1, 0, 0, 1, P, P]);

    // Limiter le fond (backgroundColor) à la zone template uniquement,
    // laissant la zone de padding transparente (la couleur grise du parent div passe au travers).
    canvas._renderBackground = function(ctx) {
      if (!this.backgroundColor) return;
      if (this._exportMode) {
        // En mode export le canvas est redimensionné à W×H → rendu normal
        fabric.StaticCanvas.prototype._renderBackground.call(this, ctx);
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(P, P, fmt.canvasWidth, fmt.canvasHeight);
      ctx.clip();
      ctx.translate(P, P);
      fabric.StaticCanvas.prototype._renderBackground.call(this, ctx);
      ctx.restore();
    };

    // Masque gris sur le padding : les objets qui dépassent du template
    // sont couverts par le gris, mais les poignées restent visibles par-dessus.
    // drawControls est appelé après ctx.restore() du viewport → contexte en scale(dpr,dpr).
    const origDrawControls = canvas.drawControls.bind(canvas);
    canvas.drawControls = function(ctx) {
      if (!this._exportMode) {
        ctx.save();
        ctx.fillStyle = '#F3F4F7';
        const W = fmt.canvasWidth, H = fmt.canvasHeight;
        ctx.fillRect(0,     0,     W + P * 2, P);         // bande haute
        ctx.fillRect(0,     P + H, W + P * 2, P);         // bande basse
        ctx.fillRect(0,     P,     P,          H);          // bande gauche
        ctx.fillRect(P + W, P,     P,          H);          // bande droite
        ctx.restore();
      }
      origDrawControls(ctx);
    };

    setBgColor(tpl?.bgColor || '#ffffff');

    historyRef.current   = [];
    historyIdxRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setSelectedObject(null);
    setSnapGuides([]);

    // ── Selection events ──
    canvas.on('selection:created', () => setSelectedObject(canvas.getActiveObject() ?? null));
    canvas.on('selection:updated', () => setSelectedObject(canvas.getActiveObject() ?? null));
    canvas.on('selection:cleared', () => { setSelectedObject(null); setShowPropertiesSheet(false); });
    canvas.on('object:modified', () => saveHistorySnapshot(canvas));
    canvas.on('text:changed',    () => saveHistorySnapshot(canvas));
    canvas.on('text:editing:entered', () => setObjectVersion((v) => v + 1));
    canvas.on('text:editing:exited',  () => setObjectVersion((v) => v + 1));

    // ── Snap to grid + smart alignment guides ──
    canvas.on('object:moving', (e) => {
      const obj = e.target;
      if (!obj) return;

      if (snapGridRef.current) {
        const G = 20;
        obj.set({ left: Math.round(obj.left / G) * G, top: Math.round(obj.top / G) * G });
        setSnapGuides([]);
        return;
      }

      const SNAP = 8;
      const cw = fmt.canvasWidth, ch = fmt.canvasHeight;
      const cp = obj.getCenterPoint();
      const br = obj.getBoundingRect(true);
      const halfW = br.width / 2;
      const halfH = br.height / 2;

      const guides = [];
      let ncx = cp.x, ncy = cp.y;
      let snappedX = false, snappedY = false;

      // ── Snap to canvas center ──
      if (Math.abs(cp.x - cw / 2) < SNAP) { ncx = cw / 2; snappedX = true; guides.push({ type: 'v', pos: cw / 2 }); }
      if (Math.abs(cp.y - ch / 2) < SNAP) { ncy = ch / 2; snappedY = true; guides.push({ type: 'h', pos: ch / 2 }); }

      // ── Snap to canvas edges ──
      if (!snappedX) {
        if (Math.abs(cp.x - halfW) < SNAP)        { ncx = halfW;       snappedX = true; guides.push({ type: 'v', pos: 0  }); }
        else if (Math.abs(cp.x + halfW - cw) < SNAP) { ncx = cw - halfW; snappedX = true; guides.push({ type: 'v', pos: cw }); }
      }
      if (!snappedY) {
        if (Math.abs(cp.y - halfH) < SNAP)        { ncy = halfH;       snappedY = true; guides.push({ type: 'h', pos: 0  }); }
        else if (Math.abs(cp.y + halfH - ch) < SNAP) { ncy = ch - halfH; snappedY = true; guides.push({ type: 'h', pos: ch }); }
      }

      // ── Snap to other objects ──
      if (!snappedX || !snappedY) {
        const others = canvas.getObjects().filter((o) => o !== obj && (obj.isPhotoZone || !o.isPhotoZone));
        for (const other of others) {
          const ocp = other.getCenterPoint();
          const obr = other.getBoundingRect(true);
          const oHalfW = obr.width / 2;
          const oHalfH = obr.height / 2;

          if (!snappedX) {
            if      (Math.abs(cp.x - ocp.x) < SNAP)                         { ncx = ocp.x;                  snappedX = true; guides.push({ type: 'v', pos: ocp.x }); }
            else if (Math.abs((cp.x - halfW) - (ocp.x - oHalfW)) < SNAP)   { ncx = ocp.x - oHalfW + halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x - oHalfW }); }
            else if (Math.abs((cp.x + halfW) - (ocp.x + oHalfW)) < SNAP)   { ncx = ocp.x + oHalfW - halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x + oHalfW }); }
            else if (Math.abs((cp.x - halfW) - (ocp.x + oHalfW)) < SNAP)   { ncx = ocp.x + oHalfW + halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x + oHalfW }); }
            else if (Math.abs((cp.x + halfW) - (ocp.x - oHalfW)) < SNAP)   { ncx = ocp.x - oHalfW - halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x - oHalfW }); }
          }
          if (!snappedY) {
            if      (Math.abs(cp.y - ocp.y) < SNAP)                         { ncy = ocp.y;                  snappedY = true; guides.push({ type: 'h', pos: ocp.y }); }
            else if (Math.abs((cp.y - halfH) - (ocp.y - oHalfH)) < SNAP)   { ncy = ocp.y - oHalfH + halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y - oHalfH }); }
            else if (Math.abs((cp.y + halfH) - (ocp.y + oHalfH)) < SNAP)   { ncy = ocp.y + oHalfH - halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y + oHalfH }); }
            else if (Math.abs((cp.y - halfH) - (ocp.y + oHalfH)) < SNAP)   { ncy = ocp.y + oHalfH + halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y + oHalfH }); }
            else if (Math.abs((cp.y + halfH) - (ocp.y - oHalfH)) < SNAP)   { ncy = ocp.y - oHalfH - halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y - oHalfH }); }
          }
          if (snappedX && snappedY) break;
        }
      }

      if (snappedX || snappedY) obj.setPositionByOrigin(new fabric.Point(ncx, ncy), 'center', 'center');
      setSnapGuides(guides);
    });
    canvas.on('mouse:up', () => setSnapGuides([]));

    // ── Delete + Arrow keys ──
    const handleKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = canvas.getActiveObject();
        if (active && !(active.type === 'i-text' && active.isEditing)) {
          canvas.remove(active);
          setSelectedObject(null);
          canvas.renderAll();
          saveHistorySnapshot(canvas);
        }
        return;
      }

      const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (arrows.includes(e.key)) {
        const active = canvas.getActiveObject();
        if (!active || (active.type === 'i-text' && active.isEditing)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft')  active.set('left', active.left - step);
        if (e.key === 'ArrowRight') active.set('left', active.left + step);
        if (e.key === 'ArrowUp')    active.set('top',  active.top  - step);
        if (e.key === 'ArrowDown')  active.set('top',  active.top  + step);
        active.setCoords();
        canvas.renderAll();
        setObjectVersion((v) => v + 1);
        saveHistorySnapshot(canvas);
      }
    };
    window.addEventListener('keydown', handleKey);

    // ── Canvas content init (async for DB templates) ──
    let active = true;
    isSavingRef.current = true;

    async function initContent() {
      // Pré-charger les polices custom AVANT de restaurer le JSON pour éviter
      // que Fabric rende le texte avec la police de secours du navigateur.
      await preloadCustomFonts();

      // Priorité 1 : design sauvegardé du client (1er chargement uniquement)
      const savedJson = !initialLoadedRef.current && initialCanvasJson
        ? (typeof initialCanvasJson === 'string' ? initialCanvasJson : JSON.stringify(initialCanvasJson))
        : null;

      if (savedJson) {
        initialLoadedRef.current = true;
        const meta = await restoreFromJSON(canvas, fmt, savedJson);
        if (active) {
          setBgColor(meta.bgColor || '#ffffff');
          setBgType(meta.bgType || 'solid');
          setBgGradient(meta.bgGradient || { direction: 'to-b', color1: '#6366f1', color2: '#8b5cf6' });
          bgTypeRef.current = meta.bgType || 'solid';
          bgGradientRef.current = meta.bgGradient || null;
        }
      } else if (tpl?.canvas_json) {
        // Priorité 2 : template admin (DB)
        initialLoadedRef.current = true;
        const jsonStr = typeof tpl.canvas_json === 'string'
          ? tpl.canvas_json
          : JSON.stringify(tpl.canvas_json);
        const meta = await restoreFromJSON(canvas, fmt, jsonStr);
        if (active) {
          setBgColor(meta.bgColor || '#ffffff');
          setBgType(meta.bgType || 'solid');
          setBgGradient(meta.bgGradient || { direction: 'to-b', color1: '#6366f1', color2: '#8b5cf6' });
          bgTypeRef.current = meta.bgType || 'solid';
          bgGradientRef.current = meta.bgGradient || null;
        }
      } else {
        // Priorité 3 : canvas vierge avec zones photo
        if (tpl?.apply) tpl.apply(canvas, fmt, fabric);
        addPhotoZones(canvas, fmt);
        canvas.renderAll();
      }
      if (!active) return;
      // Auto-fit via CSS transform (Fabric zoom reste à 1 → coordonnées exactes)
      if (canvasAreaRef.current) {
        const isMobile = window.innerWidth < 768;
        const PAD = isMobile ? 8 : 64; // p-2 mobile / p-8 desktop
        const areaW = canvasAreaRef.current.clientWidth  - PAD * 2;
        const areaH = canvasAreaRef.current.clientHeight - PAD * 2;
        const fitScale = Math.min(1, areaW / (fmt.canvasWidth + CANVAS_OVERFLOW_PAD * 2), Math.max(0.1, areaH / (fmt.canvasHeight + CANVAS_OVERFLOW_PAD * 2)));
        fitScaleRef.current  = fitScale;
        cssZoomRef.current   = fitScale;
        setCssZoom(fitScale);
      } else {
        fitScaleRef.current = 1;
        cssZoomRef.current  = 1;
        setCssZoom(1);
      }
      isSavingRef.current = false;
      saveHistorySnapshot(canvas);
    }
    initContent();

    return () => {
      active = false;
      window.removeEventListener('keydown', handleKey);
      canvas.dispose();
      fabricRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat.id, currentTemplate.id]);

  // ── History ──────────────────────────────────────────────────────────────────
  function saveHistorySnapshot(canvas) {
    if (isSavingRef.current) return;
    const json = serializeState(canvas, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current });
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(json);
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
    markDirty();
  }

  const undo = useCallback(async () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    isSavingRef.current = true;
    const meta = await restoreFromJSON(fabricRef.current, currentFormat, historyRef.current[historyIdxRef.current]);
    isSavingRef.current = false;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
    setSelectedObject(null);
    setBgColor(meta.bgColor || '#ffffff');
    setBgType(meta.bgType || 'solid');
    setBgGradient(meta.bgGradient || { direction: 'to-b', color1: '#6366f1', color2: '#8b5cf6' });
    bgTypeRef.current = meta.bgType || 'solid';
    bgGradientRef.current = meta.bgGradient || null;
  }, [currentFormat]);

  const redo = useCallback(async () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    isSavingRef.current = true;
    const meta = await restoreFromJSON(fabricRef.current, currentFormat, historyRef.current[historyIdxRef.current]);
    isSavingRef.current = false;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
    setSelectedObject(null);
    setBgColor(meta.bgColor || '#ffffff');
    setBgType(meta.bgType || 'solid');
    setBgGradient(meta.bgGradient || { direction: 'to-b', color1: '#6366f1', color2: '#8b5cf6' });
    bgTypeRef.current = meta.bgType || 'solid';
    bgGradientRef.current = meta.bgGradient || null;
  }, [currentFormat]);

  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey)                    { e.preventDefault(); undo(); }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))){ e.preventDefault(); redo(); }
      if (mod && e.key === 'c')                                    { e.preventDefault(); copyObject(); }
      if (mod && e.key === 'v')                                    { e.preventDefault(); pasteObject(); }
      if (mod && e.key === 'd')                                    { e.preventDefault(); duplicateObject(); }
      if (mod && e.key === 'g' && !e.shiftKey)                    { e.preventDefault(); groupSelected(); }
      if (mod && e.key === 'g' && e.shiftKey)                     { e.preventDefault(); ungroupSelected(); }
      if (mod && e.key === '0')                                    { e.preventDefault(); resetCanvasZoom(); }
      if (mod && (e.key === '=' || e.key === '+'))                 { e.preventDefault(); zoomIn(); }
      if (mod && e.key === '-')                                    { e.preventDefault(); zoomOut(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo]);

  // ── Template selection ───────────────────────────────────────────────────────
  async function handleSelectTemplate(template, format) {
    let tpl = template;
    if (!tpl.canvas_json) {
      try { tpl = await fetchDbTemplateById(tpl.id); }
      catch { return; }
    }
    setPendingChange({ template: tpl, format, currentFormatId: currentFormat.id });
  }
  function confirmReplaceTemplate() {
    if (!pendingChange) return;
    setCurrentFormat(pendingChange.format);
    setCurrentTemplate(pendingChange.template);
    setPendingChange(null);
  }
  function cancelReplaceTemplate() { setPendingChange(null); }

  // ── Add elements ─────────────────────────────────────────────────────────────
  // isSavingRef=true during canvas mutations to block any spurious object:modified
  // events fired internally by Fabric, then one explicit snapshot is saved.

  function addObjectToCanvas(obj) {
    const canvas = fabricRef.current;
    isSavingRef.current = true;
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    isSavingRef.current = false;
    setSelectedObject(obj);
    saveHistorySnapshot(canvas);

    // Re-sync bounding box after the browser has rendered with the real font
    if (obj.type === 'i-text' || obj.type === 'text') {
      requestAnimationFrame(() => {
        if (!fabricRef.current) return;
        obj.initDimensions?.();
        obj.setCoords();
        fabricRef.current.renderAll();
      });
    }
  }

  async function addText() {
    const W = currentFormat.canvasWidth;
    const fontSize = W < 300 ? 12 : 20;
    const fontFamily = 'Montserrat';
    // Wait for the font to be loaded before creating the object
    // so Fabric calculates dimensions with the real font metrics
    try { await document.fonts.load(`${fontSize}px "${fontFamily}"`); } catch (_) { /* ignore */ }
    addObjectToCanvas(new fabric.IText('Votre texte', {
      left: W / 2,
      top: currentFormat.canvasHeight / 2,
      fontFamily,
      fontSize,
      fill: '#1e293b',
      textAlign: 'center',
      originX: 'center',
      originY: 'center',
    }));
  }

  function addRect() {
    addObjectToCanvas(new fabric.Rect({
      left: 50, top: 50,
      width: Math.min(120, currentFormat.canvasWidth * 0.3),
      height: Math.min(80, currentFormat.canvasHeight * 0.15),
      fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1,
    }));
  }

  function addCircle() {
    addObjectToCanvas(new fabric.Circle({
      left: 50, top: 50,
      radius: Math.min(50, currentFormat.canvasWidth * 0.12),
      fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1,
    }));
  }

  function addLine() {
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    addObjectToCanvas(new fabric.Line([W * 0.1, H * 0.5, W * 0.9, H * 0.5], {
      stroke: '#334155', strokeWidth: 1.5,
    }));
  }

  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imgEl = new Image();
      imgEl.onload = () => {
        const fabricImg = new fabric.Image(imgEl, { left: 50, top: 50 });
        const maxW = currentFormat.canvasWidth * 0.6;
        if (fabricImg.width > maxW) fabricImg.scaleToWidth(maxW);
        addObjectToCanvas(fabricImg);
      };
      imgEl.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ── Save template for all 4 formats (admin, AI backgrounds) ─────────────────
  async function handleSaveAllFormats(templateName, backgrounds) {
    if (!onSaveTemplate) return;

    // Dimensions de génération (doivent correspondre à celles de l'edge function)
    const GEN_DIMS = {
      portrait:  { imgW: 832,  imgH: 1248 },
      landscape: { imgW: 1248, imgH: 832  },
      stripV:    { imgW: 512,  imgH: 1536 },
      stripH:    { imgW: 1536, imgH: 512  },
    };

    for (const [fmtId, bgUrl] of Object.entries(backgrounds)) {
      const fmt = FORMATS[fmtId];
      if (!fmt || !bgUrl) continue;

      const { imgW, imgH } = GEN_DIMS[fmtId];
      const scale = Math.max(fmt.canvasWidth / imgW, fmt.canvasHeight / imgH);
      const left  = (fmt.canvasWidth  - imgW * scale) / 2;
      const top   = (fmt.canvasHeight - imgH * scale) / 2;

      const canvasJson = {
        bg:         '#ffffff',
        bgType:     'solid',
        bgGradient: null,
        objects: [
          {
            type: 'image', version: '5.3.0',
            originX: 'left', originY: 'top',
            left, top,
            width: imgW, height: imgH,
            scaleX: scale, scaleY: scale,
            src: bgUrl,
            selectable: false, evented: false,
            hoverCursor: 'default',
            isAIBackground: true,
          },
          ...fmt.photoZones.map((zone) => ({
            type: 'rect', version: '5.3.0',
            originX: 'left', originY: 'top',
            left: zone.x, top: zone.y,
            width: zone.w, height: zone.h,
            fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
            isPhotoZone: true, lockRotation: true,
            selectable: true, evented: true,
          })),
        ],
      };

      await onSaveTemplate({
        name:       `${templateName} · ${fmt.label}`,
        canvasJson,
        previewUrl: bgUrl,
        formatId:   fmtId,
      });
    }
  }

  // ── Save (client) ────────────────────────────────────────────────────────────
  async function handleClientSave() {
    if (!isDirty || !onSaveRequest || isSavingClient) return;
    setIsSavingClient(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      await onSaveRequest();
    } finally {
      setIsSavingClient(false);
    }
  }

  // ── Save as template (admin) ─────────────────────────────────────────────────
  async function handleSaveTemplateClick() {
    if (!onSaveTemplate) return;
    setIsSavingTemplate(true);
    // Laisser React peindre le spinner avant les opérations bloquantes (toDataURL est synchrone)
    await new Promise((r) => setTimeout(r, 50));
    try {
      const canvas = fabricRef.current;
      const canvasJson = JSON.parse(serializeState(canvas));
      // canvas.toDataURL() échoue silencieusement si une image externe (Supabase Storage)
      // n'a pas les headers CORS — on attrape l'erreur et on laisse l'appelant gérer le fallback.
      let previewUrl = null;
      try {
        const origW = canvas.width;
        const origH = canvas.height;
        const origVT = canvas.viewportTransform.slice();
        const needsReset = origW !== currentFormat.canvasWidth || origH !== currentFormat.canvasHeight;
        if (needsReset) {
          canvas._exportMode = true;
          canvas.setWidth(currentFormat.canvasWidth);
          canvas.setHeight(currentFormat.canvasHeight);
          canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
          canvas.renderAll();
        }
        previewUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.75, multiplier: 0.5 });
        if (needsReset) {
          canvas.setWidth(origW);
          canvas.setHeight(origH);
          canvas.setViewportTransform(origVT);
          canvas._exportMode = false;
          canvas.renderAll();
        }
      } catch (e) {
        console.warn('toDataURL bloqué (canvas tainted) — preview non régénérée', e.message);
      }
      await onSaveTemplate({ canvasJson, previewUrl, formatId: currentFormat.id });
    } catch (err) {
      console.error('Sauvegarde échouée :', err);
    } finally {
      setIsSavingTemplate(false);
    }
  }

  function addPhotoZone() {
    const canvas = fabricRef.current;
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    const w = Math.round(W * 0.6);
    const h = Math.round(H * 0.6);
    const rect = createPhotoZoneRect({
      x: Math.round((W - w) / 2),
      y: Math.round((H - h) / 2),
      w, h,
    });
    isSavingRef.current = true;
    canvas.add(rect);
    canvas.sendToBack(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    isSavingRef.current = false;
    setSelectedObject(rect);
    saveHistorySnapshot(canvas);
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    const active = canvas.getActiveObjects();
    if (!active.length) return;
    active.forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    setSelectedObject(null);
    canvas.renderAll();
    saveHistorySnapshot(canvas);
  }

  function bringForward() {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    canvas.bringForward(obj);
    canvas.renderAll();
  }

  function sendBackward() {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    canvas.sendBackwards(obj);
    canvas.renderAll();
  }

  function bringToFront() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    canvas.bringToFront(obj);
    canvas.renderAll();
  }

  function sendToBack() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    canvas.sendToBack(obj);
    canvas.renderAll();
  }

  // ── Alignment helpers ─────────────────────────────────────────────────────────
  function alignObj(getNewCenter) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const br = obj.getBoundingRect(true);
    const cp = obj.getCenterPoint();
    const { x, y } = getNewCenter(br, cp, currentFormat.canvasWidth, currentFormat.canvasHeight);
    obj.setPositionByOrigin(new fabric.Point(x, y), 'center', 'center');
    canvas.renderAll();
    saveHistorySnapshot(canvas);
    setObjectVersion((v) => v + 1);
  }

  function alignLeft()    { alignObj((br, cp)       => ({ x: cp.x - br.left,                           y: cp.y })); }
  function alignRight()   { alignObj((br, cp, cw)   => ({ x: cp.x + (cw - br.left - br.width),        y: cp.y })); }
  function alignTop()     { alignObj((br, cp)       => ({ x: cp.x,                                    y: cp.y - br.top })); }
  function alignBottom()  { alignObj((br, cp, cw, ch) => ({ x: cp.x,                                  y: cp.y + (ch - br.top - br.height) })); }

  function centerH() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const cp = obj.getCenterPoint();
    obj.setPositionByOrigin(new fabric.Point(currentFormat.canvasWidth / 2, cp.y), 'center', 'center');
    canvas.renderAll();
    saveHistorySnapshot(canvas);
    setObjectVersion((v) => v + 1);
  }

  function centerV() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const cp = obj.getCenterPoint();
    obj.setPositionByOrigin(new fabric.Point(cp.x, currentFormat.canvasHeight / 2), 'center', 'center');
    canvas.renderAll();
    saveHistorySnapshot(canvas);
    setObjectVersion((v) => v + 1);
  }

  // ── Copy / Paste / Duplicate ─────────────────────────────────────────────────
  const CLONE_PROPS = ['fontFamily', 'fontWeight', 'fontStyle', 'underline', 'charSpacing', 'textAlign', 'originX', 'originY', 'isPhotoZone', 'locked'];

  // Les zones photo sont structurelles (définies par le format) : jamais dupliquées,
  // sinon elles s'empilent en doublons invisibles (designs vus avec 20+ zones fantômes).
  const involvesPhotoZone = (obj) => !!obj && findPhotoZones([obj]).length > 0;

  function copyObject() {
    const obj = fabricRef.current?.getActiveObject();
    if (!obj || involvesPhotoZone(obj)) return;
    obj.clone((cloned) => { clipboardRef.current = cloned; }, CLONE_PROPS);
  }

  function pasteObject() {
    const canvas = fabricRef.current;
    if (!canvas || !clipboardRef.current || involvesPhotoZone(clipboardRef.current)) return;
    clipboardRef.current.clone((copy) => {
      copy.set({ left: (copy.left ?? 0) + 15, top: (copy.top ?? 0) + 15, evented: true });
      canvas.discardActiveObject();
      canvas.add(copy);
      canvas.setActiveObject(copy);
      canvas.renderAll();
      setSelectedObject(copy);
      saveHistorySnapshot(canvas);
      clipboardRef.current = copy;
    }, CLONE_PROPS);
  }

  function duplicateObject() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || involvesPhotoZone(obj)) return;
    obj.clone((copy) => {
      copy.set({ left: (copy.left ?? 0) + 15, top: (copy.top ?? 0) + 15, evented: true });
      canvas.discardActiveObject();
      canvas.add(copy);
      canvas.setActiveObject(copy);
      canvas.renderAll();
      setSelectedObject(copy);
      saveHistorySnapshot(canvas);
    }, CLONE_PROPS);
  }

  // ── Group / Ungroup ──────────────────────────────────────────────────────────
  function groupSelected() {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!active || active.type !== 'activeSelection') return;
    const group = active.toGroup();
    canvas.setActiveObject(group);
    canvas.renderAll();
    setSelectedObject(group);
    saveHistorySnapshot(canvas);
  }

  function ungroupSelected() {
    const canvas = fabricRef.current;
    const group = canvas?.getActiveObject();
    if (!group || group.type !== 'group') return;
    const sel = group.toActiveSelection();
    canvas.renderAll();
    setSelectedObject(sel);
    saveHistorySnapshot(canvas);
  }

  // ── Lock / Unlock ────────────────────────────────────────────────────────────
  function toggleLock() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const locked = !obj.locked;
    obj.set({
      locked,
      lockMovementX:  locked,
      lockMovementY:  locked,
      lockScalingX:   locked,
      lockScalingY:   locked,
      lockRotation:   locked || !!obj.isPhotoZone,
      hasControls:    !locked,
      hoverCursor:    locked ? 'default' : null,
    });
    canvas.renderAll();
    setObjectVersion((v) => v + 1);
    saveHistorySnapshot(canvas);
  }

  // ── Snap grid ────────────────────────────────────────────────────────────────
  function toggleSnapGrid() {
    const next = !snapGridRef.current;
    snapGridRef.current = next;
    setSnapGrid(next);
  }

  // ── Background ───────────────────────────────────────────────────────────────
  function handleBgColorChange(color) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setBgColor(color);
    bgTypeRef.current = 'solid';
    bgGradientRef.current = null;
    canvas.backgroundColor = color === 'transparent' ? '' : color;
    canvas.renderAll();
    saveHistorySnapshot(canvas);
  }

  function handleBgTypeChange(type) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setBgType(type);
    bgTypeRef.current = type;
    if (type === 'solid') {
      bgGradientRef.current = null;
      canvas.backgroundColor = bgColor || '#ffffff';
      canvas.renderAll();
    } else {
      applyGradientToCanvas(canvas, bgGradient, { width: currentFormat.canvasWidth, height: currentFormat.canvasHeight });
    }
    saveHistorySnapshot(canvas);
  }

  function handleBgGradientChange(grad) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setBgGradient(grad);
    bgGradientRef.current = grad;
    bgTypeRef.current = 'gradient';
    applyGradientToCanvas(canvas, grad, { width: currentFormat.canvasWidth, height: currentFormat.canvasHeight });
    saveHistorySnapshot(canvas);
  }

  // ── Sticker ──────────────────────────────────────────────────────────────────
  async function addSticker(srcOrSvg) {
    const canvas = fabricRef.current;
    if (!canvas || !srcOrSvg) return;

    const isPng = typeof srcOrSvg === 'string'
      && /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(srcOrSvg)
      && !/\.svg(\?|$)/i.test(srcOrSvg);

    if (isPng) {
      fabric.Image.fromURL(srcOrSvg, (img) => {
        if (!img) return;
        const maxDim = Math.max(img.width || 80, img.height || 80);
        const scale  = Math.min(80, currentFormat.canvasWidth * 0.25) / maxDim;
        img.scale(scale);
        img.set({ left: currentFormat.canvasWidth / 2, top: currentFormat.canvasHeight / 2, originX: 'center', originY: 'center' });
        img.isSticker = true;
        img.setCoords();
        addObjectToCanvas(img);
      }, { crossOrigin: 'anonymous' });
      return;
    }

    let svgString = srcOrSvg;

    // If it's a URL (starts with / or http), fetch the SVG text first
    if (srcOrSvg.startsWith('/') || srcOrSvg.startsWith('http')) {
      try {
        const res = await fetch(srcOrSvg);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        svgString = await res.text();
      } catch (err) {
        console.warn('Sticker fetch failed:', err);
        return;
      }
    }

    // Rasteriser à la résolution d'export pour conserver la netteté à l'agrandissement
    const exportRes = Math.max(currentFormat.exportWidth, currentFormat.exportHeight);
    svgToBitmap(svgString, exportRes).then((dataUrl) => {
      if (!dataUrl) return;
      fabric.Image.fromURL(dataUrl, (img) => {
        if (!img) return;
        const maxDim = Math.max(img.width || 80, img.height || 80);
        const scale  = Math.min(80, currentFormat.canvasWidth * 0.25) / maxDim;
        img.scale(scale);
        img.set({ left: currentFormat.canvasWidth / 2, top: currentFormat.canvasHeight / 2, originX: 'center', originY: 'center' });
        img.isSticker = true;
        img.setCoords();
        addObjectToCanvas(img);
      });
    });
  }

  // ── AI Background ────────────────────────────────────────────────────────────
  function applyAIBackground(imageUrl) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    fabric.Image.fromURL(imageUrl, (img) => {
      const scaleX = currentFormat.canvasWidth  / img.width;
      const scaleY = currentFormat.canvasHeight / img.height;
      const scale  = Math.max(scaleX, scaleY);
      img.set({
        scaleX: scale,
        scaleY: scale,
        left:   (currentFormat.canvasWidth  - img.width  * scale) / 2,
        top:    (currentFormat.canvasHeight - img.height * scale) / 2,
        selectable:  false,
        evented:     false,
        hoverCursor: 'default',
        isAIBackground: true,
      });
      // Supprimer l'ancien fond IA s'il existe
      canvas.getObjects().filter((o) => o.isAIBackground).forEach((o) => canvas.remove(o));
      canvas.add(img);
      // sendToBack place img en index 0 — les zones photo (déjà en bas) remontent d'un cran, ce qui est correct
      canvas.sendToBack(img);
      canvas.renderAll();
      isSavingRef.current = false;
      saveHistorySnapshot(canvas);
      setActivePanel(null);
    }, { crossOrigin: 'anonymous' });
  }

  // ── Properties panel callback ────────────────────────────────────────────────
  function handleObjectChange() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.renderAll();
    // Increment version to trigger PropertiesPanel re-render
    // (selectedObject is the actual Fabric object — no need to re-assign)
    setObjectVersion((v) => v + 1);
    saveHistorySnapshot(canvas);
  }

  // ── Context menu ─────────────────────────────────────────────────────────────
  function handleCanvasContextMenu(e) {
    e.preventDefault();
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  }

  // ── Pinch-to-zoom (mobile) ───────────────────────────────────────────────────
  function handleCanvasTouchStart(e) {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    pinchRef.current = { active: true, dist, initZoom: cssZoomRef.current };
  }

  function applyZoom(newZoom) {
    const clamped = Math.min(4, Math.max(fitScaleRef.current, newZoom));
    cssZoomRef.current = clamped;
    setCssZoom(clamped);
  }

  function handleCanvasTouchMove(e) {
    if (!pinchRef.current.active || e.touches.length !== 2) return;
    e.preventDefault();
    const dist    = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    applyZoom(pinchRef.current.initZoom * (dist / pinchRef.current.dist));
  }

  function handleCanvasTouchEnd() { pinchRef.current.active = false; }

  function resetCanvasZoom() { applyZoom(fitScaleRef.current); }
  function zoomIn()  { applyZoom(Math.round((cssZoomRef.current + 0.25) * 100) / 100); }
  function zoomOut() { applyZoom(Math.round((cssZoomRef.current - 0.25) * 100) / 100); }

  // ── Wheel zoom (desktop) ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next  = Math.round((cssZoomRef.current + delta) * 100) / 100;
      applyZoom(next);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dirty tracking + exposition via ref ──────────────────────────────────────
  function markDirty() {
    if (!isClientMode) return;
    setIsDirty(true);
    onDirtyChange?.(true);
  }

  useImperativeHandle(ref, () => ({
    getState: () => {
      if (!fabricRef.current) return null;
      const json = serializeState(fabricRef.current, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current });
      return { canvasJson: JSON.parse(json), formatId: currentFormat.id };
    },
    markClean: () => {
      setIsDirty(false);
      onDirtyChange?.(false);
    },
  }), [currentFormat.id]);


  useEffect(() => {
    if (!isClientMode) return;
    // Le changement de format marque le design comme modifié
    markDirty();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat.id]);

  // ── Couleur de sticker ───────────────────────────────────────────────────────

  function tintGroup(group, color, isTransparent) {
    group.getObjects().forEach((child) => {
      if (child.type === 'group') {
        tintGroup(child, color, isTransparent);
      } else {
        tintElement(child, color, isTransparent);
      }
    });
  }

  function tintElement(el, color, isTransparent) {
    if (!Object.prototype.hasOwnProperty.call(el, '_origFill'))   el._origFill   = el.fill;
    if (!Object.prototype.hasOwnProperty.call(el, '_origStroke')) el._origStroke = el.stroke;

    if (isTransparent) {
      el.set({ fill: el._origFill, stroke: el._origStroke });
    } else {
      if (el.fill   && el.fill   !== 'none') el.set({ fill:   color });
      if (el.stroke && el.stroke !== 'none') el.set({ stroke: color });
    }
  }

  function applyStickerColor(targetObj, color) {
    const canvas = fabricRef.current;
    if (!targetObj?.isSticker || !canvas) return;

    const isTransparent = !color || color === 'transparent';

    if (targetObj.type === 'image') {
      const el = targetObj.getElement();
      // Mémoriser le src original (data URL) avant la première teinte
      if (!targetObj._origSrc) targetObj._origSrc = el.src || el.currentSrc;

      const srcToApply = isTransparent ? targetObj._origSrc : (() => {
        const w   = el.naturalWidth  || el.width  || 300;
        const h   = el.naturalHeight || el.height || 300;
        const oc  = document.createElement('canvas');
        oc.width  = w;
        oc.height = h;
        const ctx = oc.getContext('2d');
        // Remplir avec la couleur, puis masquer par l'alpha de l'image (destination-in)
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(el, 0, 0, w, h);
        return oc.toDataURL('image/png');
      })();

      targetObj.setSrc(srcToApply, () => {
        targetObj.stickerTintColor = isTransparent ? null : color;
        canvas.renderAll();
        handleObjectChange();
      });
      return; // handleObjectChange appelé dans le callback
    } else if (targetObj.type === 'group') {
      tintGroup(targetObj, color, isTransparent);
    } else {
      // SVG à élément unique (path, rect, etc.)
      tintElement(targetObj, color, isTransparent);
    }

    targetObj.stickerTintColor = isTransparent ? null : color;
    canvas.renderAll();
    handleObjectChange();
  }

  // ── Suppression d'arrière-plan (admin) ────────────────────────────────────────
  // Réduit l'image à 2048px max avant envoi pour limiter la taille du payload + du résultat
  function downscaleToDataUrl(el, maxDim = 2048) {
    const w = el.naturalWidth  || el.width;
    const h = el.naturalHeight || el.height;
    if (!w || !h) return el.src;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    if (scale >= 1 && /^data:/.test(el.src)) return el.src;
    const oc = document.createElement('canvas');
    oc.width  = Math.round(w * scale);
    oc.height = Math.round(h * scale);
    oc.getContext('2d').drawImage(el, 0, 0, oc.width, oc.height);
    return oc.toDataURL('image/png');
  }

  async function handleRemoveBackground() {
    const canvas = fabricRef.current;
    if (!canvas || isRemovingBg) return;
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'image') return;

    setIsRemovingBg(true);
    setRemoveBgError('');
    try {
      const el      = obj.getElement();
      const input   = downscaleToDataUrl(el);
      // Dimensions affichées à préserver (le résultat peut avoir une autre résolution)
      const dispW   = (obj.width  || 1) * (obj.scaleX || 1);
      const dispH   = (obj.height || 1) * (obj.scaleY || 1);
      const result  = await removeImageBackground(input, eventCode);
      await new Promise((resolve) => {
        obj.setSrc(result, () => {
          obj.set({
            scaleX: dispW / (obj.width  || 1),
            scaleY: dispH / (obj.height || 1),
          });
          obj.setCoords();
          // La teinte sticker n'a plus de sens après détourage — on réinitialise
          delete obj._origSrc;
          obj.stickerTintColor = null;
          canvas.renderAll();
          resolve();
        }, { crossOrigin: 'anonymous' });
      });
      handleObjectChange();
    } catch (err) {
      setRemoveBgError(err.message ?? 'Erreur inconnue');
      setTimeout(() => setRemoveBgError(''), 3000);
    } finally {
      setIsRemovingBg(false);
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!fabricRef.current || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const pngBase64  = await exportAsHighResPNG(fabricRef.current, currentFormat);
      const canvasJson = JSON.parse(serializeState(fabricRef.current, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current }));
      await submitDesign({ code: eventCode, canvasJson, format: currentFormat.id, pngBase64 });
      onSubmitSuccess?.();
    } catch (err) {
      setSubmitError(err.message ?? 'Erreur lors de la soumission');
      setIsSubmitting(false);
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  async function handleExport(punchZones = true) {
    if (!fabricRef.current || isExporting) return;
    setExportMenuOpen(false);
    setIsExporting(true);
    setExportProgress(`Génération ${currentFormat.exportWidth}×${currentFormat.exportHeight}px…`);
    try {
      const dataURL = await exportAsHighResPNG(fabricRef.current, currentFormat, { punchZones });
      const suffix = punchZones ? '' : '-fond-plein';
      downloadPNG(dataURL, `template-photobooth-${currentFormat.id}${suffix}.png`);
      setExportProgress('');
    } catch (err) {
      console.error('Export failed:', err);
      setExportProgress('Erreur export');
    } finally {
      setIsExporting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F2F2F7' }}>

      {/* ── Header ── */}
      <header className="flex items-center px-3 py-2 bg-card border-b border-[#E5E5EA] gap-2 shrink-0 z-10 min-h-[52px]">

        {/* Logo */}
        <div className="flex items-center shrink-0">
          <BrandLogo className="h-6 md:h-8 w-auto" textClassName="text-base font-semibold text-gray-900" />
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Format selector — pill */}
        <button
          onClick={() => setActivePanel(activePanel === 'templates' ? null : 'templates')}
          title="Changer de format ou de modèle"
          className={`flex items-center gap-1 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-xs font-medium transition-colors
            ${activePanel === 'templates'
              ? 'bg-primary/15 text-primary'
              : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}
        >
          <span>{currentFormat.label}</span>
          <span className="hidden sm:inline text-[#6E6E73]">·</span>
          <span className="hidden sm:inline text-[#6E6E73]">{currentFormat.subtitle}</span>
          <svg className="w-3 h-3 text-[#6E6E73] ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Undo / Redo — masqués sur mobile (pas assez de place) */}
        <div className="hidden md:flex items-center gap-0.5">
          <button onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)"
            className="p-2 rounded-xl text-[#6E6E73] hover:bg-[#F2F2F7] hover:text-[#1D1D1F]
              disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)"
            className="p-2 rounded-xl text-[#6E6E73] hover:bg-[#F2F2F7] hover:text-[#1D1D1F]
              disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>

        {/* Snap grid toggle — masqué sur mobile */}
        <button
          onClick={toggleSnapGrid}
          title={snapGrid ? 'Désactiver la grille' : 'Activer la grille (20px)'}
          className={`hidden md:block p-2 rounded-xl transition-colors ${snapGrid ? 'bg-primary/15 text-primary' : 'text-[#6E6E73] hover:bg-[#F2F2F7] hover:text-[#1D1D1F]'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h.01M8 5h.01M12 5h.01M16 5h.01M20 5h.01M4 9h.01M8 9h.01M12 9h.01M16 9h.01M20 9h.01M4 13h.01M8 13h.01M12 13h.01M16 13h.01M20 13h.01M4 17h.01M8 17h.01M12 17h.01M16 17h.01M20 17h.01" />
          </svg>
        </button>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2">
          {exportProgress && (
            <span className="text-xs text-[#6E6E73] animate-pulse hidden sm:block">{exportProgress}</span>
          )}
          {onSaveTemplate && (
            <button
              onClick={() => setShowBatchImport(true)}
              title="Import en lot"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F2F2F7] text-[#1D1D1F] text-sm font-medium rounded-full
                hover:bg-[#E8E8ED] transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Import lot
            </button>
          )}
          {onSaveTemplate && (
            <button
              onClick={handleSaveTemplateClick}
              disabled={isSavingTemplate}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-primary/100 text-white text-sm font-medium rounded-full
                hover:bg-primary disabled:opacity-50 disabled:cursor-wait transition-colors"
            >
              {isSavingTemplate
                ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
              }
              {isSavingTemplate ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          )}
          {isClientMode && (
            <>
              {/* Bouton historique */}
              <button
                onClick={() => onHistoryOpen?.()}
                title="Historique des versions"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full border border-gray-200
                  text-gray-500 hover:bg-gray-50 hover:border-primary hover:text-primary transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="hidden sm:inline">Historique</span>
              </button>

              {/* Bouton sauvegarde manuelle */}
              <button
                onClick={handleClientSave}
                disabled={isSavingClient || !isDirty}
                title={isSavingClient ? 'Sauvegarde en cours…' : isDirty ? 'Sauvegarder les modifications' : 'Aucune modification'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full border transition-colors relative
                  ${isSavingClient
                    ? 'border-primary text-primary bg-primary/10 cursor-wait'
                    : isDirty
                      ? 'border-primary text-primary bg-primary/10 hover:bg-primary/15 cursor-pointer'
                      : 'border-gray-200 text-gray-400 cursor-default'}`}
              >
                {isSavingClient
                  ? <span className="w-3.5 h-3.5 border-2 border-primary border-t-primary rounded-full animate-spin shrink-0" />
                  : <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                }
                <span className="hidden sm:inline">
                  {isSavingClient ? 'Sauvegarde…' : isDirty ? 'Sauvegarder' : 'Sauvegardé'}
                </span>
                {isDirty && !isSavingClient && (
                  <span className="sm:hidden absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary/100 rounded-full" />
                )}
              </button>

              {/* Bouton valider */}
              <button onClick={() => setShowSubmitConfirm(true)} disabled={isSubmitting}
                className="flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-1.5 bg-primary text-white text-sm font-semibold rounded-full
                  hover:bg-primary disabled:opacity-50 disabled:cursor-wait transition-colors shadow-sm">
                {isSubmitting
                  ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                }
                <span className="hidden sm:inline">{isSubmitting ? 'Envoi…' : 'Valider mon design'}</span>
                <span className="sm:hidden">{isSubmitting ? 'Envoi…' : 'Valider'}</span>
              </button>
            </>
          )}
          {!isClientMode && (
            <DropdownMenu open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button disabled={isExporting}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-muted text-foreground text-sm font-medium rounded-full
                    hover:bg-muted/80 disabled:opacity-50 disabled:cursor-wait transition-colors">
                  {isExporting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Download className="w-3.5 h-3.5" />}
                  {isExporting ? 'Export…' : 'Télécharger PNG'}
                  {!isExporting && <ChevronDown className="w-3 h-3" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem onSelect={() => handleExport(true)} className="flex-col items-start py-3">
                  <div className="text-sm font-medium text-foreground">Zones photo transparentes</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Trous transparents à l'emplacement des photos (pour superposer).</div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => handleExport(false)} className="flex-col items-start py-3">
                  <div className="text-sm font-medium text-foreground">Fond plein (sans transparence)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Fond du template visible partout, à recadrer ailleurs.</div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      {/* pb-[58px] réserve de l'espace pour la Toolbar fixe en bas sur mobile */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden pb-[58px] md:pb-0">

        <Toolbar
          activePanel={activePanel}
          onToggleTemplates={() => setActivePanel(activePanel === 'templates' ? null : 'templates')}
          onToggleStickers={() => setActivePanel(activePanel === 'stickers' ? null : 'stickers')}
          onToggleAIBackground={() => setActivePanel(activePanel === 'ai-background' ? null : 'ai-background')}
          showAIBackground={!isClientMode && aiVisuals}
          onAddPhotoZone={addPhotoZone}
          onAddText={addText}
          onAddRect={addRect}
          onAddCircle={addCircle}
          onAddLine={addLine}
          onUploadImage={handleImageUpload}
          onDeleteSelected={deleteSelected}
          onBringForward={bringForward}
          onSendBackward={sendBackward}
          onCenterH={centerH}
          onCenterV={centerV}
          onDuplicate={duplicateObject}
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          onToggleLock={toggleLock}
          snapGrid={snapGrid}
          onToggleSnapGrid={toggleSnapGrid}
          hasSelection={!!selectedObject}
          isLocked={!!selectedObject?.locked}
          hasMultiSelection={selectedObject?.type === 'activeSelection'}
          selectionIsGroup={selectedObject?.type === 'group'}
        />

        {activePanel === 'templates' && (
          <TemplatesSidebar
            currentFormat={currentFormat}
            onSelectTemplate={handleSelectTemplate}
            onClose={() => setActivePanel(null)}
          />
        )}

        {activePanel === 'stickers' && (
          <StickerPanel
            decorations={decorations}
            onAddSticker={addSticker}
            onClose={() => setActivePanel(null)}
          />
        )}

        {activePanel === 'ai-background' && !isClientMode && aiVisuals && (
          <AIBackgroundPanel
            formatId={currentFormat.id}
            onApply={applyAIBackground}
            onSaveAllFormats={onSaveTemplate ? handleSaveAllFormats : null}
            onClose={() => setActivePanel(null)}
          />
        )}

        {/* Canvas area */}
        <div
          ref={canvasAreaRef}
          className="flex-1 flex overflow-auto p-2 md:p-8"
          style={{ background: '#F3F4F7' }}
        >
          {/* Outer div : (W+2P)×(H+2P) scaled — contient le canvas agrandi et l'ombre du template */}
          <div style={{
            width:      (currentFormat.canvasWidth  + CANVAS_OVERFLOW_PAD * 2) * cssZoom,
            height:     (currentFormat.canvasHeight + CANVAS_OVERFLOW_PAD * 2) * cssZoom,
            flexShrink: 0,
            margin:     'auto',
            position:   'relative',
          }}>
            {/* Ombre du template — positionnée au-dessus du padding, taille W×H */}
            <div className="canvas-shadow" style={{
              position:      'absolute',
              left:          CANVAS_OVERFLOW_PAD * cssZoom,
              top:           CANVAS_OVERFLOW_PAD * cssZoom,
              width:         currentFormat.canvasWidth  * cssZoom,
              height:        currentFormat.canvasHeight * cssZoom,
              pointerEvents: 'none',
            }} />
            {/* Inner div : canvas agrandi (W+2P)×(H+2P), CSS transform scale */}
            <div
              ref={canvasInnerDivRef}
              key={`${currentFormat.id}-${currentTemplate.id}`}
              className="relative touch-none"
              style={{
                width:           currentFormat.canvasWidth  + CANVAS_OVERFLOW_PAD * 2,
                height:          currentFormat.canvasHeight + CANVAS_OVERFLOW_PAD * 2,
                transform:       `scale(${cssZoom})`,
                transformOrigin: 'top left',
                overflow:        'visible',
              }}
              onContextMenu={handleCanvasContextMenu}
              onTouchStart={handleCanvasTouchStart}
              onTouchMove={handleCanvasTouchMove}
              onTouchEnd={handleCanvasTouchEnd}
            >
              <canvas ref={canvasElRef} />

              {/* Bleed guide overlay — affiché dans l'éditeur, absent de l'export PNG */}
              {(() => {
                const bleedMm = formatBleedOverrides?.[currentFormat.id] ?? currentFormat.bleedMm ?? 3;
                const bleedPx = Math.round(bleedMm * (currentFormat.pxPerMm ?? 4));
                if (bleedPx <= 0) return null;
                const W = currentFormat.canvasWidth;
                const H = currentFormat.canvasHeight;
                return (
                  <svg
                    style={{
                      position:      'absolute',
                      left:          CANVAS_OVERFLOW_PAD,
                      top:           CANVAS_OVERFLOW_PAD,
                      pointerEvents: 'none',
                    }}
                    width={W}
                    height={H}
                  >
                    {/* 4 lignes de fond de coupe */}
                    <line x1={bleedPx} y1={0} x2={bleedPx} y2={H} stroke="#ef4444" strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                    <line x1={W - bleedPx} y1={0} x2={W - bleedPx} y2={H} stroke="#ef4444" strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                    <line x1={0} y1={bleedPx} x2={W} y2={bleedPx} stroke="#ef4444" strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                    <line x1={0} y1={H - bleedPx} x2={W} y2={H - bleedPx} stroke="#ef4444" strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                    {/* Labels dans les angles */}
                    <text x={bleedPx + 3} y={bleedPx - 3} fontSize={7} fill="#ef4444" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600" opacity={0.9}>Zone perdue</text>
                    <text x={W - bleedPx - 3} y={H - bleedPx + 9} fontSize={7} fill="#ef4444" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600" textAnchor="end" opacity={0.9}>Zone perdue</text>
                  </svg>
                );
              })()}

              {/* Smart alignment guides overlay — positionnés dans la zone template */}
              {snapGuides.length > 0 && (
                <svg
                  style={{
                    position:      'absolute',
                    left:          CANVAS_OVERFLOW_PAD,
                    top:           CANVAS_OVERFLOW_PAD,
                    pointerEvents: 'none',
                  }}
                  width={currentFormat.canvasWidth}
                  height={currentFormat.canvasHeight}
                >
                  {snapGuides.map((g, i) => {
                    const cw = currentFormat.canvasWidth;
                    const ch = currentFormat.canvasHeight;
                    if (g.type === 'v') {
                      const d1 = Math.round(g.pos);
                      const d2 = Math.round(cw - g.pos);
                      return (
                        <g key={i}>
                          <line x1={g.pos} y1={0} x2={g.pos} y2={ch}
                            stroke="#6366f1" strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />
                          {d1 > 24 && <DimPill x={g.pos / 2}      y={ch / 2} value={d1} />}
                          {d2 > 24 && <DimPill x={g.pos + d2 / 2} y={ch / 2} value={d2} />}
                        </g>
                      );
                    } else {
                      const d1 = Math.round(g.pos);
                      const d2 = Math.round(ch - g.pos);
                      return (
                        <g key={i}>
                          <line x1={0} y1={g.pos} x2={cw} y2={g.pos}
                            stroke="#6366f1" strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />
                          {d1 > 24 && <DimPill x={cw / 2} y={g.pos / 2}      value={d1} />}
                          {d2 > 24 && <DimPill x={cw / 2} y={g.pos + d2 / 2} value={d2} />}
                        </g>
                      );
                    }
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Desktop : panneau latéral */}
        <div className="hidden md:contents">
          <PropertiesPanel
            selectedObject={selectedObject}
            objectVersion={objectVersion}
            bgColor={bgColor}
            onBgColorChange={handleBgColorChange}
            bgType={bgType}
            bgGradient={bgGradient}
            onBgTypeChange={handleBgTypeChange}
            onBgGradientChange={handleBgGradientChange}
            onObjectChange={handleObjectChange}
            onCenterH={centerH}
            onCenterV={centerV}
            onToggleLock={toggleLock}
            onStickerColorChange={applyStickerColor}
            onRemoveBackground={aiVisuals ? handleRemoveBackground : null}
            isRemovingBackground={isRemovingBg}
            removeBackgroundError={removeBgError}
          />
        </div>

      </div>

      {/* Status bar — cachée sur mobile (remplacée par la Toolbar fixe) */}
      <div className="hidden md:flex h-8 bg-[#F7F7F8] border-t border-[#E5E5EA] items-center px-4 shrink-0 gap-3">
        <span className="text-[11px] text-[#8E8E93] flex-1 select-none">
          {currentFormat.exportWidth}×{currentFormat.exportHeight} px
          {selectedObject && (
            <span className="ml-3 text-primary">
              {(selectedObject.type === 'i-text' || selectedObject.type === 'text')
                ? '· double-clic pour éditer'
                : '· clic droit pour options'}
            </span>
          )}
        </span>

        {/* Contrôles de zoom desktop */}
        <div className="flex items-center bg-card border border-[#E5E5EA] rounded-md shadow-sm overflow-hidden">
          <button
            onClick={zoomOut}
            disabled={cssZoom <= fitScaleRef.current + 0.02}
            title="Dézoomer (Ctrl+−)"
            className="w-7 h-7 flex items-center justify-center text-[#3C3C43] text-base font-medium
              hover:bg-[#F2F2F7] disabled:opacity-25 transition-colors border-r border-[#E5E5EA]"
          >−</button>
          <button
            onClick={resetCanvasZoom}
            title="Ajuster à l'écran (Ctrl+0)"
            className="px-2.5 h-7 text-[11px] font-semibold text-[#3C3C43] tabular-nums
              hover:bg-[#F2F2F7] transition-colors min-w-[48px] text-center border-r border-[#E5E5EA]"
          >{Math.round(cssZoom * 100)}%</button>
          <button
            onClick={zoomIn}
            disabled={cssZoom >= 4}
            title="Zoomer (Ctrl+=)"
            className="w-7 h-7 flex items-center justify-center text-[#3C3C43] text-base font-medium
              hover:bg-[#F2F2F7] disabled:opacity-25 transition-colors"
          >+</button>
        </div>
      </div>

      {/* Barre de zoom mobile */}
      <div className="md:hidden fixed bottom-[68px] right-3 z-40 flex items-center
        bg-card/95 backdrop-blur-sm border border-gray-200 rounded-full shadow-lg px-1 py-1 gap-0.5">
        {cssZoom > fitScaleRef.current + 0.02 && (
          <>
            <button onClick={zoomOut}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-600
                hover:bg-gray-100 transition-colors text-lg font-medium">−</button>
            <button onClick={resetCanvasZoom}
              className="px-2 min-w-[46px] text-center text-xs font-semibold text-gray-700
                hover:text-primary transition-colors"
              title="Ajuster à l'écran"
            >{Math.round(cssZoom * 100)}%</button>
          </>
        )}
        <button onClick={zoomIn} disabled={cssZoom >= 4}
          className="w-8 h-8 flex items-center justify-center rounded-full text-gray-600
            hover:bg-gray-100 disabled:opacity-30 transition-colors text-lg font-medium">+</button>
      </div>

      {/* Welcome card — première visite client */}
      {showWelcome && (
        <WelcomeCard onClose={() => setShowWelcome(false)} />
      )}

      {/* Modales */}
      <ConfirmModal
        pending={pendingChange}
        onConfirm={confirmReplaceTemplate}
        onCancel={cancelReplaceTemplate}
      />

      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => !isSubmitting && setShowSubmitConfirm(false)} />
          <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-80 mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Valider votre template ?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Votre template sera envoyé définitivement. Vous ne pourrez plus le modifier après la soumission.
            </p>
            {submitError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-4">{submitError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setShowSubmitConfirm(false); setSubmitError(''); }}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200
                  rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
                Annuler
              </button>
              <button onClick={() => { setShowSubmitConfirm(false); handleSubmit(); }}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-green-600
                  rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50">
                {isSubmitting ? 'Envoi…' : 'Oui, valider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          pos={contextMenu}
          onClose={() => setContextMenu(null)}
          actions={{
            onCopy:        copyObject,
            onPaste:       pasteObject,
            hasPaste:      !!clipboardRef.current,
            isPhotoZone:   !!selectedObject?.isPhotoZone,
            onDuplicate:   duplicateObject,
            onToggleLock:  toggleLock,
            isLocked:      !!selectedObject?.locked,
            onBringToFront: bringToFront,
            onBringForward: bringForward,
            onSendBackward: sendBackward,
            onSendToBack:   sendToBack,
            onAlignLeft:    alignLeft,
            onAlignCenterH: centerH,
            onAlignRight:   alignRight,
            onAlignTop:     alignTop,
            onAlignCenterV: centerV,
            onAlignBottom:  alignBottom,
            onDelete:       deleteSelected,
          }}
        />
      )}
    </div>

      {/* ── Mobile : toolbar flottante + bottom sheet propriétés ──────────────────
           Placés EN DEHORS de tous les divs overflow-hidden pour éviter le clipping
           iOS Safari qui affecte position:fixed à l'intérieur de overflow:hidden ── */}
      <FloatingObjectToolbar
        obj={selectedObject}
        version={objectVersion}
        cssZoom={cssZoom}
        canvasDivRef={canvasInnerDivRef}
        onDelete={deleteSelected}
        onDuplicate={duplicateObject}
        onToggleLock={toggleLock}
        onOpenProperties={() => setShowPropertiesSheet(true)}
      />

      {showPropertiesSheet && selectedObject && (
        <div
          className="md:hidden fixed inset-x-0 z-[60] bg-card border-t border-gray-200 rounded-t-2xl shadow-2xl flex flex-col"
          style={{ bottom: 58, maxHeight: `${SHEET_VH * 100}vh` }}
        >
          {/* Handle + close */}
          <div className="shrink-0 flex items-center px-4 py-2 border-b border-gray-100">
            <div className="flex-1 flex justify-center">
              <div className="w-8 h-1 bg-gray-300 rounded-full" />
            </div>
            <button
              onClick={() => setShowPropertiesSheet(false)}
              className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Contenu scrollable */}
          <div className="overflow-y-auto flex-1">
            <PropertiesPanel
              selectedObject={selectedObject}
              objectVersion={objectVersion}
              bgColor={bgColor}
              onBgColorChange={handleBgColorChange}
              bgType={bgType}
              bgGradient={bgGradient}
              onBgTypeChange={handleBgTypeChange}
              onBgGradientChange={handleBgGradientChange}
              onObjectChange={handleObjectChange}
              onCenterH={centerH}
              onCenterV={centerV}
              onToggleLock={toggleLock}
              onStickerColorChange={applyStickerColor}
              onRemoveBackground={aiVisuals ? handleRemoveBackground : null}
              isRemovingBackground={isRemovingBg}
              removeBackgroundError={removeBgError}
              mobile
            />
          </div>
        </div>
      )}

      {showBatchImport && (
        <BatchImportModal onClose={() => setShowBatchImport(false)} />
      )}
    </>
  );
});

export default Editor;
