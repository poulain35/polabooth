import { useEffect } from 'react';

const PRODUCT_FAVICON = '/polabooth/icon.svg';

/**
 * Icône d'onglet Polabooth sur les écrans du logiciel (admin, connexion, /associer).
 * L'icône d'origine revient en quittant l'écran : les pages client gardent la leur.
 */
export default function useProductFavicon() {
  useEffect(() => {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return undefined;
    const previous = { href: link.getAttribute('href'), type: link.getAttribute('type') };
    link.setAttribute('href', PRODUCT_FAVICON);
    link.setAttribute('type', 'image/svg+xml');
    return () => {
      if (previous.href) link.setAttribute('href', previous.href);
      if (previous.type) link.setAttribute('type', previous.type);
      else link.removeAttribute('type');
    };
  }, []);
}
