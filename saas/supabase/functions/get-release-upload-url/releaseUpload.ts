// Validation et chemin de l'installeur PolaKiosk publié depuis Parc kiosk (LAB-269).
// Sans import Deno/esm.sh : testé par get-release-upload-url.test.ts sous `node --test`.

// L'admin envoie le fichier juste après avoir demandé l'URL ; 15 min couvrent une connexion lente.
export const UPLOAD_URL_TTL_SECONDS = 900;
// L'installeur fait environ 100 Mo ; R2 accepte jusqu'à 5 Gio en un seul PUT, la limite est la nôtre.
export const MAX_RELEASE_BYTES = 500 * 1024 * 1024;
export const RELEASE_CONTENT_TYPE = 'application/octet-stream';

const VERSION = /^\d+\.\d+\.\d+$/;

export interface ReleaseUploadBody {
  version?: unknown;
  content_length?: unknown;
}

export type ReleaseUpload =
  | { ok: true; version: string; storagePath: string; contentType: string; contentLength: number }
  | { ok: false; status: number; error: string };

/** Clé d'objet de l'installeur d'une version : une seule par version, republier l'écrase. */
export function releaseStoragePath(version: string): string {
  return `releases/setup-polakiosk-${version}.exe`;
}

export function resolveReleaseUpload(body: ReleaseUploadBody): ReleaseUpload {
  const version = typeof body.version === 'string' ? body.version.trim() : '';
  if (!VERSION.test(version)) {
    return { ok: false, status: 400, error: 'Version invalide (format attendu : 1.2.3).' };
  }
  const contentLength = body.content_length;
  if (typeof contentLength !== 'number' || !Number.isInteger(contentLength) || contentLength <= 0) {
    return { ok: false, status: 400, error: 'content_length (taille du fichier en octets) est requis.' };
  }
  if (contentLength > MAX_RELEASE_BYTES) {
    return { ok: false, status: 413, error: 'Installeur trop lourd (500 Mo au maximum).' };
  }
  return {
    ok: true,
    version,
    storagePath: releaseStoragePath(version),
    contentType: RELEASE_CONTENT_TYPE,
    contentLength,
  };
}
