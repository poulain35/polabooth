// Mode clair / sombre de l'admin (LAB-340, spec refonte-navigation-admin, L6). Logique pure, testée
// dans theme.test.js. Le script en ligne de index.html (contre le flash au chargement) applique la même
// règle de chemin et la même lecture du choix : le test vérifie qu'ils restent alignés.

/** Clé du choix dans localStorage (un choix par appareil). */
export const THEME_STORAGE_KEY = 'pola-admin-theme';

/** Choix proposés dans le menu du compte, dans l'ordre d'affichage. */
export const THEME_CHOICES = ['light', 'dark', 'system'];

export const THEME_LABELS = { light: 'Clair', dark: 'Sombre', system: 'Système' };

/** Sans choix enregistré (ou stockage illisible) : suit le système. */
export const DEFAULT_THEME_CHOICE = 'system';

export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Pages sous /admin qui restent claires : connexion et nouveau mot de passe (hors du menu), et les pages
 * de module ouvertes par lien signé (ex. décision sur une demande), qui peuvent s'afficher sans le menu ;
 * avec une session, le menu leur pose le thème à son montage.
 */
export const UNTHEMED_ADMIN_PATHS = ['/admin/login', '/admin/nouveau-mot-de-passe'];
const UNTHEMED_ADMIN_PREFIXES = ['/admin/demandes/'];

/**
 * Éditeurs plein écran (cadre photo de la Bibliothèque, écrans de la borne) : jamais en sombre, même sous
 * le menu. Leurs menus et fenêtres passent par des portails hors de tout `.light-island` et l'éditeur garde
 * ses couleurs claires (LAB-340).
 */
const IMMERSIVE_EDITOR_PATTERN = /^\/admin\/(templates\/(new|[^/]+\/edit)|ecrans-borne\/[^/]+)$/;

/** Vrai pour un éditeur plein écran de l'admin (reste clair). */
export function isImmersiveEditorPath(pathname) {
  if (typeof pathname !== 'string') return false;
  return IMMERSIVE_EDITOR_PATTERN.test(pathname.replace(/\/+$/, ''));
}

export function isThemeChoice(value) {
  return THEME_CHOICES.includes(value);
}

/** Choix enregistré ; stockage absent, qui jette ou valeur inconnue : Système. */
export function readThemeChoice(storage) {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(value) ? value : DEFAULT_THEME_CHOICE;
  } catch {
    return DEFAULT_THEME_CHOICE;
  }
}

/** Enregistre le choix ; renvoie false si le stockage manque ou refuse (navigation privée…). */
export function writeThemeChoice(storage, choice) {
  if (!isThemeChoice(choice) || !storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** Thème réel : 'dark' ou 'light'. Un choix inconnu vaut Système. */
export function resolveTheme(choice, prefersDark) {
  const c = isThemeChoice(choice) ? choice : DEFAULT_THEME_CHOICE;
  if (c === 'system') return prefersDark ? 'dark' : 'light';
  return c;
}

/** Vrai pour une page de l'admin sous le menu (la classe `dark` peut y être posée). */
export function isThemedPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p !== '/admin' && !p.startsWith('/admin/')) return false;
  if (UNTHEMED_ADMIN_PATHS.includes(p) || isImmersiveEditorPath(p)) return false;
  return !UNTHEMED_ADMIN_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Page de module qui s'affiche avec le menu quand une session existe (MaybeAdminLayout, ex. décision sur
 * une demande) : le script de index.html y pose le thème si une session Supabase est enregistrée, pour
 * éviter l'éclair clair le temps que le menu lise la session. Sans session, la page seule le retire.
 * La preuve d'acceptation (/admin/demandes/:id/preuve) reste hors du menu, donc claire.
 */
const SESSION_THEMED_PATTERN = /^\/admin\/demandes\/[^/]+$/;

/** Clé localStorage de la session Supabase (supabase-js v2 : `sb-<ref>-auth-token`). */
const SESSION_STORAGE_KEY_PATTERN = /^sb-.+-auth-token$/;

/** Vrai si une session Supabase est enregistrée sur l'appareil (peut être expirée ; jamais d'erreur). */
export function hasStoredSession(storage) {
  try {
    const n = Number(storage?.length) || 0;
    for (let i = 0; i < n; i += 1) {
      if (SESSION_STORAGE_KEY_PATTERN.test(String(storage.key(i)))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Vrai pour une page qui passe sous le menu quand une session existe (voir SESSION_THEMED_PATTERN). */
export function isSessionThemedPath(pathname) {
  if (typeof pathname !== 'string') return false;
  return SESSION_THEMED_PATTERN.test(pathname.replace(/\/+$/, ''));
}

/** Thème posé avant le premier rendu (miroir du script de index.html, vérifié par theme.test.js). */
export function bootThemeIsDark(pathname, storage, prefersDark) {
  const themed = isThemedPath(pathname) || (isSessionThemedPath(pathname) && hasStoredSession(storage));
  return themed && resolveTheme(readThemeChoice(storage), prefersDark) === 'dark';
}

/**
 * Thème de l'admin (LAB-363) : classe `admin-ui` de <html>, qui porte la palette et la police de l'admin.
 * Posée sur toute adresse de l'admin, écrans d'accès et éditeurs plein écran compris, et sur l'association
 * d'une borne (/associer), qui reste claire ; jamais sur une page client, page d'aide (/aide) comprise. La
 * preuve d'acceptation imprimable garde sa propre mise en page.
 */
export const ADMIN_UI_CLASS = 'admin-ui';
const ADMIN_UI_EXTRA_PATTERN = /^\/associer$/;
const ADMIN_UI_EXCLUDED_PATTERN = /^\/admin\/demandes\/[^/]+\/preuve$/;

/** Vrai pour une page qui porte le thème de l'admin (miroir du script de index.html, vérifié par theme.test.js). */
export function isAdminUiPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  if (ADMIN_UI_EXTRA_PATTERN.test(p)) return true;
  if (p !== '/admin' && !p.startsWith('/admin/')) return false;
  return !ADMIN_UI_EXCLUDED_PATTERN.test(p);
}

/** Vrai pour une adresse sous /admin hors connexion et nouveau mot de passe (le menu peut y revenir). */
export function isAdminAreaPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  return (p === '/admin' || p.startsWith('/admin/')) && !UNTHEMED_ADMIN_PATHS.includes(p);
}

/**
 * Vrai pour un écran du logiciel, qui affiche l'écran de chargement Polabooth : l'admin, la connexion, le
 * nouveau mot de passe, /associer. Jamais l'aide (/aide, /aide/:code, ouverte aussi par les clients), la
 * preuve d'acceptation imprimable ni une page client : elles gardent un chargement neutre.
 */
export function isProductScreenPath(pathname) {
  if (!isAdminUiPath(pathname)) return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  return !/^\/aide(\/|$)/.test(p);
}
