// Logique pure du cron media-expiry (LAB-212) : rappel au client avant l'expiration du lien
// photos & audio, puis suppression des fichiers 30 jours après. Sans Deno ni réseau : la base et
// R2 sont injectés (PurgeStore, ReminderStore), testé sous `node --test` (logic.test.ts).

import { type FeatureFlags, isFeatureEnabled } from '../_shared/features.ts';

export const PURGE_GRACE_DAYS = 30;
export const REMINDER_DAYS_BEFORE = 7;
/** Plafond de l'API S3 DeleteObjects : 1 000 clés par requête. */
export const DELETE_BATCH = 1000;

const DAY_MS = 86_400_000;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

// ── Sélection ────────────────────────────────────────────────────────────────

/** Les événements expirés avant cette date sont à purger. */
export function purgeCutoff(now: Date, graceDays = PURGE_GRACE_DAYS): string {
  return new Date(now.getTime() - graceDays * DAY_MS).toISOString();
}

/** Purge due : expiration ACTUELLE renseignée et dépassée de `graceDays` jours. */
export function isPurgeDue(expiresAt: string | null | undefined, now: Date, graceDays = PURGE_GRACE_DAYS): boolean {
  const t = ms(expiresAt);
  return Number.isFinite(t) && t + graceDays * DAY_MS <= now.getTime();
}

/** Borne haute de la requête des rappels : expirations d'ici `daysBefore` jours. */
export function reminderWindowEnd(now: Date, daysBefore = REMINDER_DAYS_BEFORE): string {
  return new Date(now.getTime() + daysBefore * DAY_MS).toISOString();
}

export interface ReminderEvent {
  id: string;
  org_id?: string | null;
  name?: string | null;
  client_name?: string | null;
  client_email?: string | null;
  access_code?: string | null;
  status?: string | null;
  expires_at?: string | null;
  media_reminder_expires_at?: string | null;
}

export interface MediaCount { photos: number; audio: number }

/**
 * Fenêtre du rappel : de J-`daysBefore` jusqu'à l'expiration, un seul envoi par date d'expiration.
 * Si l'expiration est repoussée après l'envoi, la nouvelle date (plus tardive) rouvre un rappel ;
 * avancée, elle n'en déclenche pas d'autre.
 */
export function reminderEligible(ev: ReminderEvent, now: Date, daysBefore = REMINDER_DAYS_BEFORE): boolean {
  if (!ev.client_email?.trim() || !ev.access_code || ev.status === 'archived') return false;
  const exp = ms(ev.expires_at);
  if (!Number.isFinite(exp)) return false;
  const t = now.getTime();
  if (t >= exp || t < exp - daysBefore * DAY_MS) return false;
  const reminded = ms(ev.media_reminder_expires_at);
  return !Number.isFinite(reminded) || exp > reminded;
}

export function isReminderDue(ev: ReminderEvent, media: MediaCount, now: Date, daysBefore = REMINDER_DAYS_BEFORE): boolean {
  return reminderEligible(ev, now, daysBefore) && media.photos + media.audio > 0;
}

// ── Clés R2 ──────────────────────────────────────────────────────────────────

/** Clé d'objet exacte (jamais un préfixe ni un chemin relatif). */
export function isSafeObjectKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 1024
    && !key.startsWith('/') && !key.endsWith('/') && !key.split('/').includes('..');
}

