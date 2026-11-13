import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Eraser, Loader2, Lock, Unlock } from 'lucide-react';
import ColorInput from './ColorInput';
import TextEffectPanel from './TextEffectPanel';
import { fetchCustomFonts } from '../lib/supabase';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';

const FONT_GROUPS = [
  {
    label: 'Mariage & Calligraphie',
    fonts: [
      'Tangerine','Corinthia','Italianno','Euphoria Script','Monsieur La Doulaise',
      'Mea Culpa','Lovers Quarrel','Engagement','Princess Sofia','WindSong',
      'Licorice','Waterfall','Gwendolyn','Ephesis','Norican',
      'Herr Von Muellerhoff','Mrs Saint Delafield','Inspiration',
    ],
  },
  {
    label: 'Sans-serif',
    fonts: [
      'Roboto','Open Sans','Lato','Montserrat','Nunito','Raleway','Poppins','Inter',
      'Source Sans 3','Ubuntu','Josefin Sans','Quicksand','Mulish','Karla','DM Sans',
      'Outfit','Figtree','Plus Jakarta Sans','Manrope','Jost','Work Sans','Barlow',
      'Exo 2','Nunito Sans','Noto Sans',
    ],
  },
  {
    label: 'Serif',
    fonts: [
      'Playfair Display','Merriweather','Lora','Cormorant Garamond','EB Garamond',
      'Libre Baskerville','Crimson Text','Cardo','Spectral','Gilda Display',
      'Italiana','Cinzel','Sorts Mill Goudy',
    ],
  },
  {
    label: 'Écriture',
    fonts: [
      'Dancing Script','Pacifico','Caveat','Sacramento','Great Vibes','Satisfy',
      'Kaushan Script','Courgette','Permanent Marker','Pinyon Script','Alex Brush',
      'Allura','Yellowtail','Parisienne','Petit Formal Script','Marck Script',
    ],
  },
  {
    label: 'Display',
    fonts: [
      'Oswald','Lobster','Righteous','Abril Fatface','Bebas Neue','Anton',
      'Alfa Slab One','Titan One','Fredoka One','Bungee','Black Ops One',
      'Russo One','Ultra','Squada One','Lilita One','Passion One',
    ],
  },
];

const FONT_WEIGHTS = [
  { label: 'Normal', value: 'normal' },
  { label: 'Gras',   value: 'bold' },
];

