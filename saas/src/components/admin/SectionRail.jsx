// Sommaire flottant à droite d'une page de blocs (Bornes › Alertes), posé par-dessus le contenu (il ne
// prend pas de place) : une entrée par bloc, clic = défilement jusqu'au bloc, entrée du bloc visible en
// surbrillance. Réductible en un petit bouton (choix gardé par appareil). À partir de lg seulement. Section suivie : activeSectionId de lib/settingsToc.js.
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ListTree } from 'lucide-react';
import { activeSectionId } from '../../lib/settingsToc';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

// Ligne de suivi : un bloc devient « en cours » quand son haut passe à 32 px du haut de la zone.
const TRACK_OFFSET = 32;
const COLLAPSED_KEY = 'pola-section-rail-collapsed';

function readCollapsed() {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

/**
 * `sections` : `[{ id, label, count? }]` dans l'ordre de la page ; chaque `id` est celui d'un élément
 * rendu dans `children` (avec `scroll-mt-6`). `count` > 0 : pastille à côté du libellé.
 * Une seule section : pas de sommaire.
 */
export default function SectionRail({ sections, label = 'Sur cette page', children }) {
  const [active, setActive] = useState(sections[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const preferredRef = useRef(null);
  const rootRef = useRef(null);
  const idsKey = sections.map((s) => s.id).join(',');
  const showRail = sections.length > 1;

  // Bloc suivi : relu au défilement de la zone principale de l'admin (<main>).
  useEffect(() => {
    if (!showRail || collapsed) return undefined;
    const ids = idsKey.split(',');
    const scroller = rootRef.current?.closest('main') ?? null;
    const target = scroller ?? window;
    let frame = 0;
    function update() {
      frame = 0;
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const positions = ids
        .map((id) => {
          const el = document.getElementById(id);
          return el ? { id, top: el.getBoundingClientRect().top - box.top } : null;
        })
        .filter(Boolean);
      const el = scroller ?? document.documentElement;
      const atBottom = el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      const next = activeSectionId(positions, {
        offset: TRACK_OFFSET, atBottom, preferred: preferredRef.current, viewHeight: box.height,
      });
      if (next) setActive(next);
    }
    function onScroll() { if (!frame) frame = requestAnimationFrame(update); }
    onScroll();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // Les blocs changent de hauteur au chargement (alertes, journaux) : on relit aussi à ce moment.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    if (observer && rootRef.current) observer.observe(rootRef.current);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [showRail, collapsed, idsKey]);

  function handleClick(e, id) {
    e.preventDefault();
    preferredRef.current = id;
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggle(next) {
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* choix non gardé */ }
  }

  return (
    <div ref={rootRef}>
      {children}
      {showRail && (
        <nav aria-label={label} className="fixed right-6 top-28 z-30 hidden lg:block">
          {collapsed ? (
            <button type="button" onClick={() => toggle(false)} aria-expanded="false"
              aria-label={`${label} : afficher`} title={label}
              className="flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card ring-1 ring-border transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ListTree className="size-4" />
            </button>
          ) : (
            <div className="w-52 rounded-card bg-card/95 p-2 shadow-card ring-1 ring-border backdrop-blur">
              <div className="flex items-center justify-between gap-2 pb-1 pl-3">
                <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
                <button type="button" onClick={() => toggle(true)} aria-expanded="true"
                  aria-label={`${label} : réduire`} title="Réduire"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <ul className="flex flex-col gap-0.5">
                {sections.map((section) => {
                  const current = section.id === active;
                  return (
                    <li key={section.id}>
                      <a href={`#${section.id}`} onClick={(e) => handleClick(e, section.id)}
                        aria-current={current ? 'location' : undefined}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-control px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          current ? 'bg-primary-soft font-medium text-primary-ink' : 'text-muted-foreground hover:bg-soft hover:text-foreground',
                        )}>
                        <span className="min-w-0">{section.label}</span>
                        {section.count > 0 && <Badge variant="secondary">{section.count}</Badge>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
