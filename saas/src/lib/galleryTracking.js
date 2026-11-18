// LAB-232 (spec LAB-209, SAAS-1) : suivi de la galerie publique.
// - Lien du QR code de la borne : `/photos/{code}?photo={id}&via=qr`. La galerie transmet `via` et
//   `photo` à get-photos au premier chargement seulement, qui compte l'ouverture côté serveur.
// - L'admin connecté propriétaire de l'événement n'est pas compté (track_gallery_event).
// Pur, sans import Supabase : testé par galleryTracking.test.js.

const QR_VIA = 'qr';

/** { via, photo } d'un lien de QR code, sinon {} (galerie ouverte autrement). */
export function qrLinkParams(searchParams) {
  const via = searchParams?.get?.('via');
  const photo = searchParams?.get?.('photo');
  return via === QR_VIA && photo ? { via, photo } : {};
}

/** URL de get-photos ; `via` et `photo` seulement s'ils sont fournis ensemble. */
export function getPhotosUrl(functionsUrl, code, link = {}) {
  const qs = new URLSearchParams({ code });
  if (link.via && link.photo) {
    qs.set('photo', link.photo);
    qs.set('via', link.via);
  }
  return `${functionsUrl}/get-photos?${qs}`;
}

/**
 * Renvoie isOwner(code) → Promise<boolean>, qui ne rejette jamais.
 * Sans session : false (invité, compté). Avec session : true si l'événement du code est visible par
 * la RLS propriétaire, ou si la vérification échoue (une session admin est ouverte : dans le doute,
 * on ne compte pas). Résultat gardé par utilisateur et par code.
 */
export function createGalleryOwnerCheck({ getUserId, ownsEventByCode }) {
  const cache = new Map();
  return async function isOwner(code) {
    let userId;
    try { userId = await getUserId(); } catch { return true; }
    if (!userId) return false;
    const key = `${userId}:${code}`;
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => ownsEventByCode(code)).then((owns) => owns !== false, () => true));
    return cache.get(key);
  };
}
