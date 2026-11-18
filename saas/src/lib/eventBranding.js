// Habillage d'un événement (spec email-galerie-couleurs) : form_config.branding (couleur, logo, texte
// de la galerie), contraste des couleurs (D7), variables des textes de l'email (D3), longueurs, date.
// Copie conforme de supabase/functions/_shared/event-branding.ts (sans les types) : toute modification
// se fait dans les deux fichiers, le test de parité (eventBranding.test.js) le vérifie.

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
/** Texte foncé des emails (BRAND.text de email-layout.ts). */
export const DARK_TEXT = '#26081A';
export const WHITE = '#FFFFFF';
/** Bouton : texte normal (WCAG AA). */
export const BUTTON_MIN_CONTRAST = 4.5;
/** Titre de 28 px : grand texte. */
export const TITLE_MIN_CONTRAST = 3;
export const COLOR_REFUSED_MESSAGE =
  'Couleur trop moyenne pour un bouton lisible : prenez-la un peu plus claire ou plus foncée';

/** Longueurs : saisie dans l'admin, coupe du serveur après remplacement des variables. */
export const TEXT_LIMITS = {
  subject: { input: 120, server: 150 },
  title: { input: 80, server: 100 },
  message: { input: 1500, server: 2000 },
  button_label: { input: 30, server: 40 },
  gallery_text: { input: 300, server: 300 },
};

export function isHexColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/** Luminance relative WCAG d'une couleur #RRGGBB. */
export function relativeLuminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Vérifie une couleur saisie. Vide : pas de thème. Format invalide ou contraste insuffisant : refus. */
export function checkColor(value) {
  if (value === null || value === undefined || value === '') return { ok: true, theme: null };
  if (!isHexColor(value)) return { ok: false, error: 'Couleur au format #RRGGBB attendue' };
  const white = contrastRatio(value, WHITE);
  const dark = contrastRatio(value, DARK_TEXT);
  if (Math.max(white, dark) < BUTTON_MIN_CONTRAST) return { ok: false, error: COLOR_REFUSED_MESSAGE };
  return {
    ok: true,
    theme: {
      accent: value,
      accentText: white >= dark ? WHITE : DARK_TEXT,
      titleColor: white >= TITLE_MIN_CONTRAST ? value : DARK_TEXT,
    },
  };
}

/** Thème de l'email, ou null (couleurs actuelles) si la couleur est absente, invalide ou refusée. */
export function eventTheme(color) {
  const check = checkColor(color);
  return check.ok ? check.theme : null;
}

/** Lit form_config.branding : ne garde que des valeurs sûres, ignore le reste sans erreur. */
export function readBranding(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    color: isHexColor(b.color) ? b.color : null,
    logoUrl: typeof b.logo_url === 'string' && b.logo_url.startsWith('https://') ? b.logo_url : null,
    galleryText: typeof b.gallery_text === 'string' ? truncate(b.gallery_text, TEXT_LIMITS.gallery_text.server) : '',
  };
}

// ── Variables (D3) ───────────────────────────────────────────────────────────────────────────

export const EMAIL_VARIABLES = ['event_name', 'event_date', 'client_name', 'company_name', 'photo_url'];
const VARIABLE = /\{([a-z_]+)\}/g;

const isEmailVariable = (name) => EMAIL_VARIABLES.includes(name);

/** Remplace toutes les occurrences, en une passe. Variable inconnue : laissée telle quelle. */
export function fillVariables(text, values) {
  return text.replace(VARIABLE, (match, name) => (isEmailVariable(name) ? values[name] ?? '' : match));
}

/** Variables inconnues d'un texte (avertissement dans l'admin), sans doublon. */
export function unknownVariables(text) {
  const found = Array.from(text.matchAll(VARIABLE), (m) => m[1]).filter((n) => !isEmailVariable(n));
  return [...new Set(found)];
}

/** Coupe à `max` caractères (points de code : un emoji n'est pas coupé en deux). */
export function truncate(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** Date de l'événement en français, heure de Paris : « samedi 14 juin 2026 ». Vide si absente. */
export function formatEventDate(startDate) {
  if (typeof startDate !== 'string' || !startDate.trim()) return '';
  const value = startDate.trim();
  // Date seule : midi UTC, le même jour à Paris.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  }).formatToParts(date);
  return parts.map((p) => (p.type === 'day' && p.value === '1' ? '1er' : p.value)).join('');
}
