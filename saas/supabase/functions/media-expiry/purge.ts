// Purge des photos et messages audio 30 jours après l'expiration du lien (LAB-212) : stockage et lignes.
// Règles dans logic.ts (purgeEvent, photoKeys), testées dans logic.test.ts.

import { DeleteObjectsCommand } from 'npm:@aws-sdk/client-s3';
import type { adminClient } from '../_shared/auth.ts';
import { audioBucket, photosBucket, photosPublicBaseUrl, storageClient, storageVarNames } from '../_shared/storage.ts';
import { chunk, message, purgeCutoff, purgeEvent, type DeleteObjects, type PurgeStore } from './logic.ts';

type Db = ReturnType<typeof adminClient>;

const MAX_PURGE_EVENTS = 10;
const PAGE = 1000;
const ROW_DELETE_BATCH = 200;

export async function runPurge(db: Db, now: Date, errors: string[]) {
  const publicBase = photosPublicBaseUrl();
  if (!publicBase) throw new Error(`${storageVarNames().photosPublicUrl} absent : miniatures non identifiables`);

  const { data, error } = await db.rpc('media_purge_candidates', { p_cutoff: purgeCutoff(now), p_limit: MAX_PURGE_EVENTS });
  if (error) throw new Error(`media_purge_candidates : ${error.message}`);

  const stats = { events: 0, purged: 0, partial: 0, photos: 0, audio: 0 };
  const candidates = (data ?? []) as Array<{ event_id: string }>;
  if (!candidates.length) return stats;

  const store = purgeStore(db);
  for (const { event_id } of candidates) {
    stats.events++;
    try {
      const res = await purgeEvent(store, event_id, now, publicBase);
      stats.photos += res.photos;
      stats.audio += res.audio;
      if (res.status === 'purged') stats.purged++;
      if (res.status === 'partial') {
        stats.partial++;
        errors.push(`purge ${event_id} : ${res.failedKeys} fichier(s) non supprimé(s) du stockage`);
      }
    } catch (e) {
      errors.push(`purge ${event_id} : ${message(e)}`);
    }
  }
  return stats;
}

function purgeStore(db: Db): PurgeStore {
  const s3 = storageClient();
  const names = storageVarNames();
  // Bucket audio exigé seulement s'il y a des messages à supprimer (absent d'un env sans livre d'or).
  const audio = audioBucket();
  const photos = photosBucket();
  if (!photos) throw new Error(`${names.photosBucket} absent`);

  const deleter = (bucket: string): DeleteObjects => async (keys) => {
    if (!bucket) throw new Error(`${names.audioBucket} absent : messages audio non supprimés`);
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    const failures = res.Errors ?? [];
    if (failures.some((f) => !f.Key)) return { failed: keys };
    for (const f of failures) console.error('media-expiry : stockage', bucket, f.Key, f.Code, f.Message);
    return { failed: failures.map((f) => f.Key!) };
  };

  const listAll = async <T>(table: string, columns: string, eventId: string): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select(columns).eq('event_id', eventId)
        .order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw new Error(`${table} : ${error.message}`);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return rows;
    }
  };

  const deleteRows = async (table: string, ids: string[]) => {
    for (const part of chunk(ids, ROW_DELETE_BATCH)) {
      const { error } = await db.from(table).delete().in('id', part);
      if (error) throw new Error(`${table} : ${error.message}`);
    }
  };

  return {
    async readEvent(eventId) {
      const { data, error } = await db.from('events').select('id, expires_at').eq('id', eventId).maybeSingle();
      if (error) throw new Error(`events : ${error.message}`);
      return data;
    },
    listPhotos: (eventId) => listAll('photos', 'id, storage_path, thumbnail_url', eventId),
    listAudio: (eventId) => listAll('audio_tracks', 'id, storage_path', eventId),
    deletePhotoObjects: deleter(photos),
    deleteAudioObjects: deleter(audio),
    deletePhotoRows: (ids) => deleteRows('photos', ids),
    deleteAudioRows: (ids) => deleteRows('audio_tracks', ids),
    async markPurged(eventId, atIso) {
      const { error } = await db.from('events').update({ media_purged_at: atIso }).eq('id', eventId);
      if (error) throw new Error(`events : ${error.message}`);
    },
  };
}
