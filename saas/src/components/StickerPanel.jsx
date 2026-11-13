import { useEffect, useRef, useState } from 'react';
import { STICKER_CATEGORIES } from '../data/stickers';

const MY_STICKERS_ID = '__my_stickers__';

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
    return (
      <div
        className="w-full h-full"
        dangerouslySetInnerHTML={{ __html: sticker.svg }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      />
    );
  }

  // Placeholder when SVG file not yet downloaded
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg className="w-5 h-5 text-[#C7C7CC]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
        : <div className="w-4 h-4 rounded bg-[#E5E5EA] animate-pulse" />
      }
    </div>
  );
}

export default function StickerPanel({ decorations, onAddSticker, onClose }) {
  const [activeCategory, setActiveCategory] = useState(MY_STICKERS_ID);
  const scrollRef = useRef(null);

  const myStickers    = decorations; // null = chargement, [] = vide
  const isMyStickers  = activeCategory === MY_STICKERS_ID;
  const category      = STICKER_CATEGORIES.find((c) => c.id === activeCategory);

  // Groupes de "Mes stickers" par catégorie DB
  const myByCategory = (myStickers ?? []).reduce((acc, d) => {
    const cat = d.category || 'Mes stickers';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {});

  return (
    <aside className="fixed md:relative inset-0 md:inset-auto md:w-[200px] bg-card md:border-r border-[#E5E5EA] flex flex-col shrink-0 overflow-hidden shadow-lg md:shadow-none z-30">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#E5E5EA] shrink-0">
        <span className="text-xs font-semibold text-[#1D1D1F]">Stickers</span>
        <button onClick={onClose} className="p-1 rounded-lg text-[#6E6E73] hover:bg-[#F2F2F7] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex overflow-x-auto shrink-0 border-b border-[#E5E5EA] scrollbar-hide">
        {/* Onglet "Mes stickers" en premier */}
        <button
          onClick={() => setActiveCategory(MY_STICKERS_ID)}
          className={`shrink-0 px-3 py-2 text-[10px] font-semibold transition-colors whitespace-nowrap
            ${isMyStickers ? 'text-primary border-b-2 border-primary -mb-px' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}
        >
          ✦ Mes stickers
        </button>
        {STICKER_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 px-3 py-2 text-[10px] font-semibold transition-colors whitespace-nowrap
              ${activeCategory === cat.id ? 'text-primary border-b-2 border-primary -mb-px' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}
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
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : myStickers.length === 0 ? (
            <p className="text-[10px] text-[#AEAEB2] text-center pt-6 px-2">
              Aucun sticker pour l'instant.
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(myByCategory).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[9px] font-semibold text-[#AEAEB2] uppercase tracking-wider px-1 mb-1">{cat}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {items.map((deco) => (
                      <button
                        key={deco.id}
                        title={deco.name}
                        onClick={() => onAddSticker(deco.url)}
                        className="aspect-square flex items-center justify-center bg-[#F9F9FB] rounded-xl
                          hover:bg-primary/10 hover:ring-2 hover:ring-primary p-1.5"
                        style={{ backgroundImage: 'repeating-conic-gradient(#ebebeb 0% 25%, #F9F9FB 0% 50%) 0 0 / 8px 8px' }}
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
                className="aspect-square flex items-center justify-center bg-[#F9F9FB] rounded-xl
                  hover:bg-primary/10 hover:ring-2 hover:ring-primary p-1.5"
              >
                <StickerPreview sticker={sticker} />
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-[#AEAEB2] text-center py-2 shrink-0">
        Cliquer pour ajouter au canvas
      </p>
    </aside>
  );
}
