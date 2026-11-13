// Lecture publique des photos d'un événement par code d'accès (LAB-114).
// La clé anon n'a plus de SELECT sur `photos` : galerie, diaporama et aperçu Open Graph passent par
// la RPC SECURITY DEFINER `get_public_photos(p_code, p_limit)`, qui ne renvoie que les photos
// approuvées d'un événement actif.

export const PUBLIC_PHOTOS_RPC = 'get_public_photos';

/** Normalise la réponse de la RPC (tableau vide si code inconnu ou réponse inattendue). */
export function parsePublicPhotos(data) {
  if (!Array.isArray(data)) return [];
  return data.filter((p) => p && typeof p === 'object' && p.id);
}

/** Ajoute à chaque photo son download_url (presigned get-photos), à défaut photo_url. */
export function withDownloadUrls(photos, downloadUrls = {}) {
  return photos.map((p) => ({ ...p, download_url: downloadUrls[p.id] ?? p.photo_url }));
}
