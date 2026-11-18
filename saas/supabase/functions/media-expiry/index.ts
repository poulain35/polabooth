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
 * Rappels : reminders.ts ; purge : purge.ts ; règles dans logic.ts (testées sous node --test).
 * verify_jwt = true + rôle service_role exigé.
 */

import { adminClient } from '../_shared/auth.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { corsResponse } from '../_shared/cors.ts';
import { message } from './logic.ts';
import { runPurge } from './purge.ts';
import { runReminders } from './reminders.ts';

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
