// Polices de la borne pour l'éditeur des écrans composés (LAB-296) : Fraunces 72pt SuperSoft
// SemiBold (opsz 72, SOFT 100, wght 600, WONK 1) et DM Sans 400 à 700, comme PolaKiosk. Chargées à
// la demande (l'éditeur du client n'en a pas besoin). WONK 1 : l'instance statique de la borne a
// les glyphes « wonky » (« & » 29 % plus large) ; sans lui, l'aperçu tenait un nom sur une ligne
// que la borne passait à deux (LAB-310).

import { liveFont } from '../lib/kioskScreenLayout';
import { fetchCustomFonts, registerCustomFonts } from '../lib/supabase';

const KIOSK_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@72,600,100,1&family=DM+Sans:wght@400;500;600;700&display=swap';

let loading = null;

/** Charge les polices de la borne une seule fois ; se résout quand elles sont prêtes (ou en échec). */
export function ensureKioskFonts() {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(); return; }
    const done = () => {
      Promise.allSettled([
        document.fonts.load('600 16px "Fraunces"'),
        ...[400, 500, 600, 700].map((w) => document.fonts.load(`${w} 16px "DM Sans"`)),
      ]).then(() => resolve());
    };
    const existing = document.querySelector('link[data-kiosk-fonts]');
    if (existing) { done(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = KIOSK_FONTS_HREF;
    link.dataset.kioskFonts = '1';
    link.onload = done;
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  return loading;
}

const liveLoads = new Map();

/**
 * Charge la police d'un texte vivant (LAB-331), à la graisse que la borne utilisera : Fraunces et
 * DM Sans comme ci-dessus ; une police importée par son fichier (`registerCustomFonts`, puis chargée à la graisse voulue) ; une police
 * Google par sa feuille à cette graisse, sinon à la graisse par défaut (comme google-font-file).
 * `fontFile` en http(s) (plan publié) : ce fichier même, celui que télécharge la borne.
 * Se résout toujours, même si la police n'a pas pu être chargée.
 */
export function loadLiveFont(family, weight, fontFile = null) {
  const font = liveFont(family, weight, fontFile || 'fichier');
  if (font.font_file === null) return ensureKioskFonts();
  const url = typeof fontFile === 'string' && /^https?:\/\//i.test(fontFile) ? fontFile : null;
  const key = `${font.font}|${font.weight}|${url ?? ''}`;
  if (!liveLoads.has(key)) liveLoads.set(key, loadFont(font.font, font.weight, url));
  return liveLoads.get(key);
}

async function loadFont(family, weight, url) {
  if (typeof document === 'undefined') return;
  if (url) {
    try {
      const face = new FontFace(family, `url("${url}")`, { weight: String(weight) });
      await face.load();
      document.fonts.add(face);
      return;
    } catch (_) { /* fichier illisible : la police par son nom, comme dans l'éditeur */ }
  }
  const custom = await fetchCustomFonts().catch(() => []);
  if (custom.some((f) => f.name === family)) await registerCustomFonts().catch(() => {});
  else await addGoogleSheet(family, weight);
  try { await document.fonts.load(`${weight} 40px "${family}"`); } catch (_) {}
}

function addGoogleSheet(family, weight) {
  const name = encodeURIComponent(family).replace(/%20/g, '+');
  const sheet = (href) => new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(true);
    // Graisse absente de la famille (ex. Pacifico 700) : Google répond 400.
    link.onerror = () => { link.remove(); resolve(false); };
    document.head.appendChild(link);
  });
  return sheet(`https://fonts.googleapis.com/css2?family=${name}:wght@${weight}&display=swap`)
    .then((ok) => ok || sheet(`https://fonts.googleapis.com/css2?family=${name}&display=swap`));
}
