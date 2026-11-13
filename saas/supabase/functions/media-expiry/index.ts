/**
 * media-expiry — appelée par pg_cron une fois par jour (service_role), LAB-212.
 *
 * 1. Rappel client : pour chaque événement dont le lien photos & audio (events.expires_at) expire
 *    dans les 7 jours, un email Brevo au client (lien des galeries, date, invitation à tout
 *    télécharger). Un envoi par date d'expiration (media_reminder_expires_at) ; rien sans email
 *    client, sans photo approuvée ni message audio, ou pour un événement clôturé.
 * 2. Purge : pour chaque événement expiré depuis plus de 30 jours (valeur ACTUELLE d'expires_at,
 *    relue juste avant la purge) qui a encore des photos ou des messages audio : suppression des
 *    objets R2 (DeleteObjects, clés exactes issues des lignes de l'événement), puis des lignes
 *    photos / audio_tracks dont les fichiers sont partis, puis events.media_purged_at.
 *    Un échec R2 laisse les lignes concernées : nouvel essai au passage suivant.
 *
 * Fonctionnalités (open core) : le rappel n'annonce que les photos (gallery) et les messages audio
 * (audio_guestbook) d'une fonctionnalité active de l'org ; la purge tourne toujours (RGPD).
 *
 * Réponse 500 si une étape a échoué (tracée dans cron_http_calls → alerte check-cron-alerts).
 * Règles dans logic.ts (testées sous node --test). verify_jwt = true + rôle service_role exigé.
 */

import { DeleteObjectsCommand } from 'npm:@aws-sdk/client-s3';
import { adminClient } from '../_shared/auth.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { corsResponse } from '../_shared/cors.ts';
import { EmailSendError, sendHtmlEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSenderCache } from '../_shared/org-identity.ts';
import { audioBucket, photosBucket, photosPublicBaseUrl, storageClient, storageVarNames } from '../_shared/storage.ts';
import { renderMediaExpiryReminderEmail } from './email.ts';
import {
  chunk, purgeCutoff, purgeEvent, remindableMedia, reminderWindowEnd, remindEvent,
  type DeleteObjects, type PurgeStore, type ReminderEvent, type ReminderStore,
} from './logic.ts';
import { appUrl } from '../_shared/app-url.ts';

type Db = ReturnType<typeof adminClient>;

const APP_URL = appUrl().replace(/\/$/, '');
const MAX_PURGE_EVENTS = 10;
const MAX_REMINDERS = 200;
const PAGE = 1000;
const ROW_DELETE_BATCH = 200;
const LOG_TYPE = 'media_expiry_reminder';

Deno.serve(async (req) => {
  const denied = cronOnly(req, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (denied) return denied;

  const db = adminClient();
  const now = new Date();
  const errors: string[] = [];

  const reminders = { sent: 0, failed: 0 };
  try {
    Object.assign(reminders, await runReminders(db, now, errors));
  } catch (e) {
    errors.push(`rappels : ${message(e)}`);
  }

  const purge = { events: 0, purged: 0, partial: 0, photos: 0, audio: 0 };
  try {
    Object.assign(purge, await runPurge(db, now, errors));
  } catch (e) {
    errors.push(`purge : ${message(e)}`);
  }

  const summary = { reminders, purge, errors: errors.slice(0, 20) };
  console.log('media-expiry', JSON.stringify(summary));
  return corsResponse(errors.length ? 500 : 200, summary);
});

// ── Rappels ──────────────────────────────────────────────────────────────────

async function runReminders(db: Db, now: Date, errors: string[]) {
  const { data, error } = await db
    .from('events')
    .select('id, org_id, name, client_name, client_email, access_code, status, expires_at, media_reminder_expires_at')
    .not('client_email', 'is', null)
    .gt('expires_at', now.toISOString())
    .lte('expires_at', reminderWindowEnd(now))
    .order('expires_at', { ascending: true })
    .limit(MAX_REMINDERS);
  if (error) throw new Error(error.message);

  const store = reminderStore(db);
  const featuresOf = orgFeaturesCache(db);
  let sent = 0, failed = 0;
  for (const ev of (data ?? []) as ReminderEvent[]) {
    try {
      const outcome = await remindEvent(store, ev, now, remindableMedia(await featuresOf(ev.org_id)));
      if (outcome === 'sent') sent++;
      if (outcome === 'failed') { failed++; errors.push(`rappel ${ev.id} refusé par Brevo`); }
    } catch (e) {
      failed++;
      errors.push(`rappel ${ev.id} : ${message(e)}`);
    }
  }
  return { sent, failed };
}

function orgFeaturesCache(db: Db) {
  const cache = new Map<string, Promise<Record<string, unknown> | null>>();
  return (orgId: string | null | undefined) => {
    if (!orgId) return Promise.resolve(null);
    if (!cache.has(orgId)) {
      cache.set(orgId, (async () => {
        const { data, error } = await db.from('organizations').select('features').eq('id', orgId).maybeSingle();
        if (error) throw new Error(`organizations : ${error.message}`);
        return data?.features ?? null;
      })());
    }
    return cache.get(orgId)!;
  };
}

function reminderStore(db: Db): ReminderStore {
  const senderOf = orgSenderCache(db);
  return {
    async countMedia(eventId) {
      const [photos, audio] = await Promise.all([
        db.from('photos').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('status', 'approved'),
        db.from('audio_tracks').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
      ]);
      if (photos.error) throw new Error(`photos : ${photos.error.message}`);
      if (audio.error) throw new Error(`audio_tracks : ${audio.error.message}`);
      return { photos: photos.count ?? 0, audio: audio.count ?? 0 };
    },
    async send(ev, media) {
      const code = encodeURIComponent(ev.access_code!);
      const { subject, html } = renderMediaExpiryReminderEmail({
        clientName: ev.client_name ?? null,
        eventName: ev.name ?? null,
        expiresAt: ev.expires_at!,
        photosUrl: media.photos ? `${APP_URL}/photos/${code}` : undefined,
        audioUrl: media.audio ? `${APP_URL}/audio/${code}` : undefined,
      });
      const to = ev.client_email!.trim();
      let messageId: string | null = null;
      let error: string | null = null;
      try {
        messageId = await sendHtmlEmail({ to, subject, html, sender: await senderOf(ev.org_id) });
      } catch (e) {
        if (!(e instanceof EmailSendError)) throw e;
        error = e.message;
      }
      await recordEmailLog(db, { scope: { eventId: ev.id }, recipient: to, type: LOG_TYPE, subject, messageId, error });
      return { error };
    },
    async markReminded(eventId, sentAtIso, expiresAt) {
      const { error } = await db
        .from('events')
        .update({ media_reminder_sent_at: sentAtIso, media_reminder_expires_at: expiresAt })
        .eq('id', eventId);
      if (error) throw new Error(`events : ${error.message}`);
    },
  };
}

// ── Purge ────────────────────────────────────────────────────────────────────

async function runPurge(db: Db, now: Date, errors: string[]) {
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
