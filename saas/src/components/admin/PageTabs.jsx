import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  segmentedItemActiveClass, segmentedItemClass, segmentedItemIdleClass, segmentedTrackClass,
} from '../ui/segmented-control';

/**
 * Onglets d'une page de l'admin (Demandes et devis, Bornes, Bibliothèque…), en liens : chaque onglet a son
 * adresse. Même dessin en pilule que SegmentedControl. tabs = [{ id, label, to, count? }] ; count > 0 affiche
 * un compteur. Sur téléphone, la barre défile à l'horizontale (sans barre de défilement) et garde l'onglet
 * actif en vue ; la page elle-même ne déborde jamais (LAB-339).
 */
export default function PageTabs({ tabs, active, label, className = '' }) {
  const navRef = useRef(null);

  // Onglet actif visible : défilement horizontal de la barre seulement (pas de scrollIntoView, qui
  // ferait aussi défiler la page).
  // Refait quand la largeur des onglets change : avant le chargement de la police ils sont plus étroits
  // et la barre ne peut pas défiler assez loin (dernier onglet hors champ au premier affichage).
  useEffect(() => {
    const reveal = () => {
      const nav = navRef.current;
      const link = nav?.querySelector('[aria-current="page"]');
      if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
      const start = link.offsetLeft; // la barre (relative) est le parent de positionnement
      const end = start + link.offsetWidth;
      if (start < nav.scrollLeft || end > nav.scrollLeft + nav.clientWidth) {
        nav.scrollLeft = Math.max(0, start - (nav.clientWidth - link.offsetWidth) / 2);
      }
    };
    reveal();
    const track = navRef.current?.firstElementChild;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(reveal);
    observer.observe(track);
    return () => observer.disconnect();
  }, [active]);

  if (!tabs?.length) return null;
  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={cn(
        'relative flex min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <div className={cn(segmentedTrackClass, 'max-w-none shrink-0 flex-nowrap')}>
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <Link
              key={tab.id}
              to={tab.to}
              aria-current={current ? 'page' : undefined}
              className={cn(segmentedItemClass, current ? segmentedItemActiveClass : segmentedItemIdleClass)}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium leading-none text-primary-foreground">
                  {tab.count > 99 ? '99+' : tab.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
