// Galerie des invités aux couleurs de l'événement (LAB-303, spec email-galerie-couleurs, D11, lot L4).
// Règles pures, testées dans galleryBranding.test.js. Couleur et contraste : eventBranding.js (D7),
// le même contrôle que l'email et l'admin. Sans réglage : palette noyer & sauge du site (LAB-397).

import { BUTTON_MIN_CONTRAST, checkColor, contrastRatio, TITLE_MIN_CONTRAST, WHITE } from './eventBranding.js';

/** Fond de la page de la galerie (pf-bg de tailwind.config.js). */
export const GALLERY_PAGE_BACKGROUND = '#FAFAF6';
export const ACCENT_VAR = '--event-accent';
export const ACCENT_TEXT_VAR = '--event-accent-text';

/** Classes de la galerie sans réglage : noyer du site. */
export const DEFAULT_GALLERY_CLASSES = Object.freeze({
  primaryButton: 'bg-pf-noyer text-white hover:bg-pf-noyer-h',
  selectionButton: 'bg-pf-noyer text-white hover:bg-pf-noyer-h',
  title: 'text-pf-text',
  activeTab: 'text-pf-noyer',
});

// Classes écrites en entier : Tailwind les lit dans le texte du fichier.
const ACCENT_BUTTON = 'bg-[color:var(--event-accent)] text-[color:var(--event-accent-text)] hover:brightness-95';
const ACCENT_TEXT = 'text-[color:var(--event-accent)]';

const NO_BRANDING = Object.freeze({ logoUrl: null, text: '', style: undefined, classes: DEFAULT_GALLERY_CLASSES });

/**
 * Habillage de la galerie à partir du `branding` de parsePublicEvent (null ou absent : classes par défaut).
 * Couleur absente, invalide ou refusée par D7 : classes par défaut. Boutons pleins : fond couleur, texte
 * calculé. Nom de l'événement en couleur si 3:1 sur le fond de page, onglet actif si 4,5:1 sur blanc.
 */
export function galleryLook(branding) {
  if (!branding || typeof branding !== 'object') return NO_BRANDING;
  const logoUrl = typeof branding.logoUrl === 'string' && branding.logoUrl.startsWith('https://') ? branding.logoUrl : null;
  const text = typeof branding.galleryText === 'string' && branding.galleryText.trim() ? branding.galleryText : '';
  const check = checkColor(branding.color);
  const theme = check.ok ? check.theme : null;
  if (!theme) return { logoUrl, text, style: undefined, classes: DEFAULT_GALLERY_CLASSES };
  return {
    logoUrl,
    text,
    style: { [ACCENT_VAR]: theme.accent, [ACCENT_TEXT_VAR]: theme.accentText },
    classes: {
      primaryButton: ACCENT_BUTTON,
      selectionButton: ACCENT_BUTTON,
      title: contrastRatio(theme.accent, GALLERY_PAGE_BACKGROUND) >= TITLE_MIN_CONTRAST ? ACCENT_TEXT : DEFAULT_GALLERY_CLASSES.title,
      activeTab: contrastRatio(theme.accent, WHITE) >= BUTTON_MIN_CONTRAST ? ACCENT_TEXT : DEFAULT_GALLERY_CLASSES.activeTab,
    },
  };
}