/** Clé R2 d'une URL publique `${base}/${clé}` (miniatures) ; null si l'URL est ailleurs. */
export function keyFromPublicUrl(url: string | null | undefined, publicBase: string): string | null {
  const base = publicBase.replace(/\/$/, '');
  if (!url || !base || !url.startsWith(`${base}/`)) return null;
  const key = url.slice(base.length + 1).split(/[?#]/)[0];
  return isSafeObjectKey(key) ? key : null;
}

export interface PhotoRow { id: string; storage_path: string | null; thumbnail_url?: string | null }
export interface AudioRow { id: string; storage_path: string | null }

export function photoKeys(row: PhotoRow, publicBase: string): string[] {
  const keys: string[] = [];
  if (isSafeObjectKey(row.storage_path)) keys.push(row.storage_path);
  const thumb = keyFromPublicUrl(row.thumbnail_url, publicBase);
  if (thumb && thumb !== row.storage_path) keys.push(thumb);
  return keys;
}

export function audioKeys(row: AudioRow): string[] {
  return isSafeObjectKey(row.storage_path) ? [row.storage_path] : [];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Supprime un lot de clés ; renvoie les clés en échec (réponse `Errors` de DeleteObjects). */
export type DeleteObjects = (keys: string[]) => Promise<{ failed: string[] }>;

/** Clés en échec. Un lot dont l'appel échoue entièrement compte toutes ses clés en échec. */
export async function deleteKeys(keys: string[], del: DeleteObjects, batch = DELETE_BATCH): Promise<Set<string>> {
  const failed = new Set<string>();
  for (const part of chunk([...new Set(keys)], batch)) {
    try {
      for (const k of (await del(part)).failed) failed.add(k);
    } catch (e) {
      console.error('media-expiry : DeleteObjects en échec', part.length, 'clé(s)', e);
      for (const k of part) failed.add(k);
    }
  }
  return failed;
}

/** Lignes dont tous les fichiers ont été supprimés (les autres restent pour le passage suivant). */
export function deletableRowIds<T extends { id: string }>(rows: T[], keysOf: (row: T) => string[], failed: Set<string>): string[] {
  return rows.filter((r) => keysOf(r).every((k) => !failed.has(k))).map((r) => r.id);
}

// ── Purge d'un événement ─────────────────────────────────────────────────────

export interface PurgeStore {
  readEvent(eventId: string): Promise<{ id: string; expires_at: string | null } | null>;
  listPhotos(eventId: string): Promise<PhotoRow[]>;
  listAudio(eventId: string): Promise<AudioRow[]>;
  deletePhotoObjects: DeleteObjects;
  deleteAudioObjects: DeleteObjects;
  deletePhotoRows(ids: string[]): Promise<void>;
  deleteAudioRows(ids: string[]): Promise<void>;
  markPurged(eventId: string, atIso: string): Promise<void>;
}

export interface PurgeResult {
  status: 'not_due' | 'empty' | 'purged' | 'partial';
  photos: number;
  audio: number;
  failedKeys: number;
}

/**
 * Purge les fichiers et lignes d'un événement. L'expiration est relue juste avant : un événement
 * prolongé entre la sélection et la purge est laissé intact. Une ligne n'est supprimée que si ses
 * fichiers l'ont été ; la date de purge n'est notée que si tout est parti. Rejouable sans effet.
 */
export async function purgeEvent(store: PurgeStore, eventId: string, now: Date, publicBase: string): Promise<PurgeResult> {
  const ev = await store.readEvent(eventId);
  if (!ev || !isPurgeDue(ev.expires_at, now)) return { status: 'not_due', photos: 0, audio: 0, failedKeys: 0 };

  const [photos, audio] = await Promise.all([store.listPhotos(eventId), store.listAudio(eventId)]);
  if (!photos.length && !audio.length) return { status: 'empty', photos: 0, audio: 0, failedKeys: 0 };

  const keysOfPhoto = (r: PhotoRow) => photoKeys(r, publicBase);
  const failedPhotos = await deleteKeys(photos.flatMap(keysOfPhoto), store.deletePhotoObjects);
  const failedAudio = await deleteKeys(audio.flatMap(audioKeys), store.deleteAudioObjects);

  const photoIds = deletableRowIds(photos, keysOfPhoto, failedPhotos);
  const audioIds = deletableRowIds(audio, audioKeys, failedAudio);
  if (photoIds.length) await store.deletePhotoRows(photoIds);
  if (audioIds.length) await store.deleteAudioRows(audioIds);

  const failedKeys = failedPhotos.size + failedAudio.size;
  if (failedKeys === 0) await store.markPurged(eventId, now.toISOString());
  return { status: failedKeys ? 'partial' : 'purged', photos: photoIds.length, audio: audioIds.length, failedKeys };
}

// ── Rappel d'un événement ────────────────────────────────────────────────────

export interface ReminderStore {
  countMedia(eventId: string): Promise<MediaCount>;
  send(ev: ReminderEvent, media: MediaCount): Promise<{ error: string | null }>;
  markReminded(eventId: string, sentAtIso: string, expiresAt: string): Promise<void>;
}

export interface RemindableMedia { photos: boolean; audio: boolean }

/** Médias que le rappel peut annoncer : ceux d'une fonctionnalité active de l'org (la purge, elle, ne filtre rien). */
export function remindableMedia(features: FeatureFlags): RemindableMedia {
  return { photos: isFeatureEnabled(features, 'gallery'), audio: isFeatureEnabled(features, 'audio_guestbook') };
}

/** Envoie le rappel s'il est dû. Un refus Brevo n'est pas noté : nouvel essai au passage suivant. */
export async function remindEvent(
  store: ReminderStore, ev: ReminderEvent, now: Date, remindable: RemindableMedia = { photos: true, audio: true },
): Promise<'sent' | 'skipped' | 'failed'> {
  if (!reminderEligible(ev, now)) return 'skipped';
  if (!remindable.photos && !remindable.audio) return 'skipped';
  const counted = await store.countMedia(ev.id);
  const media = { photos: remindable.photos ? counted.photos : 0, audio: remindable.audio ? counted.audio : 0 };
  if (!isReminderDue(ev, media, now)) return 'skipped';
  const { error } = await store.send(ev, media);
  if (error) return 'failed';
  await store.markReminded(ev.id, now.toISOString(), ev.expires_at!);
  return 'sent';
}
