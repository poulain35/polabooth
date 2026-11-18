import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import {
  ADMIN_UI_CLASS, PREFERS_DARK_QUERY, THEME_STORAGE_KEY, isAdminAreaPath, isAdminUiPath, isImmersiveEditorPath,
  isThemeChoice, isThemedPath, readThemeChoice, resolveTheme, writeThemeChoice,
} from '../lib/theme';

// Mode sombre de l'admin (LAB-340) : la classe `dark` de <html> n'existe que le temps où un AdminLayout
// est monté. Thème de l'admin (LAB-363) : la classe `admin-ui` suit l'adresse seule, écrans d'accès et
// pages sans menu compris. Règles pures dans lib/theme.js ; le script de index.html pose les deux classes
// avant le premier rendu.

let mountedLayouts = 0;
let releaseTimer = null;

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function setDarkClass(isDark) {
  document.documentElement.classList.toggle('dark', isDark);
}

/**
 * À chaque navigation (App.jsx) : pose ou retire `admin-ui` selon l'adresse, et retire la classe `dark`
 * posée par le script de index.html quand aucun menu ne la reprend (ex. page admin ouverte sans session,
 * renvoyée vers la connexion).
 */
export function releaseStaleAdminTheme(pathname) {
  document.documentElement.classList.toggle(ADMIN_UI_CLASS, isAdminUiPath(pathname));
  if (mountedLayouts === 0 && !isThemedPath(pathname)) setDarkClass(false);
}

function subscribePrefersDark(onChange) {
  let mql;
  try {
    mql = window.matchMedia?.(PREFERS_DARK_QUERY);
  } catch {
    mql = null;
  }
  if (!mql) return () => {};
  if (mql.addEventListener) {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener?.(onChange);
  return () => mql.removeListener?.(onChange);
}

function prefersDarkSnapshot() {
  try {
    return !!window.matchMedia?.(PREFERS_DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Préférence du système, suivie en direct (changement de thème de Windows sans recharger). */
function usePrefersDark() {
  return useSyncExternalStore(subscribePrefersDark, prefersDarkSnapshot, () => false);
}

/**
 * Thème de l'admin : choix enregistré sur l'appareil, thème réel, et pose de la classe `dark` sur
 * <html> tant que le composant (AdminLayout) est monté ; retirée en quittant l'admin et dans les
 * éditeurs plein écran (`pathname` : adresse courante), qui restent clairs.
 */
export function useAdminTheme(pathname) {
  const [choice, setChoiceState] = useState(() => readThemeChoice(safeLocalStorage()));
  const prefersDark = usePrefersDark();
  const resolved = resolveTheme(choice, prefersDark);

  useLayoutEffect(() => {
    mountedLayouts += 1;
    clearTimeout(releaseTimer);
    return () => {
      mountedLayouts -= 1;
      if (mountedLayouts > 0) return;
      // Vers une autre page de l'admin (ex. demande ouverte avec le menu, qui lit d'abord la session) :
      // le menu suivant reprend la classe, on attend un peu pour éviter un éclair clair.
      if (isAdminAreaPath(window.location.pathname)) {
        releaseTimer = setTimeout(() => { if (mountedLayouts === 0) setDarkClass(false); }, 400);
      } else {
        setDarkClass(false);
      }
    };
  }, []);

  const editor = isImmersiveEditorPath(pathname);
  useLayoutEffect(() => { setDarkClass(resolved === 'dark' && !editor); }, [resolved, editor]);

  // Choix changé dans un autre onglet.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === THEME_STORAGE_KEY) setChoiceState(readThemeChoice(safeLocalStorage()));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setChoice = useCallback((next) => {
    if (!isThemeChoice(next)) return;
    writeThemeChoice(safeLocalStorage(), next);
    setChoiceState(next);
  }, []);

  return { choice, setChoice, resolved };
}

function htmlIsDark() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function subscribeHtmlClass(onChange) {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** Thème réellement affiché ('dark' seulement dans l'admin en sombre), pour les composants hors du menu. */
export function useDocumentTheme() {
  return useSyncExternalStore(subscribeHtmlClass, () => (htmlIsDark() ? 'dark' : 'light'), () => 'light');
}