function FontPicker({ value, onChange }) {
  const [open,        setOpen]        = useState(false);
  const [search,      setSearch]      = useState('');
  const [customFonts, setCustomFonts] = useState([]);
  const wrapRef = useRef(null);
  const popRef  = useRef(null);
  const [popPos, setPopPos] = useState({ top: -9999, left: -9999 });

  // Charger et enregistrer les polices custom au premier rendu
  useEffect(() => {
    fetchCustomFonts()
      .then(async (fonts) => {
        setCustomFonts(fonts);
        await Promise.allSettled(fonts.map(async (font) => {
          if ([...document.fonts].some((f) => f.family === font.name)) return;
          try {
            const ff = new FontFace(font.name, `url(${font.url})`);
            await ff.load();
            document.fonts.add(ff);
          } catch (_) {}
        }));
      })
      .catch(() => {});
  }, []);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !popRef.current) return;
    const wr = wrapRef.current.getBoundingClientRect();
    const pr = popRef.current.getBoundingClientRect();
    let top  = wr.bottom + 4;
    let left = wr.left;
    if (top + pr.height > window.innerHeight - 8) top = wr.top - pr.height - 4;
    if (left + pr.width > window.innerWidth - 8)  left = window.innerWidth - pr.width - 8;
    setPopPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!popRef.current?.contains(e.target) && !wrapRef.current?.contains(e.target))
        setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const q = search.toLowerCase();
  const allGroups = [
    ...(customFonts.length > 0 ? [{ label: 'Mes polices', fonts: customFonts.map((f) => f.name) }] : []),
    ...FONT_GROUPS,
  ];
  const filtered = allGroups.map((g) => ({
    ...g,
    fonts: g.fonts.filter((f) => f.toLowerCase().includes(q)),
  })).filter((g) => g.fonts.length > 0);

  return (
    <div ref={wrapRef}>
      <button
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 border border-border rounded-xl
          text-[12px] font-medium hover:border-primary transition-colors bg-card text-foreground"
        style={{ fontFamily: value }}
      >
        <span className="truncate">{value}</span>
        <svg className="w-3 h-3 text-gray-400 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={popRef}
          className="fixed z-[70] bg-card border border-gray-200 rounded-2xl shadow-2xl overflow-hidden"
          style={{ top: popPos.top, left: popPos.left, width: 'min(240px, calc(100vw - 24px))' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="px-3 py-2 border-b border-gray-100">
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une police…"
              autoFocus
              className="h-8 text-xs"
            />
          </div>

          {/* Font list */}
          <div className="overflow-y-auto max-h-72">
            {filtered.map((group) => (
              <div key={group.label}>
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 bg-card">
                  {group.label}
                </p>
                {group.fonts.map((font) => (
                  <button
                    key={font}
                    onClick={() => { onChange(font); setOpen(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-primary/10
                      ${value === font ? 'bg-primary/10 text-primary' : 'text-gray-800'}`}
                  >
                    <span style={{ fontFamily: font }} className="truncate">{font}</span>
                    {value === font && (
                      <svg className="w-3.5 h-3.5 text-primary shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-xs text-gray-400 text-center">Aucune police trouvée</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }) {
  return <label className="text-[12px] font-semibold text-foreground block mb-1.5">{children}</label>;
}

function Section({ title, children }) {
  return (
    <div className="border-b border-muted">
      {title && (
        <div className="px-4 pt-2.5 pb-2 bg-muted/60 border-b border-border">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{title}</p>
        </div>
      )}
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 1 }) {
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

function IconInput({ icon, value, onChange, min, max, step = 1, unit }) {
  return (
    <div className="flex items-center gap-1.5 border border-border rounded-xl px-2 py-1.5
      focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-colors bg-card">
      <span className="text-gray-400 shrink-0 flex items-center">{icon}</span>
      <input
        type="number"
        value={Math.round(value) || 0}
        min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 w-0 text-[12px] font-medium text-foreground focus:outline-none bg-transparent tabular-nums"
      />
      {unit && <span className="text-[10px] text-gray-400 shrink-0">{unit}</span>}
    </div>
  );
}

function RangeInput({ label, value, onChange, min = 0, max = 100 }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <Label>{label}</Label>
        <span className="text-[12px] font-semibold text-foreground tabular-nums">{pct}%</span>
      </div>
      <input
        type="range" min={min} max={max}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #6366f1 ${pct}%, #E5E5EA ${pct}%)`,
          accentColor: '#6366f1',
        }}
      />
    </div>
  );
}

/* ── SelectButton / SegmentedControl ─────────────────────────────────────── */
function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.title}
            className={[
              'flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium rounded-lg select-none transition-all',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {opt.icon}
            {opt.label && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── MultiToggleGroup — boutons indépendamment activables (décoration) ───── */
function MultiToggleGroup({ options }) {
  return (
    <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={opt.onClick}
          title={opt.title}
          className={[
            'flex-1 flex items-center justify-center px-1.5 py-1 text-[11px] font-medium rounded-lg select-none transition-all',
            opt.active
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── ActionButtonGroup — boutons d'action non-toggle (même style) ────────── */
function ActionButtonGroup({ options }) {
  return (
    <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5">
      {options.map((opt, i) => (
        <button
          key={i}
          onClick={opt.onClick}
          title={opt.title}
          disabled={opt.disabled}
          className={[
            'flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium rounded-lg select-none transition-all',
            'text-muted-foreground hover:bg-card hover:text-foreground hover:shadow-sm',
            'disabled:opacity-30 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          {opt.icon}
          {opt.label && <span>{opt.label}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Props:
 *  selectedObject   — actual Fabric.js object (or null)
 *  objectVersion    — increments on each property change to trigger re-render
 *  bgColor          — canvas background color
 *  onBgColorChange  — callback(color)
 *  onObjectChange   — callback() after obj.set()
 *  onCenterH        — center object horizontally
 *  onCenterV        — center object vertically
 */
export default function PropertiesPanel({
  selectedObject,
  // eslint-disable-next-line no-unused-vars
  objectVersion,
  bgColor,
  onBgColorChange,
  bgType        = 'solid',
  bgGradient    = { direction: 'to-b', color1: '#6366f1', color2: '#8b5cf6' },
  onBgTypeChange,
  onBgGradientChange,
  onObjectChange,
  onCenterH,
  onCenterV,
  onToggleLock,
  onStickerColorChange = null,
  onRemoveBackground = null,
  isRemovingBackground = false,
  removeBackgroundError = '',
  mobile        = false,
}) {
  const obj = selectedObject; // actual Fabric object — obj.set() works
  const S = 6; // facteur d'échelle éditeur → export (canvasWidth × S = exportWidth)
  const isPhotoZone = obj?.isPhotoZone === true;
  const isSticker   = !isPhotoZone && obj?.isSticker === true;
  const isText  = !isPhotoZone && !isSticker && (obj?.type === 'i-text' || obj?.type === 'text');
  const isShape = !isPhotoZone && !isSticker && (obj?.type === 'rect' || obj?.type === 'circle' || obj?.type === 'ellipse');
  const isLine  = !isPhotoZone && !isSticker && obj?.type === 'line';
  const isImage = !isPhotoZone && !isSticker && obj?.type === 'image';

  function update(props) {
    if (!obj || typeof obj.set !== 'function') return;
    obj.set(props);
    if (obj.type === 'i-text' || obj.type === 'text') {
      obj.initDimensions?.();
      obj.setCoords();
    }
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  async function updateFont(fontName) {
    if (!obj || typeof obj.set !== 'function') return;
    const size   = obj.fontSize || 20;
    const weight = obj.fontWeight || 'normal';
    try { await document.fonts.load(`${weight} ${size}px "${fontName}"`); } catch (_) {}
    obj.set({ fontFamily: fontName });
    obj.initDimensions?.();
    obj.setCoords();
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  function applyTextTransform(transform) {
    if (!obj) return;
    let text = obj._rawText ?? obj.text ?? '';
    if (!obj._rawText) obj._rawText = text;
    if (transform === 'uppercase')  text = text.toUpperCase();
    else if (transform === 'lowercase')  text = text.toLowerCase();
    else if (transform === 'capitalize') text = text.replace(/\b\w/g, (c) => c.toUpperCase());
    else text = obj._rawText; // 'none' → restore
    obj.set({ text, textTransform: transform });
    obj.initDimensions?.();
    obj.setCoords();
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  return (
    <aside className={`bg-card flex flex-col overflow-y-auto shrink-0 ${mobile ? 'w-full' : 'w-64 border-l border-border'}`}>
      <div className="px-4 py-3 border-b border-muted flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {obj ? (
            isPhotoZone ? 'Zone photo' :
            isSticker   ? 'Sticker' :
            isText  ? 'Texte' :
            isShape ? (obj.type === 'rect' ? 'Rectangle' : 'Cercle') :
            isLine  ? 'Ligne' :
            obj?.type === 'group' ? 'Groupe' :
            isImage ? 'Image' : 'Élément'
          ) : 'Propriétés'}
        </h3>
        {obj && onToggleLock && (
          <button
            onClick={onToggleLock}
            title={obj.locked ? 'Déverrouiller' : 'Verrouiller'}
            className={`p-1.5 rounded-lg transition-colors
              ${obj.locked
                ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
          >
            {obj.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Canvas background — masqué si un élément est sélectionné */}
      {!obj && <Section title="Fond du canvas">
        {/* Mode toggle */}
        <div>
          <Label>Type</Label>
          <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5">
            {[{ id: 'solid', label: 'Uni' }, { id: 'gradient', label: 'Dégradé' }].map(({ id, label }) => {
              const active = bgType === id;
              return (
                <button
                  key={id}
                  onClick={() => onBgTypeChange?.(id)}
                  className={`flex-1 py-1 text-xs font-medium rounded-lg transition-all
                    ${active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {bgType === 'solid' && (
          <ColorInput label="Couleur" value={bgColor} onChange={onBgColorChange} />
        )}

        {bgType === 'gradient' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Couleur 1" value={bgGradient.color1}
                onChange={(c) => onBgGradientChange?.({ ...bgGradient, color1: c })} />
              <ColorInput label="Couleur 2" value={bgGradient.color2}
                onChange={(c) => onBgGradientChange?.({ ...bgGradient, color2: c })} />
            </div>
            <div>
              <Label>Direction</Label>
              <div className="flex gap-1 flex-wrap">
                {[
                  {
                    id: 'to-b', title: 'Vers le bas',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="2" x2="8" y2="11"/><polyline points="5,8 8,11 11,8"/></svg>,
                  },
                  {
                    id: 'to-r', title: 'Vers la droite',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="8" x2="11" y2="8"/><polyline points="8,5 11,8 8,11"/></svg>,
                  },
                  {
                    id: 'to-br', title: 'Diagonal bas-droite',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="3" x2="12" y2="12"/><polyline points="7,12 12,12 12,7"/></svg>,
                  },
                  {
                    id: 'to-bl', title: 'Diagonal bas-gauche',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="13" y1="3" x2="4" y2="12"/><polyline points="9,12 4,12 4,7"/></svg>,
                  },
                  {
                    id: 'radial', title: 'Radial (du centre)',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" opacity="0.7"/><circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="7"/></svg>,
                  },
                ].map(({ id, icon, title }) => (
                  <button
                    key={id}
                    title={title}
                    onClick={() => onBgGradientChange?.({ ...bgGradient, direction: id })}
                    className={`flex-1 min-w-[28px] flex items-center justify-center py-1.5 rounded-xl transition-colors
                      ${bgGradient.direction === id
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Section>}

      {/* Photo zone info */}
      {isPhotoZone && (
        <Section>
          <div className="flex items-start gap-2.5 p-2.5 bg-primary/10 rounded-xl">
            <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-xs text-primary leading-relaxed">
              Zone photo — transparente à l'export. Déplacez et redimensionnez librement.
            </p>
          </div>
        </Section>
      )}

      {/* Sticker color */}
      {isSticker && (
        <Section title="Couleur">
          <ColorInput
            label="Teinte"
            value={obj.stickerTintColor || 'transparent'}
            onChange={(color) => onStickerColorChange?.(obj, color)}
          />
        </Section>
      )}

      {/* Image — suppression d'arrière-plan */}
      {isImage && onRemoveBackground && (
        <Section title="Image">
          <Button
            onClick={onRemoveBackground}
            disabled={isRemovingBackground}
            className="w-full h-9 text-xs"
          >
            {isRemovingBackground ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Suppression…</>
            ) : (
              <><Eraser className="w-4 h-4" />Supprimer l'arrière-plan</>
            )}
          </Button>
          {removeBackgroundError && (
            <p className="text-[10px] text-destructive bg-destructive/10 rounded-lg px-2.5 py-2">{removeBackgroundError}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Détourage automatique par IA · ~10–30s
          </p>
        </Section>
      )}

      {/* No selection */}
      {!obj && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <svg className="w-10 h-10 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
            </svg>
            <p className="text-xs text-gray-400">Sélectionnez un élément pour éditer ses propriétés</p>
          </div>
        </div>
      )}

      {/* Text properties */}
      {isText && (
        <>
          <Section title="Texte">
            <Textarea
              value={obj.text || ''}
              onChange={(e) => { obj._rawText = e.target.value; update({ text: e.target.value }); }}
              placeholder="Contenu du texte"
              className="min-h-0 text-[13px] rounded-xl resize-none"
              rows={2}
            />
            <FontPicker value={obj.fontFamily || 'Roboto'} onChange={(f) => updateFont(f)} />
          </Section>

          <Section title="Typographie">
            {/* Graisse + Taille en grille */}
            <div className="grid grid-cols-2 gap-2">
              <Select value={String(obj.fontWeight || 'normal')} onValueChange={(v) => update({ fontWeight: v })}>
                <SelectTrigger className="h-auto py-1.5 rounded-xl text-[12px] font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">Thin</SelectItem>
                  <SelectItem value="200">Extra Light</SelectItem>
                  <SelectItem value="300">Light</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="500">Medium</SelectItem>
                  <SelectItem value="600">Semi Bold</SelectItem>
                  <SelectItem value="bold">Bold</SelectItem>
                  <SelectItem value="800">Extra Bold</SelectItem>
                  <SelectItem value="900">Black</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 border border-border rounded-xl px-2 py-1.5
                focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-colors bg-card">
                <span className="text-[11px] font-black text-gray-400 shrink-0 select-none leading-none">Aa</span>
                <input
                  type="number" min={6} max={1800} step={S}
                  value={Math.round((obj.fontSize || 20) * S)}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 6) update({ fontSize: Math.round(v / S) }); }}
                  className="flex-1 w-0 text-[12px] font-medium text-foreground focus:outline-none bg-transparent tabular-nums"
                />
                <span className="text-[10px] text-gray-400 shrink-0">px</span>
              </div>
            </div>

            {/* Style */}
            <SegmentedControl
              value={obj.fontStyle || 'normal'}
              onChange={(v) => update({ fontStyle: v })}
              options={[
                { value: 'normal',  label: 'Normal', title: 'Normal' },
                { value: 'italic',  title: 'Italique',
                  icon: <span className="font-bold" style={{ fontStyle: 'italic' }}>Italic</span> },
                { value: 'oblique', title: 'Oblique',
                  icon: <span className="font-bold" style={{ fontStyle: 'oblique' }}>Oblique</span> },
              ]}
            />

            {/* Transformer */}
            <SegmentedControl
              value={obj.textTransform || 'none'}
              onChange={applyTextTransform}
              options={[
                { value: 'none',       title: 'Normal',      label: '—' },
                { value: 'uppercase',  title: 'Majuscules',  label: 'AA' },
                { value: 'lowercase',  title: 'Minuscules',  label: 'aa' },
                { value: 'capitalize', title: 'Capitaliser', label: 'Aa' },
              ]}
            />

            {/* Décoration */}
            <MultiToggleGroup options={[
              {
                key: 'none',
                active: !obj.underline && !obj.overline && !obj.linethrough,
                title: 'Aucune',
                label: '—',
                onClick: () => update({ underline: false, overline: false, linethrough: false }),
              },
              {
                key: 'underline',
                active: !!obj.underline,
                title: 'Souligné',
                label: <span style={{ textDecoration: 'underline' }}>U</span>,
                onClick: () => update({ underline: !obj.underline }),
              },
              {
                key: 'overline',
                active: !!obj.overline,
                title: 'Surligné',
                label: <span style={{ textDecoration: 'overline' }}>U</span>,
                onClick: () => update({ overline: !obj.overline }),
              },
              {
                key: 'linethrough',
                active: !!obj.linethrough,
                title: 'Barré',
                label: <span style={{ textDecoration: 'line-through' }}>S</span>,
                onClick: () => update({ linethrough: !obj.linethrough }),
              },
            ]} />

            {/* Alignement — grands boutons icônes */}
            <div className="flex w-full bg-muted rounded-xl p-1 gap-0.5">
              {[
                { value: 'left',    title: 'Gauche',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h9a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
                { value: 'center',  title: 'Centré',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zM4 15a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
                { value: 'right',   title: 'Droite',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM9 10a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1zM7 15a1 1 0 011-1h8a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
                { value: 'justify', title: 'Justifié',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
              ].map(({ value, title, icon }) => (
                <button
                  key={value}
                  title={title}
                  onClick={() => update({ textAlign: value })}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-lg transition-all select-none
                    ${(obj.textAlign || 'left') === value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {icon}
                </button>
              ))}
            </div>

            {/* Espacement lettres — icône AV inline */}
            <div className="flex items-center gap-2.5">
              <span
                className="text-[11px] font-bold text-gray-400 shrink-0 select-none tracking-tight"
                title="Espacement des caractères"
              >AV</span>
              <input
                type="range" min={-50} max={500}
                value={obj.charSpacing || 0}
                onChange={(e) => update({ charSpacing: Number(e.target.value) })}
                className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                style={{ background: `linear-gradient(to right, #6366f1 ${((obj.charSpacing || 0) + 50) / 550 * 100}%, #E5E5EA ${((obj.charSpacing || 0) + 50) / 550 * 100}%)` }}
              />
              <span className="text-[12px] font-semibold text-foreground tabular-nums w-8 text-right shrink-0">{obj.charSpacing || 0}</span>
            </div>
          </Section>

          <Section title="Couleur">
            <ColorInput
              label="Couleur"
              value={obj.fill}
              onChange={(v) => update({ fill: v })}
            />
          </Section>

          <Section title="Effets">
            <TextEffectPanel obj={obj} onObjectChange={onObjectChange} />
          </Section>
        </>
      )}

      {/* Shape properties */}
      {(isShape || isLine) && (
        <Section title="Couleurs">
          {!isLine && (
            <ColorInput
              label="Fond"
              value={typeof obj.fill === 'string' ? obj.fill : 'transparent'}
              onChange={(v) => update({ fill: v })}
            />
          )}
          <ColorInput
            label="Bordure"
            value={obj.stroke || 'transparent'}
            onChange={(v) => update({ stroke: v })}
          />
          <NumberInput
            label="Épaisseur bordure"
            value={(obj.strokeWidth || 0) * S}
            onChange={(v) => update({ strokeWidth: v / S })}
            min={0} max={300} step={S}
          />
        </Section>
      )}

      {/* Common: position, size, align, opacity */}
      {obj && (
        <>
          <Section title="Position &amp; taille">
            <div className="grid grid-cols-2 gap-2">
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="2" x2="1" y2="12"/><line x1="1" y1="7" x2="11" y2="7"/><polyline points="8,4 11,7 8,10"/></svg>}
                value={(obj.left || 0) * S} onChange={(v) => update({ left: v / S })} min={-59994} max={59994}
              />
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="1" x2="12" y2="1"/><line x1="7" y1="1" x2="7" y2="11"/><polyline points="4,8 7,11 10,8"/></svg>}
                value={(obj.top  || 0) * S} onChange={(v) => update({ top: v / S })} min={-59994} max={59994}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="5,4 2,7 5,10"/><polyline points="9,4 12,7 9,10"/><line x1="2" y1="3" x2="2" y2="11" strokeOpacity="0.4"/><line x1="12" y1="3" x2="12" y2="11" strokeOpacity="0.4"/></svg>}
                value={obj.type === 'circle' ? (obj.radius || 0) * 2 * S : ((obj.width * (obj.scaleX || 1)) || 0) * S}
                onChange={(v) => { if (obj.type === 'circle') update({ radius: (v / S) / 2 }); else update({ scaleX: (v / S) / (obj.width || 1) }); }}
                min={1} max={59994}
              />
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="2" x2="7" y2="12"/><polyline points="4,5 7,2 10,5"/><polyline points="4,9 7,12 10,9"/><line x1="3" y1="2" x2="11" y2="2" strokeOpacity="0.4"/><line x1="3" y1="12" x2="11" y2="12" strokeOpacity="0.4"/></svg>}
                value={obj.type === 'circle' ? (obj.radius || 0) * 2 * S : ((obj.height * (obj.scaleY || 1)) || 0) * S}
                onChange={(v) => { if (obj.type === 'circle') update({ radius: (v / S) / 2 }); else update({ scaleY: (v / S) / (obj.height || 1) }); }}
                min={1} max={59994}
              />
            </div>
            <IconInput
              icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4A5 5 0 104.5 10.5"/><polyline points="11,1 11,4 8,4"/></svg>}
              value={obj.angle || 0}
              onChange={(v) => update({ angle: v })}
              min={-360} max={360} unit="°"
            />

            <ActionButtonGroup options={[
              {
                onClick: onCenterH,
                title: 'Centrer horizontalement',
                icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M4 12h16" /></svg>,
                label: 'Centrer H',
              },
              {
                onClick: onCenterV,
                title: 'Centrer verticalement',
                icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M12 4v16" /></svg>,
                label: 'Centrer V',
              },
            ]} />
          </Section>

          {!isPhotoZone && (
            <Section title="Opacité">
              <RangeInput
                label="Opacité"
                value={obj.opacity ?? 1}
                onChange={(v) => update({ opacity: v })}
              />
            </Section>
          )}
        </>
      )}

      {/* Padding bas pour que le dernier élément soit atteignable au scroll */}
      <div className="shrink-0 h-6" />
    </aside>
  );
}
