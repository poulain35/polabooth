// Autorisation et chemin R2 d'un fichier envoyé par PolaKiosk (LAB-213, formats animés LAB-229).
// Sans import Deno/esm.sh : testé par get-kiosk-upload-url.test.ts sous `node --test`.
//
// Mêmes règles que la RPC kiosk_record_photo, qui enregistre ensuite la séance :
//   1. licence active pour (machine_id, secret), secret non vide ;
//   2. événement event_id actif portant le code d'accès access_code.
//
// kind = "media" (défaut) : montage JPEG / PNG ou animation MP4. kind = "poster" : affiche JPEG d'une
// animation, toujours {dossier de la séance}/poster.jpg (kiosk_record_photo exige ce chemin).

import { eventFolder } from '../_shared/storage-config.ts';
import { ACTIVE_EVENT_STATUSES } from '../_shared/kiosk-photo.ts';

// Durée de validité de l'URL PUT : le kiosk envoie le fichier juste après l'avoir demandée.
export const UPLOAD_URL_TTL_SECONDS = 300;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const POSTER_FILENAME = 'poster.jpg';
const UPLOAD_KINDS = ['media', 'poster'] as const;
type UploadKind = typeof UPLOAD_KINDS[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4',
};

export interface KioskUploadBody {
  access_code?: unknown;
  event_id?: unknown;
  machine_id?: unknown;
  secret?: unknown;
  session_id?: unknown;
  filename?: unknown;
  content_length?: unknown;
  kind?: unknown;
}

// deno-lint-ignore no-explicit-any
export interface KioskUploadDb { from(table: string): any }

export type KioskUpload =
  | { ok: true; storagePath: string; contentType: string; contentLength: number }
  | { ok: false; status: number; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Type MIME d'un nom de fichier valide (pas de `/`, pas de `..`, extension image ou mp4), sinon null. */
export function montageContentType(filename: string): string | null {
  if (!FILENAME.test(filename) || filename.includes('..')) return null;
  return CONTENT_TYPES[filename.split('.').pop()!.toLowerCase()] ?? null;
}

/** Taille maximale selon le type : 60 Mo pour un MP4, 25 Mo pour une image. */
export function maxUploadBytes(contentType: string): number {
  return contentType === 'video/mp4' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/** Chemin R2 d'un montage : même dossier que get-photo-upload-url, puis séance et fichier. */
export function kioskStoragePath(event: { id: string; name?: string | null }, sessionId: string, filename: string): string {
  return `photos/${eventFolder(event)}/${sessionId.toLowerCase()}/${filename}`;
}

export async function resolveKioskUpload(db: KioskUploadDb, body: KioskUploadBody): Promise<KioskUpload> {
  const accessCode = str(body.access_code).toUpperCase();
  const eventId = str(body.event_id).toLowerCase();
  const machineId = str(body.machine_id);
  const secret = typeof body.secret === 'string' ? body.secret : '';
  const sessionId = str(body.session_id).toLowerCase();
  const kind = body.kind === undefined || body.kind === null ? 'media' : body.kind;
  const contentLength = body.content_length;

  if (!UPLOAD_KINDS.includes(kind as UploadKind)) {
    return { ok: false, status: 400, error: 'kind invalide (media ou poster)' };
  }
  // Affiche : nom imposé, le filename éventuel est ignoré.
  const filename = kind === 'poster' ? POSTER_FILENAME : str(body.filename);

  if (!accessCode || !eventId || !machineId || !sessionId || !filename) {
    return { ok: false, status: 400, error: 'access_code, event_id, machine_id, session_id et filename sont requis' };
  }
  if (!UUID.test(eventId) || !UUID.test(sessionId)) {
    return { ok: false, status: 400, error: 'event_id ou session_id invalide' };
  }
  const contentType = montageContentType(filename);
  if (!contentType) return { ok: false, status: 400, error: 'Nom de fichier invalide' };
  if (typeof contentLength !== 'number' || !Number.isInteger(contentLength) || contentLength <= 0) {
    return { ok: false, status: 400, error: 'content_length (octets) est requis' };
  }
  if (contentLength > maxUploadBytes(contentType)) return { ok: false, status: 413, error: 'Fichier trop lourd' };

  // Licence d'abord : sans secret valide, aucune information sur les codes d'accès.
  if (!secret) return { ok: false, status: 403, error: 'Licence kiosk invalide ou inactive' };
  const { data: licenses, error: licErr } = await db
    .from('kiosk_licenses')
    .select('id')
    .eq('machine_id', machineId)
    .eq('secret', secret)
    .eq('is_active', true)
    .limit(1);
  if (licErr) return { ok: false, status: 500, error: 'Vérification de la licence impossible' };
  if (!Array.isArray(licenses) || licenses.length === 0) {
    return { ok: false, status: 403, error: 'Licence kiosk invalide ou inactive' };
  }

  const { data: event, error: evErr } = await db
    .from('events')
    .select('id, name')
    .eq('id', eventId)
    .eq('access_code', accessCode)
    .in('status', [...ACTIVE_EVENT_STATUSES])
    .maybeSingle();
  if (evErr) return { ok: false, status: 500, error: 'Lecture de l\'événement impossible' };
  if (!event) return { ok: false, status: 404, error: 'Événement introuvable ou clôturé' };

  // Séance déjà enregistrée (renvoi après coupure) : même dossier, même si l'événement a été renommé.
  const { data: existing, error: exErr } = await db
    .from('photos')
    .select('storage_path')
    .eq('event_id', event.id)
    .eq('source', 'kiosk')
    .like('storage_path', `photos/%/${sessionId}/%`)
    .limit(1);
  if (exErr) return { ok: false, status: 500, error: 'Lecture des photos impossible' };

  const previous: string | undefined = Array.isArray(existing) ? existing[0]?.storage_path : undefined;
  const previousType = typeof previous === 'string' ? montageContentType(previous.split('/').pop() ?? '') : null;
  if (!previous || !previousType) {
    return { ok: true, storagePath: kioskStoragePath(event, sessionId, filename), contentType, contentLength };
  }
  // L'affiche ne reprend que le dossier : jamais le chemin du fichier principal.
  if (kind === 'poster') {
    return { ok: true, storagePath: `${previous.slice(0, previous.lastIndexOf('/'))}/${POSTER_FILENAME}`, contentType, contentLength };
  }
  if (contentLength > maxUploadBytes(previousType)) return { ok: false, status: 413, error: 'Fichier trop lourd' };
  return { ok: true, storagePath: previous, contentType: previousType, contentLength };
}
