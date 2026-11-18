// Images des modèles rangées dans le stockage (LAB-348). Module pur (sans DOM ni Supabase) :
// utilisé par l'éditeur, par l'envoi des designs et par scripts/convert-design-images.mjs.
//
// Avant : une photo importée, une décoration SVG, une image détourée ou teinte était intégrée au
// JSON en data URL (plusieurs Mo par image). Désormais elle part dans le bucket `designs`
// (fonction upload-design-image, nom = SHA-256 du contenu) et `canvas_json` ne garde que son
// adresse https. Les fonds générés par l'IA (adresse Replicate, expirée au bout d'une heure) sont
// rangés de la même façon. Si l'envoi échoue, l'image reste intégrée : rien n'est perdu.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Data URL d'image (`data:image/...`). */
export function isDataImage(src) {
  return typeof src === 'string' && /^data:image\//i.test(src);
}

/** Adresse temporaire d'un fichier généré par Replicate (fond IA, détourage) : expire vite. */
export function isEphemeralImageUrl(src) {
  if (typeof src !== 'string' || !/^https?:\/\//i.test(src)) return false;
  try {
    const host = new URL(src).hostname.toLowerCase();
    return host === 'replicate.delivery' || host.endsWith('.replicate.delivery');
  } catch {
    return false;
  }
}

/** Image à ranger dans le stockage : intégrée (data URL) ou adresse temporaire. */
export function needsStorage(src) {
  return isDataImage(src) || isEphemeralImageUrl(src);
}

/** Parcourt les objets d'un état d'éditeur, groupes et masques (clipPath) compris. */
function walkDesignObjects(objects, visit) {
  for (const o of Array.isArray(objects) ? objects : []) {
    if (!isObject(o)) continue;
    visit(o);
    walkDesignObjects(o.objects, visit);
    if (isObject(o.clipPath)) walkDesignObjects([o.clipPath], visit);
  }
}

/** Sources d'images à ranger (data URL ou adresse temporaire), groupes compris, sans doublon. */
export function imageSourcesToStore(state) {
  const found = new Set();
  walkDesignObjects(state?.objects, (o) => {
    if (needsStorage(o.src)) found.add(o.src);
  });
  return [...found];
}

/**
 * Copie de l'état où chaque source connue de `lookup` (Map, objet ou fonction src → adresse) est
 * remplacée par son adresse, avec `crossOrigin: 'anonymous'` : sans lui, l'image chargée depuis
 * le stockage « salit » le canvas et l'export PNG échoue. Les sources inconnues restent telles quelles.
 */
export function replaceImageSources(state, lookup) {
  const get = typeof lookup === 'function'
    ? lookup
    : (src) => (lookup instanceof Map ? lookup.get(src) : lookup?.[src]);
  const copy = (o) => {
    if (!isObject(o)) return o;
    const next = { ...o };
    const url = typeof o.src === 'string' ? get(o.src) : null;
    if (url) {
      next.src = url;
      next.crossOrigin = 'anonymous';
    }
    if (Array.isArray(o.objects)) next.objects = o.objects.map(copy);
    if (isObject(o.clipPath)) next.clipPath = copy(o.clipPath);
    return next;
  };
  return { ...state, objects: (Array.isArray(state?.objects) ? state.objects : []).map(copy) };
}

/**
 * Objets prêts à charger : `crossOrigin: 'anonymous'` sur toute image distante (http/https),
 * groupes et masques compris. Fabric lit `crossOrigin` à chaque niveau ; à poser avant le
 * chargement (le reviver passe trop tard, l'image est déjà en route).
 */
export function withCrossOrigin(objects) {
  const copy = (o) => {
    if (!isObject(o)) return o;
    let next = o;
    if (typeof o.src === 'string' && /^https?:\/\//i.test(o.src) && o.crossOrigin !== 'anonymous') {
      next = { ...next, crossOrigin: 'anonymous' };
    }
    if (Array.isArray(o.objects)) next = { ...next, objects: o.objects.map(copy) };
    if (isObject(o.clipPath)) next = { ...next, clipPath: copy(o.clipPath) };
    return next;
  };
  return (Array.isArray(objects) ? objects : []).map(copy);
}

/** Octets et type d'une data URL base64 (ou URL-encodée). */
export function dataUrlToBytes(dataUrl) {
  const m = String(dataUrl ?? '').match(/^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/is);
  if (!m) throw new Error('Data URL invalide');
  const mime = (m[1] || 'application/octet-stream').toLowerCase();
  if (m[3]) {
    const bin = atob(m[4].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(m[4])), mime };
}

/** Types acceptés par le stockage (upload-design-image vérifie les premiers octets). */
export const STORABLE_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

/** Taille maximale d'une image rangée (même valeur que MAX_IMAGE_BYTES côté serveur). */
const MAX_STORED_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Au-delà de ce poids, une photo importée est réencodée même sans être réduite : une photo de
 * téléphone de 8 Mo n'apporte rien de plus à l'impression qu'un JPEG de qualité 0,92.
 */
export const PHOTO_KEEP_MAX_BYTES = 8 * 1024 * 1024;

/** Qualité JPEG des photos réencodées. */
export const PHOTO_JPEG_QUALITY = 0.92;

/**
 * Plus grand côté utile d'une image d'un format : sa résolution d'export (3600 px pour 10×15, 1920
 * pour l'écran d'accueil). Une image plus grande serait réduite à l'export de toute façon.
 */
export function maxImagePx(format) {
  return Math.max(Number(format?.exportWidth) || 0, Number(format?.exportHeight) || 0) || 3600;
}

/**
 * Que faire d'une photo importée avant de l'ajouter au modèle :
 * - `keep` : fichier d'origine gardé tel quel (PNG/JPEG/WebP, pas trop grand ni trop lourd) ;
 * - sinon réencodage à `width`×`height` en `type` : le JPEG reste JPEG, le reste devient PNG
 *   s'il peut être transparent (`hasAlpha`), JPEG sinon.
 */
export function planPhotoEncoding({ type, size, width, height, maxPx, hasAlpha = true }) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const limit = Math.max(1, Math.round(Number(maxPx) || 3600));
  const ratio = Math.min(1, limit / Math.max(w, h));
  const resize = ratio < 1;
  const storable = STORABLE_IMAGE_TYPES.includes(String(type ?? '').toLowerCase());
  if (!resize && storable && Number(size) <= PHOTO_KEEP_MAX_BYTES) {
    return { keep: true, width: w, height: h, type: String(type).toLowerCase() };
  }
  const outType = String(type ?? '').toLowerCase() === 'image/jpeg' || !hasAlpha ? 'image/jpeg' : 'image/png';
  return {
    keep: false,
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    type: outType,
  };
}

