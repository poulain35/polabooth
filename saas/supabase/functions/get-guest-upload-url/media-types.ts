// Types de fichiers acceptés pour le dépôt des invités (LAB-392) : liste blanche d'images et de vidéos
// courantes, extension du nom de fichier cohérente avec le type MIME annoncé (même famille).
// Le type est ensuite lié à la signature de l'URL présignée : le stockage refuse un autre Content-Type.
// Extensions vidéo : mêmes que src/utils/media.js et record-guest-photo (media_type).
// Pur, sans import Deno : testé par media-types.test.ts sous `node --test`.

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const VIDEO_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm']);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'mov', 'm4v', 'webm']);

export type GuestMedia =
  | { ok: true; kind: 'image' | 'video'; ext: string }
  | { ok: false };

/** Extension du nom de fichier, en minuscules ; null sans point ou après le dernier point vide. */
export function fileExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Type de média accepté ? Le type MIME doit être dans la liste blanche et l'extension dans la liste de
 * la même famille (une vidéo .mov annoncée video/mp4 passe : le navigateur ne donne pas toujours le type
 * exact ; une image annoncée avec une extension vidéo, non).
 */
export function classifyGuestMedia(contentType: string, filename: string): GuestMedia {
  const type = contentType.trim().toLowerCase();
  const ext = fileExtension(filename);
  if (!ext) return { ok: false };
  if (IMAGE_TYPES.has(type) && IMAGE_EXTENSIONS.has(ext)) return { ok: true, kind: 'image', ext };
  if (VIDEO_TYPES.has(type) && VIDEO_EXTENSIONS.has(ext)) return { ok: true, kind: 'video', ext };
  return { ok: false };
}
