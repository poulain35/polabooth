// Pipeline de normalisation d'une image invité → JPEG (full + vignette).
//
// Objectif : robustesse cross-mobile. Un HEIC iPhone doit ressortir en JPEG visible
// par tous les invités, orientation EXIF corrigée, poids maîtrisé.
//
// Stratégie :
//   1. Worker (OffscreenCanvas) : décodage + orientation + resize + compression + vignette.
//   2. HEIC non décodable par le navigateur → conversion heic2any (import dynamique,
//      chargé seulement si besoin) puis nouvelle passe dans le worker.
//   3. Repli sans worker (OffscreenCanvas indisponible) → browser-image-compression
//      + vignette générée sur le thread principal.
//
// On n'uploade QUE du JPEG.

import { isHeicFile } from './media';

const MAX_SIDE = 3000;
const THUMB_SIDE = 400;
const FULL_QUALITY = 0.85;
const THUMB_QUALITY = 0.7;

let _worker = null;
let _seq = 0;
const _pending = new Map();

function getWorker() {
  if (_worker) return _worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  _worker = new Worker(new URL('../workers/imageNormalize.worker.js', import.meta.url), { type: 'module' });
  _worker.onmessage = (e) => {
    const { id } = e.data;
    const entry = _pending.get(id);
    if (!entry) return;
    _pending.delete(id);
    entry.resolve(e.data);
  };
  _worker.onerror = () => {
    for (const entry of _pending.values()) entry.reject(new Error('Worker de normalisation en erreur'));
    _pending.clear();
    _worker = null;
  };
  return _worker;
}

function runInWorker(blob, isHeic) {
  const worker = getWorker();
  if (!worker) return Promise.reject(new Error('worker-unavailable'));
  const id = ++_seq;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    worker.postMessage({ id, blob, isHeic });
  });
}

async function heicToJpegBlob(blob) {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}

// Repli principal-thread : compression via browser-image-compression + vignette canvas.
async function fallbackNormalize(blob) {
  const { default: imageCompression } = await import('browser-image-compression');
  const inputFile = blob instanceof File ? blob : new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });

  const fullFile = await imageCompression(inputFile, {
    maxWidthOrHeight: MAX_SIDE,
    initialQuality: FULL_QUALITY,
    useWebWorker: true,
    fileType: 'image/jpeg',
  });

  const thumbFile = await imageCompression(inputFile, {
    maxWidthOrHeight: THUMB_SIDE,
    initialQuality: THUMB_QUALITY,
    useWebWorker: true,
    fileType: 'image/jpeg',
  });

  const dims = await imageDimensions(fullFile);
  return { full: fullFile, thumb: thumbFile, width: dims.width, height: dims.height };
}

function imageDimensions(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: null, height: null }); };
    img.src = url;
  });
}

/**
 * Normalise une image invité en JPEG.
 * @returns {Promise<{ full: Blob, thumb: Blob, width: number|null, height: number|null }>}
 */
export async function normalizeGuestImage(file) {
  const heic = isHeicFile(file);

  try {
    const res = await runInWorker(file, heic);
    if (res.needsHeicFallback) {
      const jpeg = await heicToJpegBlob(file);
      const res2 = await runInWorker(jpeg, false);
      if (res2.error) throw new Error(res2.error);
      return { full: res2.full, thumb: res2.thumb, width: res2.width, height: res2.height };
    }
    if (res.error) throw new Error(res.error);
    return { full: res.full, thumb: res.thumb, width: res.width, height: res.height };
  } catch {
    // Repli sans worker : convertit d'abord le HEIC si nécessaire, puis compresse.
    const source = heic ? await heicToJpegBlob(file) : file;
    return await fallbackNormalize(source);
  }
}
