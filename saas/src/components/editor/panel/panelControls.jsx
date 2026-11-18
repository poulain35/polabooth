import { Textarea } from '../../ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../ui/select';
import {
  editorSegmentedTrackClass, editorSegmentedItemClass,
  editorSegmentedItemActiveClass, editorSegmentedItemIdleClass,
} from '../../ui/segmented-control';
import { cn } from '../../../lib/utils';
import { colorForInput } from '../../../lib/kioskButton';
import ColorInput from '../../ColorInput';
import FontPicker from './FontPicker';
import { TEXT_WEIGHT_OPTIONS, weightValue } from './textWeights';

// Petits champs du panneau des propriétés (libellé, section, nombres, curseur, groupes de boutons,
// texte d'un bouton de la borne).
export function Label({ children }) {
  return <label className="text-[12px] font-editor-strong text-foreground block mb-1.5">{children}</label>;
}

export function Section({ title, children }) {
  return (
    <div className="border-b border-muted">
      {title && (
        <div className="px-4 pt-2.5 pb-2 bg-muted/60 border-b border-border">
          <p className="text-[11px] font-editor-heading text-muted-foreground editor-overline">{title}</p>
        </div>
      )}
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

export function NumberInput({ label, value, onChange, min, max, step = 1 }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        value={Math.round(value) || 0}
        min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full text-[12px] font-medium border border-border rounded-xl px-2.5 py-1.5
          text-foreground bg-card focus:outline-none focus:border-primary focus:ring-2
          focus:ring-primary/15 transition-colors"
      />
    </div>
  );
}

export function IconInput({ icon, value, onChange, min, max, step = 1, unit }) {
  return (
    <div className="flex items-center gap-1.5 border border-border rounded-xl px-2 py-1.5
      focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-colors bg-card">
      <span className="text-editor-faint shrink-0 flex items-center">{icon}</span>
      <input
        type="number"
        value={Math.round(value) || 0}
        min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 w-0 text-[12px] font-medium text-foreground focus:outline-none bg-transparent tabular-nums"
      />
      {unit && <span className="text-[10px] text-editor-faint shrink-0">{unit}</span>}
    </div>
  );
}

export function RangeInput({ label, value, onChange, min = 0, max = 100 }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <Label>{label}</Label>
        <span className="text-[12px] font-editor-strong text-foreground tabular-nums">{pct}%</span>
      </div>
      <input
        type="range" min={min} max={max}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--editor-accent, hsl(var(--primary))) ${pct}%, var(--editor-track) ${pct}%)`,
          accentColor: 'var(--editor-accent, hsl(var(--primary)))',
        }}
      />
    </div>
  );
}

/* ── MultiToggleGroup — boutons indépendamment activables (décoration), style du contrôle segmenté ── */
export function MultiToggleGroup({ options }) {
  return (
    <div role="group" className={editorSegmentedTrackClass}>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={opt.active}
          onClick={opt.onClick}
          title={opt.title}
          className={cn(editorSegmentedItemClass, opt.active ? editorSegmentedItemActiveClass : editorSegmentedItemIdleClass)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── ActionButtonGroup — boutons d'action non-toggle (même style) ────────── */
export function ActionButtonGroup({ options }) {
  return (
    <div className={editorSegmentedTrackClass}>
      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          onClick={opt.onClick}
          title={opt.title}
          disabled={opt.disabled}
          className={cn(
            editorSegmentedItemClass,
            'text-muted-foreground hover:bg-card hover:text-foreground hover:shadow-sm',
            'disabled:opacity-30 disabled:cursor-not-allowed',
          )}
        >
          {opt.icon}
          {opt.label && <span>{opt.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Un texte d'un bouton de la borne : contenu, police (même liste que les modèles photos), graisse, taille, couleur. */
export function ButtonTextField({ label, text, S, inputRef, onChange, onFontChange }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea
        ref={inputRef}
        value={text.text || ''}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Texte du bouton"
        className="min-h-0 text-[13px] rounded-xl resize-none"
        rows={2}
      />
      {/* Le bouton est exporté en PNG à la publication : toutes les polices conviennent. */}
      <FontPicker value={text.fontFamily || 'Roboto'} onChange={(f) => onFontChange({ family: f })} />
      <div className="grid grid-cols-2 gap-2">
        <Select value={weightValue(text.fontWeight)} onValueChange={(v) => onFontChange({ weight: v })}>
          <SelectTrigger className="h-auto py-1.5 rounded-xl text-[12px] font-medium">
            <SelectValue placeholder="Graisse" />
          </SelectTrigger>
          <SelectContent>
            {TEXT_WEIGHT_OPTIONS.map((w) => (
              <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconInput
          icon={<span className="text-[11px] font-black leading-none select-none">Aa</span>}
          value={(text.fontSize || 20) * S}
          onChange={(v) => { if (v >= 8) onChange({ fontSize: v / S }); }}
          min={8} max={400} unit="px"
        />
      </div>
      <ColorInput label="Couleur" value={colorForInput(text.fill)} onChange={(v) => onChange({ fill: v })} />
    </div>
  );
}
