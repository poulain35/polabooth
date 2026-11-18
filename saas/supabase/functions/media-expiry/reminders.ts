// Rappel client avant l'expiration du lien photos & audio (LAB-212) : lectures, envoi, marquage.
// Règles dans logic.ts (remindEvent, remindableMedia), testées dans logic.test.ts.

import type { adminClient } from '../_shared/auth.ts';
import { EmailSendError, sendHtmlEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSenderCache } from '../_shared/org-identity.ts';
import { renderMediaExpiryReminderEmail } from './email.ts';
import { message, remindableMedia, reminderWindowEnd, remindEvent, type ReminderEvent, type ReminderStore } from './logic.ts';
import { appUrl } from '../_shared/app-url.ts';
import { clientTrackingUrl } from '../_shared/client-tracking.ts';

type Db = ReturnType<typeof adminClient>;

const APP_URL = appUrl().replace(/\/$/, '');
const MAX_REMINDERS = 200;
const LOG_TYPE = 'media_expiry_reminder';

export async function runReminders(db: Db, now: Date, errors: string[]) {
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
        trackingUrl: await clientTrackingUrl(db, ev.id),
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
