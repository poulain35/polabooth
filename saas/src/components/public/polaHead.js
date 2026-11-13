import { useEffect } from 'react';
import { POLA_FONTS_HREF } from './polaStyles.js';

function ensureMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  const previous = el ? el.getAttribute('content') : null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (previous === null) el.remove();
    else el.setAttribute('content', previous);
  };
}

/**
 * Charge une seule fois une feuille de polices du site (par défaut DM Sans + Cormorant ; le bilan
 * client charge Fraunces), sans Referer vers Google.
 */
export function ensurePolaFonts(sheetHref = POLA_FONTS_HREF) {
  const sheets = [...document.head.querySelectorAll('link[data-pola-fonts][rel="stylesheet"]')];
  if (sheets.some((l) => l.getAttribute('href') === sheetHref)) return;
  if (!document.head.querySelector('link[data-pola-fonts][rel="preconnect"]')) {
    for (const [href, cross] of [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]]) {
      const pre = document.createElement('link');
      pre.rel = 'preconnect';
      pre.href = href;
      if (cross) pre.crossOrigin = 'anonymous';
      pre.setAttribute('data-pola-fonts', '');
      document.head.appendChild(pre);
    }
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = sheetHref;
  link.referrerPolicy = 'no-referrer';
  link.setAttribute('data-pola-fonts', '');
  document.head.appendChild(link);
}

/**
 * En-tête des pages client publiques : langue fr, titre, polices du site (DM Sans + Cormorant),
 * et pour la page à jeton : noindex + no-referrer (le jeton est dans l'URL, il ne doit fuiter
 * ni vers les moteurs ni vers un site tiers via l'en-tête Referer).
 */
export function usePolaPublicHead(title, { privatePage = false, fontsHref = POLA_FONTS_HREF } = {}) {
  useEffect(() => {
    const cleanups = [];
    if (privatePage) {
      cleanups.push(ensureMeta('referrer', 'no-referrer'));
      cleanups.push(ensureMeta('robots', 'noindex,nofollow'));
    }
    ensurePolaFonts(fontsHref);
    const prevLang = document.documentElement.lang;
    document.documentElement.lang = 'fr';
    return () => {
      cleanups.forEach((fn) => fn());
      document.documentElement.lang = prevLang;
    };
  }, [privatePage, fontsHref]);

  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}
