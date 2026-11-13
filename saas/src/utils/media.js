// Détection du type de média d'après l'extension du fichier / de l'URL.
// La lecture se fie à l'extension du fichier principal. La colonne photos.media_type (LAB-229) sert
// aux badges et aux filtres ; elle est écrite d'après cette même liste d'extensions (savePhoto,
// record-guest-photo, reprise de la migration 20261129000000).

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const HEIC_EXT  = /\.(heic|heif)$/i;

export function isVideoUrl(url) {
  return !!url && VIDEO_EXT.test(String(url).split('?')[0]);
}

/** Un enregistrement `photos` est une vidéo si son fichier principal en est une. */
export function isVideoPhoto(photo) {
  return isVideoUrl(photo?.storage_path ?? photo?.photo_url);
}

// Badge des formats animés de la borne (LAB-235), lu dans photos.media_type. Sans colonne (RPC pas
// encore à jour) ou pour une photo / vidéo ordinaire : pas de badge.
const ANIMATED_LABELS = { gif: 'GIF', boomerang: 'Boomerang' };

export function animatedMediaLabel(photo) {
  return ANIMATED_LABELS[photo?.media_type] ?? null;
}

export function isVideoFile(file) {
  return file.type.startsWith('video/') || VIDEO_EXT.test(file.name);
}

export function isHeicFile(file) {
  return file.type === 'image/heic' || file.type === 'image/heif' || HEIC_EXT.test(file.name);
}

/** Convertit un fichier HEIC/HEIF en JPEG lisible par tous les navigateurs. */
export async function heicToJpeg(file) {
  const { default: heic2any } = await import('heic2any');
  const out  = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(out) ? out[0] : out;
  const name = file.name.replace(HEIC_EXT, '.jpg');
  return new File([blob], name, { type: 'image/jpeg' });
}

/** Extrait une vignette JPEG (poster) d'un fichier vidéo, best-effort. */
export function videoPoster(file, maxWidth = 800) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const done = (fn) => { if (settled) return; settled = true; URL.revokeObjectURL(objectUrl); fn(); };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      // Se placer légèrement après le début pour éviter une première frame noire.
      try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); } catch { /* ignore */ }
    };
    video.onseeked = () => done(() => {
      const width = video.videoWidth, height = video.videoHeight;
      if (!width || !height) { reject(new Error('Dimensions vidéo indisponibles')); return; }
      const ratio  = Math.min(1, maxWidth / width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(width  * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve({ blob, width, height }), 'image/jpeg', 0.75);
    });
    video.onerror = () => done(() => reject(new Error('Lecture vidéo impossible')));
    video.src = objectUrl;
  });
}
