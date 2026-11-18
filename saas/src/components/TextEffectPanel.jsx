import ColorInput from './ColorInput';
import { EFFECT_DEFS, EFFECT_DEFAULTS, applyTextEffect } from '../utils/textEffects';

// Fond des vignettes d'effet : aperçu du rendu sur le canevas (couleurs fixes, comme def.preview), pas l'interface.
const EFFECT_PREVIEW_BG = '#f1f5f9';
const NEON_PREVIEW_BG = '#0f172a';

// ── Slider compact ────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step = 1, onChange, unit = '' }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] font-editor-strong text-editor-fg">{label}</span>
        <span className="text-[12px] font-editor-strong text-editor-fg tabular-nums">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right,var(--editor-accent, hsl(var(--primary))) ${pct}%,var(--editor-track) ${pct}%)` }}
      />
    </div>
  );
}

// ── Effect thumbnail ──────────────────────────────────────────────────────────
function EffectThumb({ def, active, onClick }) {
  const isNeon = def.id === 'neon';
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-1.5 rounded-xl transition-all
        ${active ? 'ring-2 ring-primary bg-editor-selected' : 'hover:bg-editor-hover'}`}
    >
      <div
        className="w-full h-9 rounded-lg flex items-center justify-center text-base font-black select-none"
        style={{ background: isNeon ? NEON_PREVIEW_BG : EFFECT_PREVIEW_BG, ...def.preview }}
      >
        Aa
      </div>
      <span className="text-editor-2xs font-medium text-editor-muted leading-none">{def.label}</span>
    </button>
  );
}

// ── Parameter panels per effect ───────────────────────────────────────────────
function ShadowParams({ params, onChange }) {
  return (
    <>
      <ColorInput showTransparent={false} label="Couleur" value={params.color ?? '#000000'} onChange={(v) => onChange({ color: v })} />
      <Slider label="Opacité"   value={Math.round((params.opacity ?? 0.65) * 100)} min={10} max={100} unit="%" onChange={(v) => onChange({ opacity: v / 100 })} />
      <Slider label="Flou"      value={params.blur    ?? 10} min={0} max={40} onChange={(v) => onChange({ blur: v })} />
      <Slider label="Décalage X" value={params.offsetX ?? 5}  min={-30} max={30} onChange={(v) => onChange({ offsetX: v })} />
      <Slider label="Décalage Y" value={params.offsetY ?? 5}  min={-30} max={30} onChange={(v) => onChange({ offsetY: v })} />
    </>
  );
}

function LiftParams({ params, onChange }) {
  return (
    <>
      <ColorInput showTransparent={false} label="Couleur" value={params.color ?? '#000000'} onChange={(v) => onChange({ color: v })} />
      <Slider label="Opacité"    value={Math.round((params.opacity ?? 0.8) * 100)} min={10} max={100} unit="%" onChange={(v) => onChange({ opacity: v / 100 })} />
      <Slider label="Décalage X" value={params.offsetX ?? 6} min={-20} max={20} onChange={(v) => onChange({ offsetX: v })} />
      <Slider label="Décalage Y" value={params.offsetY ?? 6} min={-20} max={20} onChange={(v) => onChange({ offsetY: v })} />
    </>
  );
}

function OutlineParams({ params, onChange }) {
  return (
    <>
      <ColorInput showTransparent={false} label="Couleur" value={params.color ?? '#ef4444'} onChange={(v) => onChange({ color: v })} />
      <Slider label="Épaisseur" value={params.width ?? 2} min={1} max={40} onChange={(v) => onChange({ width: v })} />
    </>
  );
}

function EchoParams({ params, onChange }) {
  return (
    <>
      <ColorInput showTransparent={false} label="Couleur écho" value={params.color ?? '#6366f1'} onChange={(v) => onChange({ color: v })} />
      <Slider label="Décalage X" value={params.offsetX ?? 8} min={1} max={30} onChange={(v) => onChange({ offsetX: v })} />
      <Slider label="Décalage Y" value={params.offsetY ?? 8} min={1} max={30} onChange={(v) => onChange({ offsetY: v })} />
    </>
  );
}

function NeonParams({ params, onChange }) {
  return (
    <ColorInput showTransparent={false} label="Couleur néon" value={params.color ?? '#00ffcc'} onChange={(v) => onChange({ color: v })} />
  );
}

function GlitchParams({ params, onChange }) {
  return (
    <Slider label="Décalage chromatique" value={params.offset ?? 6} min={1} max={20} onChange={(v) => onChange({ offset: v })} />
  );
}

function BevelParams({ params, onChange }) {
  return (
    <>
      <Slider label="Profondeur" value={params.depth ?? 4} min={1} max={16} onChange={(v) => onChange({ depth: v })} />
      <ColorInput showTransparent={false} label="Reflet" value={params.lightColor ?? '#ffffff'} onChange={(v) => onChange({ lightColor: v })} />
      <ColorInput showTransparent={false} label="Ombre"  value={params.shadowColor ?? '#334155'} onChange={(v) => onChange({ shadowColor: v })} />
    </>
  );
}

const PARAM_PANELS = {
  shadow:  ShadowParams,
  lift:    LiftParams,
  outline: OutlineParams,
  echo:    EchoParams,
  neon:    NeonParams,
  glitch:  GlitchParams,
  bevel:   BevelParams,
};

// ── Main component ────────────────────────────────────────────────────────────
export default function TextEffectPanel({ obj, onObjectChange }) {
  if (!obj) return null;

  const effectType = obj.textEffect || 'none';
  const params     = obj.textEffectParams ?? EFFECT_DEFAULTS[effectType] ?? {};

  function selectEffect(type) {
    obj.textEffect       = type;
    obj.textEffectParams = { ...EFFECT_DEFAULTS[type] };
    applyTextEffect(obj);
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  function changeParam(partial) {
    const next = { ...params, ...partial };
    obj.textEffectParams = next;
    applyTextEffect(obj);
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  const ParamPanel = PARAM_PANELS[effectType] ?? null;

  return (
    <div>
      {/* Grille des effets */}
      <div className="grid grid-cols-4 gap-1">
        {EFFECT_DEFS.map((def) => (
          <EffectThumb
            key={def.id}
            def={def}
            active={effectType === def.id}
            onClick={() => selectEffect(def.id)}
          />
        ))}
      </div>

      {/* Paramètres de l'effet sélectionné */}
      {ParamPanel && (
        <div className="mt-3 space-y-2.5 pt-3 border-t border-editor-line-soft">
          <ParamPanel params={params} onChange={changeParam} />
        </div>
      )}
    </div>
  );
}
