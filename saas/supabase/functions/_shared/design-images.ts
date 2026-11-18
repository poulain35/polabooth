// Images des modèles rangées dans le stockage (LAB-348) : upload-design-image et remove-background.
// Sans import Deno/esm.sh : testé par design-images.test.ts sous `node --test`.
//
// Une image ajoutée à un modèle (photo importée, décoration, image détourée, fond IA) est rangée
// dans le bucket public `designs` sous un nom tiré de son contenu (SHA-256) : la même image envoyée
// deux fois n'est stockée qu'une fois, et `canvas_json` ne garde que son adresse https.

export const DESIGN_IMAGES_BUCKET = 'designs';

/**
 * Taille maximale d'une image. Le front réduit les photos à la résolution d'export du format
 * (3600 px au plus grand côté) avant l'envoi : une photo JPEG y fait 2 à 5 Mo, un PNG transparent
 * rarement plus de 10 Mo. Au-delà, l'éditeur garde l'image embarquée (repli).
 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type ImageType = { ext: 'png' | 'jpg' | 'webp'; contentType: string };

/** Type d'image d'après les premiers octets (PNG, JPEG, WebP), jamais d'après l'en-tête annoncé. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

/**
 * Où ranger l'image :
 * - modèle d'un client (code d'événement) : `{event_id}/images/{sha256}.{ext}`, à côté des PNG
 *   soumis de l'événement (`{event_id}/...`) ;
 * - modèle de la bibliothèque (admin) : `templates/images/{sha256}.{ext}`. Les modèles sont
 *   globaux (table `templates` sans événement ni organisation, réservée aux administrateurs de
 *   l'application) : un seul dossier commun, qui ne peut pas croiser un identifiant d'événement ;
 * - aperçu d'un modèle de la bibliothèque (`templates.preview_url`, LAB-356) :
 *   `templates/previews/{sha256}.{ext}`.
 *
 * Ces dossiers `images/` et `previews/` sont les seuls que le ménage quotidien
 * (design-images-cleanup) peut vider.
 */
export type ImageScope = { kind: 'event'; eventId: string } | { kind: 'templates' } | { kind: 'templatePreviews' };

export function designImagePath(scope: ImageScope, sha256: string, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Empreinte SHA-256 invalide');
  if (!/^(png|jpg|webp)$/.test(ext)) throw new Error('Extension invalide');
  if (scope.kind === 'event') {
    if (!/^[0-9a-f-]{36}$/i.test(scope.eventId)) throw new Error('Identifiant d’événement invalide');
    return `${scope.eventId.toLowerCase()}/images/${sha256}.${ext}`;
  }
  if (scope.kind === 'templatePreviews') return `templates/previews/${sha256}.${ext}`;
  return `templates/images/${sha256}.${ext}`;
}

/** Empreinte SHA-256 en hexadécimal (Web Crypto : Deno et Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Erreur du stockage « le fichier existe déjà » : même nom = même contenu, donc un succès. */
export function isAlreadyExistsError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown; error?: unknown };
  if (String(e.statusCode ?? e.status ?? '') === '409') return true;
  return /already exists|duplicate/i.test(`${e.message ?? ''} ${e.error ?? ''}`);
}

export type StoredImage = { url: string; path: string; sha256: string; bytes: number; contentType: string };

// Sous-ensemble du client supabase-js utilisé ici.
// deno-lint-ignore no-explicit-any
type StorageDb = { storage: { from: (bucket: string) => any } };

/**
 * Vérifie puis range une image ; renvoie son adresse publique. Erreurs (type, taille, stockage)
 * levées avec un message en français. Idempotent : un envoi répété renvoie la même adresse.
 */
export async function storeDesignImage(db: StorageDb, scope: ImageScope, bytes: Uint8Array): Promise<StoredImage> {
  if (!bytes.length) throw new DesignImageError(400, 'Image vide');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new DesignImageError(413, `Image trop lourde (${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo au plus)`);
  }
  const type = detectImageType(bytes);
  if (!type) throw new DesignImageError(415, 'Format d’image non pris en charge (PNG, JPEG ou WebP)');

  const sha256 = await sha256Hex(bytes);
  const path = designImagePath(scope, sha256, type.ext);
  const bucket = db.storage.from(DESIGN_IMAGES_BUCKET);
  const { error } = await bucket.upload(path, bytes, {
    contentType: type.contentType,
    // Nom tiré du contenu : le fichier ne change jamais, il peut rester en cache un an.
    cacheControl: '31536000',
    // Réécrit le même contenu si l'image existe déjà : sa date de mise à jour repart de zéro, et le
    // ménage (design-images-cleanup, fichiers de plus de 7 jours) ne l'efface pas avant que le modèle
    // qui la reprend soit enregistré (LAB-356).
    upsert: true,
  });
  if (error && !isAlreadyExistsError(error)) {
    // Détail du stockage en journal seulement : le message part tel quel au client (LAB-392).
    console.error('design-images : stockage de l’image impossible', error);
    throw new DesignImageError(500, 'Stockage de l’image impossible, réessayez dans un instant.');
  }
  const { data } = bucket.getPublicUrl(path);
  return { url: data.publicUrl, path, sha256, bytes: bytes.length, contentType: type.contentType };
}

export class DesignImageError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
