import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerCustomFonts } from '../../../lib/supabase';
import LazyFontText from '../../LazyFontText';
import { Input } from '../../ui/input';
import { FONT_GROUPS } from '../../../utils/editorFonts';

// Sélecteur de police du panneau des propriétés : polices de l'éditeur, polices importées, recherche.
export default function FontPicker({ value, onChange, extraGroups = [] }) {
  const [open,        setOpen]        = useState(false);
  const [search,      setSearch]      = useState('');
  const [customFonts, setCustomFonts] = useState([]);
  const wrapRef = useRef(null);
  const popRef  = useRef(null);
  const listRef = useRef(null);
  const [popPos, setPopPos] = useState({ top: -9999, left: -9999 });

  // Polices importées déclarées sans être téléchargées (LAB-347) : chacune se charge quand elle
  // s'affiche dans la liste ou quand elle est choisie (document.fonts.load avant de l'appliquer).
  useEffect(() => {
    registerCustomFonts()
      .then((fonts) => setCustomFonts(fonts))
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
    ...extraGroups,
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
        <svg className="w-3 h-3 text-editor-faint shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={popRef}
          className="fixed z-[70] bg-card border border-editor-line rounded-editor-popover shadow-editor-float overflow-hidden"
          style={{ top: popPos.top, left: popPos.left, width: 'min(240px, calc(100vw - 24px))' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="px-3 py-2 border-b border-editor-line-soft">
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
          <div ref={listRef} className="overflow-y-auto max-h-72">
            {filtered.map((group) => (
              <div key={group.label}>
                <p className="px-3 pt-2.5 pb-1 text-editor-xs font-editor-strong text-editor-faint editor-overline sticky top-0 bg-card">
                  {group.label}
                </p>
                {group.fonts.map((font) => (
                  <button
                    key={font}
                    onClick={() => { onChange(font); setOpen(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors
                      ${value === font
                        ? 'bg-editor-selected text-editor-accent-fg'
                        : 'text-editor-fg hover:bg-editor-hover'}`}
                  >
                    <LazyFontText font={font} rootRef={listRef} className="truncate" />
                    {value === font && (
                      <svg className="w-3.5 h-3.5 text-editor-accent-fg shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-xs text-editor-faint text-center">Aucune police trouvée</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
