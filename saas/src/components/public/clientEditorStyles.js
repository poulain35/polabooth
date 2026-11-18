/**
 * Écrans client de l'éditeur (LAB-355) : polices de la palette F « noyer & sauge » (Fraunces + DM Sans)
 * et accent noyer. Les classes sont dans index.css (`pola-pf-*`, LAB-395) ; la page pose
 * `pola-client pola-pf-page` sur sa racine.
 */
import { useEffect } from 'react';
import { ensurePolaFonts } from './polaHead.js';
import { POLA_F_FONTS_HREF } from './polaStyles.js';

/** Charge Fraunces + DM Sans (une seule fois par page). */
export function usePfFonts() {
  useEffect(() => { ensurePolaFonts(POLA_F_FONTS_HREF); }, []);
}

/**
 * Page de l'éditeur du client : polices du site, et classe `pola-client` sur <body> le temps de la
 * page, pour que les menus et fenêtres rendus hors de la page (portails) prennent aussi l'accent noyer.
 */
export function useClientEditorScope() {
  usePfFonts();
  useEffect(() => {
    document.body.classList.add('pola-client');
    return () => document.body.classList.remove('pola-client');
  }, []);
}
