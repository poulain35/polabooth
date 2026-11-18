import { useEffect, useRef, useState } from 'react';
import { STICKER_CATEGORIES } from '../data/stickers';
import { defaultStickerCategory } from '../lib/editorMobile';
import { Spinner } from './ui/spinner';

const MY_STICKERS_ID = '__my_stickers__';

// Catégorie par défaut des décorations importées (colonne decorations.category) : affichée en mots
// simples, la valeur en base ne change pas (LAB-355).
const DEFAULT_DB_CATEGORY = 'Mes stickers';
function categoryLabel(cat) {
  return cat === DEFAULT_DB_CATEGORY ? 'Mes décorations' : cat;
}

function StickerPreview({ sticker }) {
  const [imgError, setImgError] = useState(false);

  if (sticker.src && !imgError) {
    return (
      <img
        src={sticker.src}
        alt={sticker.label}
        className="w-full h-full object-contain"
        onError={() => setImgError(true)}
      />
    );
  }

  if (sticker.svg) {
    // Image et non HTML injecté : un SVG en image n'exécute aucun script (LAB-393).
    return (
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(sticker.svg)}`}
        alt={sticker.label}
        className="w-full h-full object-contain"
      />
    );
  }

  // Placeholder when SVG file not yet downloaded
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg className="w-5 h-5 text-editor-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18A1.5 1.5 0 0022.5 18.75V5.25A1.5 1.5 0 0021 3.75H3A1.5 1.5 0 001.5 5.25v13.5A1.5 1.5 0 003 20.25z" />
      </svg>
    </div>
  );
}

// Ne monte l'image que lorsqu'elle approche du viewport
function LazyImg({ src, alt, scrollRef }) {
  const wrapRef = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { root: scrollRef?.current ?? null, rootMargin: '150px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [scrollRef]);
  return (
    <div ref={wrapRef} className="w-full h-full flex items-center justify-center">
      {visible
        ? <img src={src} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-contain" />
        : <div className="w-4 h-4 rounded bg-editor-pressed animate-pulse" />
      }
    </div>
  );
}

export default function StickerPanel({ decorations, onAddSticker, onClose }) {
  // Onglet choisi par l'utilisateur ; sinon « Mes stickers » s'il a du contenu, ou la première
  // catégorie non vide (LAB-353 : jamais un onglet vide à l'ouverture).
  const [chosenCategory, setActiveCategory] = useState(null);
  const activeCategory = chosenCategory ?? defaultStickerCategory(decorations, STICKER_CATEGORIES, MY_STICKERS_ID);
  const scrollRef = useRef(null);

  const myStickers    = decorations; // null = chargement, [] = vide
  const isMyStickers  = activeCategory === MY_STICKERS_ID;
  const category      = STICKER_CATEGORIES.find((c) => c.id === activeCategory);

  // Groupes de "Mes stickers" par catégorie DB
  const myByCategory = (myStickers ?? []).reduce((acc, d) => {
    const cat = d.category || DEFAULT_DB_CATEGORY;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {});

  return (
    <aside className="fixed md:relative inset-0 md:inset-auto md:w-[200px] bg-card md:border-r border-editor-line flex flex-col shrink-0 overflow-hidden shadow-lg md:shadow-none z-30">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-editor-line shrink-0">
        <span className="text-editor-sm font-editor-strong text-editor-fg">Décorations</span>
        <button onClick={onClose} aria-label="Fermer les décorations" className="p-1 rounded-[0.5rem] text-editor-muted hover:bg-editor-hover hover:text-editor-fg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Category tabs : sur deux lignes quand le panneau est étroit (plus d'onglet coupé à droite) */}
      <div className="flex flex-wrap shrink-0 border-b border-editor-line">
        {/* Onglet "Mes stickers" en premier */}
        <button
          onClick={() => setActiveCategory(MY_STICKERS_ID)}
          className={`shrink-0 px-3 py-2 text-editor-xs font-editor-strong transition-colors whitespace-nowrap
            ${isMyStickers ? 'text-editor-accent-fg border-b-2 border-primary -mb-px' : 'text-editor-muted hover:text-editor-fg'}`}
        >
          ✦ Mes décorations
        </button>
        {STICKER_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 px-3 py-2 text-editor-xs font-editor-strong transition-colors whitespace-nowrap
              ${activeCategory === cat.id ? 'text-editor-accent-fg border-b-2 border-primary -mb-px' : 'text-editor-muted hover:text-editor-fg'}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {isMyStickers ? (
          myStickers === null ? (
            <div className="flex justify-center pt-8">
              <Spinner className="h-5 w-5" label="Chargement des décorations" />
            </div>
          ) : myStickers.length === 0 ? (
            <p className="text-editor-xs text-editor-muted text-center pt-6 px-2">
              Aucune décoration pour l'instant.
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(myByCategory).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-editor-2xs font-editor-strong text-editor-muted editor-overline px-1 mb-1">{categoryLabel(cat)}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {items.map((deco) => (
                      <button
                        key={deco.id}
                        title={deco.name}
                        onClick={() => onAddSticker(deco.url)}
                        className="aspect-square flex items-center justify-center bg-editor-soft rounded-xl
                          hover:bg-editor-selected hover:ring-2 hover:ring-primary p-1.5"
                      >
                        <LazyImg src={deco.thumbnail_url || deco.url} alt={deco.name} scrollRef={scrollRef} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {category?.items.map((sticker) => (
              <button
                key={sticker.id}
                title={sticker.label}
                onClick={() => onAddSticker(sticker.src ?? sticker.svg)}
                className="aspect-square flex items-center justify-center bg-editor-soft rounded-xl
                  hover:bg-editor-selected hover:ring-2 hover:ring-primary p-1.5"
              >
                <StickerPreview sticker={sticker} />
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-editor-xs text-editor-muted text-center py-2 shrink-0">
        Touchez une décoration pour l'ajouter
      </p>
    </aside>
  );
}
