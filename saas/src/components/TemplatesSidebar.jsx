import { useEffect, useRef, useState } from 'react';
import { FORMAT_LIST, FORMATS, HOME_FORMAT, isHomeFormat } from '../utils/formats';
import { fetchDbTemplatesMeta } from '../lib/supabase';

const FORMAT_FILTERS = [
  { id: 'all', label: 'Tous' },
  ...FORMAT_LIST.map((f) => ({ id: f.id, label: f.label })),
];

// Zones photo de l'aperçu : damier (classe .checkerboard) aux couleurs des lignes de l'éditeur.
const PHOTO_ZONE_CHECKER = {
  '--checker-size': '6px',
  '--checker-dark': 'hsl(var(--editor-line-strong))',
  '--checker-light': 'hsl(var(--editor-line))',
};

// ── Static template mini-preview (CSS-drawn) ──────────────────────────────────
// Sans couleur de fond (modèle sans aperçu), la vignette prend le gris doux de l'éditeur.
function TemplateMiniPreview({ template, format }) {
  const { canvasWidth: W, canvasHeight: H } = format;
  const ratio = (H / W) * 100;
  const bgColor = template.bgColor ?? template.bg_color;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border-[1.5px] border-editor-line ${bgColor ? '' : 'bg-editor-hover'}`}
      style={{ paddingBottom: `${ratio}%`, ...(bgColor && { backgroundColor: bgColor }) }}
    >
      {format.photoZones.map((zone, i) => (
        <div
          key={i}
          className="absolute checkerboard"
          style={{
            left: `${(zone.x / W) * 100}%`,
            top:  `${(zone.y / H) * 100}%`,
            width:`${(zone.w / W) * 100}%`,
            height:`${(zone.h / H) * 100}%`,
            ...PHOTO_ZONE_CHECKER,
          }}
        />
      ))}
    </div>
  );
}

// ── DB template preview (real PNG thumbnail) ──────────────────────────────────
function DbTemplateMiniPreview({ template, format }) {
  const { canvasWidth: W, canvasHeight: H } = format;
  const ratio = (H / W) * 100;

  if (template.preview_url) {
    return (
      <div
        className="relative w-full overflow-hidden rounded-md"
        style={{ paddingBottom: `${ratio}%` }}
      >
        <img
          src={template.preview_url}
          alt={template.name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>
    );
  }
  return <TemplateMiniPreview template={{}} format={format} />;
}

// ── Lazy-mount wrapper — ne monte l'enfant que quand il approche du viewport ──
function LazyVisible({ children, rootRef }) {
  const wrapperRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { root: rootRef?.current ?? null, rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootRef]);

  return (
    <div ref={wrapperRef}>
      {visible ? children : <div className="w-full rounded-md bg-editor-hover animate-pulse" style={{ paddingBottom: '150%' }} />}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function TemplateCard({ template, format, onClick, isDb }) {
  return (
    <button
      onClick={() => onClick(template, format)}
      className="group relative w-full rounded-md overflow-hidden
        ring-0 hover:ring-2 hover:ring-primary transition-all focus:outline-none"
    >
      {isDb
        ? <DbTemplateMiniPreview template={template} format={format} />
        : <TemplateMiniPreview   template={template} format={format} />
      }
      <div className="absolute inset-0 flex items-end
        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="w-full px-2 py-1.5 text-[11px] font-medium text-white bg-black/60 truncate text-left leading-tight">
          {template.name}
        </span>
      </div>
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
// `adminMode` : dans l'admin, la bibliothèque s'appelle « Cadres photo » ; le client garde « Modèles ».
export default function TemplatesSidebar({ currentFormat, onSelectTemplate, onClose, adminMode = false }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeTag,    setActiveTag]    = useState(null);
  const [dbTemplates,  setDbTemplates]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    fetchDbTemplatesMeta()
      .then(setDbTemplates)
      .catch(() => setDbTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  // Écran d'accueil (LAB-289) : seulement les modèles au format 'home', sans filtre de format ;
  // modèle photo : jamais les modèles d'accueil.
  const homeMode = isHomeFormat(currentFormat);
  const kindTemplates = dbTemplates.filter((t) => (homeMode ? t.format_id === HOME_FORMAT.id : Boolean(FORMATS[t.format_id])));
  const availableTags = [...new Set(kindTemplates.flatMap((t) => t.tags ?? []))].sort();

  const dbCards = kindTemplates
    .filter((t) => homeMode || activeFilter === 'all' || t.format_id === activeFilter)
    .filter((t) => !activeTag || (t.tags ?? []).includes(activeTag))
    .map((t) => ({
      template: t,
      format: homeMode ? HOME_FORMAT : FORMATS[t.format_id],
      isDb: true,
    }));

  return (
    <aside className={`fixed md:relative inset-0 md:inset-auto md:w-80 bg-card md:border-r border-editor-line flex flex-col overflow-hidden shrink-0 shadow-lg z-30 ${adminMode ? 'md:shadow-none' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-editor-line-soft">
        <h2 className="font-editor-strong text-sm text-editor-fg">{adminMode ? 'Cadres photo' : 'Modèles'}</h2>
        <button
          onClick={onClose}
          className={`p-1 ${adminMode ? 'rounded-sm' : 'rounded'} hover:bg-editor-hover text-editor-faint hover:text-editor-fg transition-colors`}
          title="Fermer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Filters */}
      <div className="px-3 pt-3 pb-2 border-b border-editor-line-soft space-y-2">
        {/* Format */}
        {!homeMode && <div className="flex flex-wrap gap-1.5">
          {FORMAT_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all
                ${activeFilter === f.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-editor-line text-editor-ink hover:border-primary hover:text-editor-accent-fg'
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>}
        {/* Tags — visibles uniquement s'il y en a */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all
                ${!activeTag
                  ? 'bg-editor-fg text-editor-panel border-editor-fg'
                  : 'border-editor-line text-editor-ink hover:border-editor-line-strong hover:text-editor-fg'
                }`}
            >
              Tous
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all
                  ${activeTag === tag
                    ? 'bg-editor-fg text-editor-panel border-editor-fg'
                    : 'border-editor-line text-editor-ink hover:border-editor-line-strong hover:text-editor-fg'
                  }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="columns-2 gap-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="break-inside-avoid mb-1 w-full rounded-md bg-editor-hover animate-pulse"
                style={{ paddingBottom: i % 2 === 0 ? '150%' : '67%' }} />
            ))}
          </div>
        ) : (
          <div className="columns-2 gap-1">
            {dbCards.length === 0 && (
              <p className="text-center text-xs text-editor-muted py-8" style={{ columnSpan: 'all' }}>
                {homeMode
                  ? "Aucun modèle d'écran d'accueil pour l'instant."
                  : adminMode ? 'Aucun cadre photo disponible pour ce format.' : 'Aucun modèle disponible pour ce format.'}
              </p>
            )}
            {dbCards.map(({ template, format, isDb }) => (
              <div key={`db-${template.id}`} className="break-inside-avoid mb-1">
                <LazyVisible rootRef={scrollRef}>
                  <TemplateCard
                    template={template}
                    format={format}
                    isDb={isDb}
                    onClick={(tpl, fmt) => { onSelectTemplate(tpl, fmt); onClose(); }}
                  />
                </LazyVisible>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
