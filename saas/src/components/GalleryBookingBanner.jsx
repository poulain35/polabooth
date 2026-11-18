import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bookingBannerLinks, dismissBookingBanner, isBookingBannerDismissed } from '../lib/galleryBanner';
import { ensurePolaFonts } from './public/polaHead';
import { POLA_F_FONTS_HREF } from './public/polaStyles';
import { BRAND } from '../lib/instanceBrand';

/** Hauteur visible de la barre, en variable CSS sur <html> : les autres boutons fixes se placent au-dessus. */
export const BAR_OFFSET_VAR = '--gallery-bar-h';

const FOCUS_ON_DARK = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pf-gold focus-visible:ring-offset-2 focus-visible:ring-offset-pf-forest';

/**
 * Barre « Vous organisez un événement ? » des galeries publiques (LAB-130), fixe en bas de l'écran
 * depuis LAB-142, aux couleurs du site. Liens dans un nouvel onglet, sans Referer : l'URL de la
 * galerie porte le code d'accès. Fermée par la croix, elle ne revient plus de la session.
 * `hidden` la masque le temps d'une visionneuse ou d'une feuille plein écran, sans la fermer.
 * Un espaceur de même hauteur, rendu à sa place dans la page, garde visibles la dernière rangée
 * et le pied de page.
 * `site` : site vitrine des liens (par défaut celui de la marque installée, ORG.site).
 */
export default function GalleryBookingBanner({ eventType, hidden = false, site }) {
  const [dismissed, setDismissed] = useState(() => isBookingBannerDismissed());
  const [height, setHeight] = useState(0);
  const barRef = useRef(null);
  const links = bookingBannerLinks(eventType, site);

  useEffect(() => { ensurePolaFonts(POLA_F_FONTS_HREF); }, []);

  // Mesure avant affichage (pas de décalage) puis à chaque changement de taille (rotation, police).
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || dismissed) return undefined;
    const measure = () => { if (el.offsetHeight > 0) setHeight(el.offsetHeight); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dismissed]);

  const offset = dismissed || hidden ? 0 : height;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(BAR_OFFSET_VAR, `${offset}px`);
    return () => root.style.removeProperty(BAR_OFFSET_VAR);
  }, [offset]);

  if (dismissed || !links) return null;

  function close() {
    dismissBookingBanner();
    setDismissed(true);
  }

  return (
    <>
      <div aria-hidden="true" style={{ height }} />
      <aside
        ref={barRef}
        aria-label={BRAND.name}
        hidden={hidden}
        className="fixed inset-x-0 bottom-0 z-30 bg-pf-forest text-pf-on-dark font-pola shadow-[0_-6px_20px_rgba(42,31,24,0.16)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-5xl flex items-center gap-3 sm:gap-5 pl-4 pr-2 sm:pl-6 sm:pr-4 py-2.5">
          <p className="flex-1 min-w-0 leading-tight text-balance">
            <span className="font-pf-serif font-normal text-[19px] sm:text-[22px]">Vous organisez un événement ?</span>
            {BRAND.tagline && <span className="hidden lg:inline text-sm text-pf-on-dark/80 ml-3">{BRAND.name}, {BRAND.tagline}.</span>}
          </p>
          <a
            href={links.business}
            target="_blank"
            rel="noopener noreferrer"
            className={`hidden sm:inline shrink-0 text-sm font-medium text-pf-on-dark/85 underline underline-offset-4 decoration-pf-on-dark/40 hover:text-pf-on-dark hover:decoration-pf-on-dark rounded-sm ${FOCUS_ON_DARK}`}
          >
            Entreprises
          </a>
          <a
            href={links.booking}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 inline-flex items-center justify-center rounded-full bg-pf-on-dark text-pf-forest text-sm font-medium px-4 py-2 sm:px-5 hover:bg-white transition-colors ${FOCUS_ON_DARK}`}
          >
            <span className="sm:hidden">Nos disponibilités</span>
            <span className="hidden sm:inline">Vérifiez nos disponibilités</span>
          </a>
          <button
            type="button"
            onClick={close}
            aria-label={`Fermer le bandeau ${BRAND.name}`}
            className={`shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full text-pf-on-dark/70 hover:text-pf-on-dark hover:bg-pf-on-dark/10 transition-colors ${FOCUS_ON_DARK}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </aside>
    </>
  );
}
