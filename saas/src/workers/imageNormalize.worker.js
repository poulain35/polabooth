// Web worker de normalisation d'images invité.
// Reçoit un Blob (image quelconque, y compris HEIC si le navigateur sait le décoder)
// et renvoie { full, thumb, width, height } en JPEG uniquement.
//
// - Décodage + orientation EXIF : createImageBitmap({ imageOrientation: 'from-image' }).
//   Redresse automatiquement les photos iPhone/Android sans lire manuellement l'EXIF.
// - Resize côté max ~3000 px, compression JPEG ~0.85, vignette ~400 px.
// - HEIC : on tente createImageBitmap ; si le navigateur ne sait pas décoder (cas
//   fréquent hors Safari), on renvoie { needsHeicFallback: true } pour que le main
//   thread convertisse via heic2any puis relance la normalisation sur le JPEG obtenu.

const MAX_SIDE = 3000;
const THUMB_SIDE = 400;
const FULL_QUALITY = 0.85;
const THUMB_QUALITY = 0.7;

async function bitmapFromBlob(blob) {
  return await createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function targetSize(w, h, maxSide) {
  const ratio = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.round(w * ratio), h: Math.round(h * ratio) };
}

async function encode(bitmap, maxSide, quality) {
  const { w, h } = targetSize(bitmap.width, bitmap.height, maxSide);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await canvas.convertToBlob({ type: 'image/jpeg', quality });
}

self.onmessage = async (e) => {
  const { id, blob, isHeic } = e.data;
  try {
    let bitmap;
    try {
      bitmap = await bitmapFromBlob(blob);
    } catch (err) {
      // Le navigateur ne sait pas décoder ce blob (typiquement HEIC hors Safari).
      if (isHeic) {
        self.postMessage({ id, needsHeicFallback: true });
        return;
      }
      throw err;
    }

    const width = bitmap.width;
    const height = bitmap.height;
    const [full, thumb] = await Promise.all([
      encode(bitmap, MAX_SIDE, FULL_QUALITY),
      encode(bitmap, THUMB_SIDE, THUMB_QUALITY),
    ]);
    bitmap.close?.();

    self.postMessage({ id, full, thumb, width, height });
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? 'Normalisation impossible' });
  }
};
