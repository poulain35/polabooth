// Liaison de l'envoi email kiosk (send-kiosk-photo) à un événement actif et à une photo de cet
// événement (LAB-113). Sans import Deno/esm.sh : testé par kiosk-photo.test.ts sous `node --test`.
//
// Depuis LAB-213, le kiosk envoie le montage sur R2 (get-kiosk-upload-url) puis l'enregistre par
// kiosk_record_photo avant de proposer l'email : la photo doit donc avoir sa ligne `photos`
// (event_id, photo_url = URL publique R2).

// Même filtre que kiosk_get_event : le kiosk ne charge que ces événements.
export const ACTIVE_EVENT_STATUSES = ['active', 'submitted'] as const;

export function isActiveEventStatus(status: unknown): boolean {
  return typeof status === 'string' && (ACTIVE_EVENT_STATUSES as readonly string[]).includes(status);
}

// deno-lint-ignore no-explicit-any
export interface KioskPhotoDb { from(table: string): any }

export interface VerifyKioskPhotoInput {
  db: KioskPhotoDb;
  eventId: string;
  photoUrl: string;
}

/** Ligne `photos` retrouvée : type de média (LAB-229) et affiche des formats animés. */
export interface KioskPhotoRow {
  id: string | null;
  media_type: string;
  thumbnail_url: string | null;
}

export type KioskPhotoCheck = { ok: true; photo: KioskPhotoRow } | { ok: false; status: number; error: string };

export const PHOTO_NOT_LINKED = "Cette photo n'est pas rattachée à cet événement";

export async function verifyKioskPhoto(input: VerifyKioskPhotoInput): Promise<KioskPhotoCheck> {
  const { db, eventId, photoUrl } = input;

  const { data, error } = await db.from('photos')
    .select('id, media_type, thumbnail_url')
    .eq('event_id', eventId).eq('photo_url', photoUrl).limit(1);
  if (error) return { ok: false, status: 500, error: 'Vérification de la photo impossible' };
  if (!Array.isArray(data) || data.length === 0) return { ok: false, status: 403, error: PHOTO_NOT_LINKED };
  const row = data[0] ?? {};
  return {
    ok: true,
    photo: {
      id: typeof row.id === 'string' ? row.id : null,
      media_type: typeof row.media_type === 'string' && row.media_type ? row.media_type : 'photo',
      thumbnail_url: typeof row.thumbnail_url === 'string' && row.thumbnail_url ? row.thumbnail_url : null,
    },
  };
}

// ── Email des formats animés (LAB-235) ─────────────────────────────────────────────────────────
// Un GIF ou un boomerang est un MP4 : ni lisible dans un email, ni joignable sans alourdir l'envoi.
// L'email montre l'affiche (poster.jpg) et un bouton vers la galerie de l'événement, ouverte sur
// l'animation. Pas de `via=qr` dans ce lien : ce n'est pas un scan du QR code (LAB-232).

export const ANIMATED_MEDIA_TYPES = ['gif', 'boomerang', 'video'] as const;

export interface KioskEmailMedia {
  mediaType: string;
  /** Image affichée dans l'email : la photo, ou l'affiche d'une animation (null si absente). */
  imageUrl: string | null;
  /** Cible du bouton : la photo, ou la galerie ouverte sur l'animation (repli : le fichier MP4). */
  viewUrl: string;
  buttonLabel: string;
}

export function isAnimatedMediaType(mediaType: unknown): boolean {
  return typeof mediaType === 'string' && (ANIMATED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

export function kioskEmailMedia(p: {
  photo: KioskPhotoRow | null | undefined;
  photoUrl: string;
  appUrl?: string | null;
  accessCode?: string | null;
}): KioskEmailMedia {
  const mediaType = p.photo?.media_type ?? 'photo';
  if (!isAnimatedMediaType(mediaType)) {
    return { mediaType: 'photo', imageUrl: p.photoUrl, viewUrl: p.photoUrl, buttonLabel: 'Voir ma photo →' };
  }
  const base = (p.appUrl ?? '').replace(/\/+$/, '');
  const code = (p.accessCode ?? '').trim();
  const viewUrl = base && code && p.photo?.id
    ? `${base}/photos/${encodeURIComponent(code)}?photo=${encodeURIComponent(p.photo.id)}`
    : p.photoUrl;
  return {
    mediaType,
    imageUrl: p.photo?.thumbnail_url ?? null,
    viewUrl,
    buttonLabel: mediaType === 'video' ? '▶ Voir ma vidéo' : '▶ Voir mon animation',
  };
}