/**
 * Magasin d'images d'un éditeur : chaque source (data URL ou adresse temporaire) n'est envoyée
 * qu'une fois, même si plusieurs sauvegardes la demandent en même temps.
 *
 * - `upload(bytes, mime)` → adresse https (lève en cas d'échec) ;
 * - `fetchBytes(url)` → { bytes, mime } pour une adresse temporaire ;
 * - un échec n'est pas retenu : la source sera réessayée à la prochaine sauvegarde ;
 * - `retries` : nouvel essai immédiat après un échec (1 par défaut).
 */
export function createImageStore({ upload, fetchBytes = null, retries = 1, concurrency = 3 }) {
  const done = new Map();     // src → adresse
  const pending = new Map();  // src → Promise<adresse | null>
  let running = 0;
  const queue = [];

  const runLimited = (task) => new Promise((resolve) => {
    const start = () => {
      running++;
      Promise.resolve().then(task).then(resolve, () => resolve(null)).finally(() => {
        running--;
        queue.shift()?.();
      });
    };
    if (running < concurrency) start();
    else queue.push(start);
  });

  async function send(src) {
    const { bytes, mime } = isDataImage(src) ? dataUrlToBytes(src) : await fetchBytes(src);
    if (!STORABLE_IMAGE_TYPES.includes(mime)) throw new Error(`Type non pris en charge : ${mime}`);
    if (bytes.length > MAX_STORED_IMAGE_BYTES) throw new Error('Image trop lourde');
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await upload(bytes, mime);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  /** Adresse rangée de `src`, ou null si l'envoi a échoué (l'image reste intégrée). */
  function store(src) {
    if (!needsStorage(src)) return Promise.resolve(null);
    if (isEphemeralImageUrl(src) && !fetchBytes) return Promise.resolve(null);
    if (done.has(src)) return Promise.resolve(done.get(src));
    if (pending.has(src)) return pending.get(src);
    const p = runLimited(async () => {
      try {
        const url = await send(src);
        if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('Adresse invalide');
        done.set(src, url);
        return url;
      } catch (err) {
        console.warn('Image non rangée dans le stockage (gardée intégrée) :', err?.message ?? err);
        return null;
      } finally {
        pending.delete(src);
      }
    });
    pending.set(src, p);
    return p;
  }

  return {
    store,
    /** Adresse déjà rangée de `src`, sans envoi. */
    lookup: (src) => done.get(src) ?? null,
    /** Lance l'envoi des sources sans attendre (ajout d'une image dans l'éditeur). */
    prefetch(sources) {
      for (const src of sources ?? []) store(src);
    },
    /**
     * Range les images de l'état puis renvoie `{ state, failed }` : l'état avec les adresses, et
     * le nombre d'images restées intégrées faute d'envoi.
     */
    async resolveState(state) {
      const sources = imageSourcesToStore(state);
      if (!sources.length) return { state, failed: 0 };
      const urls = await Promise.all(sources.map(store));
      const map = new Map(sources.map((src, i) => [src, urls[i]]).filter(([, url]) => url));
      return { state: replaceImageSources(state, map), failed: sources.length - map.size };
    },
  };
}
