import { useEffect, useRef, useState } from 'react';
import { FORMAT_LIST, FORMATS } from '../utils/formats';
import { fetchDbTemplatesMeta } from '../lib/supabase';

const FORMAT_FILTERS = [
  { id: 'all', label: 'Tous' },
  ...FORMAT_LIST.map((f) => ({ id: f.id, label: f.label })),
];

// ── Static template mini-preview (CSS-drawn) ──────────────────────────────────
function TemplateMiniPreview({ template, format }) {
  const { canvasWidth: W, canvasHeight: H } = format;
  const ratio = (H / W) * 100;
  const bgColor = template.bgColor ?? template.bg_color ?? '#ffffff';
  const border  = template.previewBorder ?? '#e2e8f0';

  return (
    <div
      className="relative w-full overflow-hidden rounded-md"
      style={{ paddingBottom: `${ratio}%`, backgroundColor: bgColor, border: `1.5px solid ${border}` }}
    >
      {format.photoZones.map((zone, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${(zone.x / W) * 100}%`,
            top:  `${(zone.y / H) * 100}%`,
            width:`${(zone.w / W) * 100}%`,
            height:`${(zone.h / H) * 100}%`,
            backgroundImage:
              'linear-gradient(45deg,#b8b8b8 25%,transparent 25%),linear-gradient(-45deg,#b8b8b8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#b8b8b8 75%),linear-gradient(-45deg,transparent 75%,#b8b8b8 75%)',
            backgroundSize: '6px 6px',
            backgroundPosition: '0 0,0 3px,3px -3px,-3px 0',
            backgroundColor: '#e0e0e0',
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
  return <TemplateMiniPreview template={{ bgColor: '#f1f5f9', previewBorder: '#e2e8f0' }} format={format} />;
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
      {visible ? children : <div className="w-full rounded-md bg-gray-100 animate-pulse" style={{ paddingBottom: '150%' }} />}
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
      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 to-transparent
        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="w-full px-2 py-1.5 text-[11px] font-medium text-white truncate text-left leading-tight">
          {template.name}
        </span>
      </div>
    </button>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <p className="col-span-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-2 pb-1">
      {children}
    </p>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function TemplatesSidebar({ currentFormat, onSelectTemplate, onClose }) {
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

  const availableTags = [...new Set(dbTemplates.flatMap((t) => t.tags ?? []))].sort();

  const dbCards = dbTemplates
    .filter((t) => activeFilter === 'all' || t.format_id === activeFilter)
    .filter((t) => !activeTag || (t.tags ?? []).includes(activeTag))
    .map((t) => ({
      template: t,
      format: FORMATS[t.format_id] ?? currentFormat,
      isDb: true,
    }));

  return (
    <aside className="fixed md:relative inset-0 md:inset-auto md:w-80 bg-card md:border-r border-gray-200 flex flex-col overflow-hidden shrink-0 shadow-lg z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="font-semibold text-sm text-gray-900">Modèles</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          title="Fermer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Filters */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
        {/* Format */}
        <div className="flex flex-wrap gap-1.5">
          {FORMAT_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all
                ${activeFilter === f.id
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-200 text-gray-600 hover:border-primary hover:text-primary'
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Tags — visibles uniquement s'il y en a */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all
                ${!activeTag
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-800'
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
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-800'
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
              <div key={i} className="break-inside-avoid mb-1 w-full rounded-md bg-gray-100 animate-pulse"
                style={{ paddingBottom: i % 2 === 0 ? '150%' : '67%' }} />
            ))}
          </div>
        ) : (
          <div className="columns-2 gap-1">
            {dbCards.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8" style={{ columnSpan: 'all' }}>
                Aucun modèle disponible pour ce format.
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
