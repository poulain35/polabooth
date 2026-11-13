/**
 * POST /functions/v1/record-guest-photo
 * Enregistre côté serveur une photo uploadée par un invité. Remplace l'insert
 * direct PostgREST (anon) qui laissait le client choisir `status` et `source` —
 * un invité pouvait ainsi contourner la modération ou usurper `source='kiosk'`.
 *
 * L'autorisation repose sur le code d'accès de l'événement (pas de JWT admin).
 * Le serveur FORCE `source='guest'` et décide `status` selon la config de
 * modération de l'événement ; il vérifie aussi que le chemin R2 appartient bien
 * au dossier de l'événement (empêche l'injection d'une photo_url arbitraire).
 *
 * Body:    { access_code, storage_path, photo_url, thumbnail_url?, width?, height?, uploader_name? }
 * Réponse: { id, status }
 *
 * Conditions d'autorisation :
 *   - événement existant pour ce access_code (uppercase)   → sinon 404
 *   - non expiré (expires_at null ou futur)                → sinon 410
 *   - form_config.gallery.guest_upload_enabled === true     → sinon 403
 *   - storage_path dans le dossier R2 de l'événement        → sinon 400
 *   - photo_url == base publique R2 + storage_path          → sinon 400
 *
 * media_type (LAB-229) : 'video' si le fichier principal est une vidéo (même liste d'extensions que
 * src/utils/media.js), sinon 'photo'. Décidé par le serveur, jamais par le client.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient }              from '../_shared/auth.ts';
import { eventFolder, photosPublicBaseUrl } from '../_shared/storage-config.ts';
import { LIMITS, publicGuard }      from '../_shared/public-rate-limit.ts';
import { requireFeature } from '../_shared/features.ts';

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: {
    access_code?: string;
    storage_path?: string;
    photo_url?: string;
    thumbnail_url?: string | null;
    width?: number | null;
    height?: number | null;
    uploader_name?: string | null;
  };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const accessCode  = body.access_code?.toUpperCase().trim();
  const storagePath = body.storage_path;
  const photoUrl    = body.photo_url;
  if (!accessCode || !storagePath || !photoUrl) {
    return corsResponse(400, { error: 'access_code, storage_path et photo_url sont requis' });
  }

  // ── Autorisation par code d'accès (sans session admin) ───────
  const db = adminClient();
  const guard = publicGuard('record-guest-photo', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.guestRecordCode, accessCode], [LIMITS.guestRecordIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  const { data: event } = await db
    .from('events')
    .select('id, org_id, name, expires_at, form_config')
    .eq('access_code', accessCode)
    .maybeSingle();

  if (!event) {
    await guard.codeFailed();
    return corsResponse(404, { error: 'Code d\'accès invalide ou événement introuvable' });
  }
  if (event.expires_at && new Date(event.expires_at).getTime() <= Date.now()) {
    return corsResponse(410, { error: 'Cet événement a expiré' });
  }
  const disabled = await requireFeature(db, event.org_id, 'gallery');
  if (disabled) return disabled;

  const gallery = event.form_config?.gallery ?? {};
  if (gallery.guest_upload_enabled !== true) {
    return corsResponse(403, { error: 'L\'upload invité est désactivé pour cet événement' });
  }

  // ── Validation du chemin R2 : le fichier doit appartenir au dossier de cet
  //    événement, et l'URL publique doit dériver du chemin (anti-injection). ──
  const baseUrl      = photosPublicBaseUrl();
  const folderPrefix = `photos/${eventFolder(event)}/`;
  if (!storagePath.startsWith(folderPrefix) || photoUrl !== `${baseUrl}/${storagePath}`) {
    return corsResponse(400, { error: 'Chemin de fichier invalide' });
  }

  const thumbnailUrl = body.thumbnail_url ?? null;
  if (thumbnailUrl !== null && !thumbnailUrl.startsWith(`${baseUrl}/${folderPrefix}`)) {
    return corsResponse(400, { error: 'Miniature invalide' });
  }

  // ── Statut décidé par le serveur, jamais par le client ──────
  const status = gallery.moderation === true ? 'pending' : 'approved';

  const uploaderName = typeof body.uploader_name === 'string' ? body.uploader_name.trim().slice(0, 120) || null : null;

  const { data, error } = await db
    .from('photos')
    .insert({
      event_id:      event.id,
      photo_url:     photoUrl,
      storage_path:  storagePath,
      thumbnail_url: thumbnailUrl,
      width:         typeof body.width === 'number' ? body.width : null,
      height:        typeof body.height === 'number' ? body.height : null,
      uploader_name: uploaderName,
      status,
      source:        'guest',
      media_type:    VIDEO_EXT.test(storagePath) ? 'video' : 'photo',
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error(error);
    return corsResponse(500, { error: 'Erreur lors de l\'enregistrement de la photo' });
  }

  return corsResponse(200, { id: data.id, status });
});
