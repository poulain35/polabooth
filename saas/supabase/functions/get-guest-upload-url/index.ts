/**
 * POST /functions/v1/get-guest-upload-url
 * Calque anon de get-photo-upload-url : permet à un invité (sans session admin) d'obtenir
 * une presigned PUT URL pour uploader sa photo vers R2. L'autorisation repose sur le code
 * d'accès de l'événement, pas sur un JWT admin.
 *
 * Body:    { access_code, filename, content_type, content_length }
 * Réponse: { presigned_url, public_url, storage_path }
 *
 * Conditions d'autorisation :
 *   - événement existant pour ce access_code (uppercase)  → sinon 404
 *   - non expiré (expires_at null ou futur)               → sinon 410
 *   - form_config.gallery.guest_upload_enabled === true    → sinon 403
 *   - content_type image, ou vidéo si allow_video          → sinon 415
 *   - content_length ≤ max_upload_mb                        → sinon 413
 *
 * La taille et le type sont validés serveur puis LIÉS dans la signature (ContentLength +
 * signableHeaders) : R2 rejette tout PUT dont le Content-Length ou le Content-Type diffère
 * de ce qui a été signé. Le plafond/refus vidéo n'est donc plus contournable côté client.
 *
 * Dossier R2 : photos/{slug-du-nom-event}-{8 premiers car. de l'event_id}/
 * → identique à get-photo-upload-url pour que les photos invités atterrissent au même endroit.
 */

import { PutObjectCommand }           from 'npm:@aws-sdk/client-s3';
import { getSignedUrl }               from 'npm:@aws-sdk/s3-request-presigner';
import { handleCors, corsResponse }   from '../_shared/cors.ts';
import { adminClient }                from '../_shared/auth.ts';
import { eventFolder, photosBucket, photosPublicBaseUrl, storageClient } from '../_shared/storage.ts';
import { LIMITS, publicGuard }      from '../_shared/public-rate-limit.ts';
import { requireFeature } from '../_shared/features.ts';

const IMAGE_TYPES   = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const DEFAULT_MAX_MB = 100;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: { access_code?: string; filename?: string; content_type?: string; content_length?: number };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const accessCode    = body.access_code?.toUpperCase().trim();
  const filename      = body.filename;
  const contentType   = body.content_type?.toLowerCase();
  const contentLength = body.content_length;
  if (!accessCode || !filename || !contentType) {
    return corsResponse(400, { error: 'access_code, filename et content_type sont requis' });
  }
  if (typeof contentLength !== 'number' || !Number.isFinite(contentLength) || contentLength <= 0) {
    return corsResponse(400, { error: 'content_length (octets) est requis' });
  }

  const db = adminClient();
  const guard = publicGuard('get-guest-upload-url', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.guestUploadCode, accessCode], [LIMITS.guestUploadIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  // ── Autorisation par code d'accès (sans session admin) ───────
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

  // ── Validation type/taille serveur ───────────────────────────
  const isImage = IMAGE_TYPES.has(contentType);
  const isVideo = contentType.startsWith('video/');
  if (!isImage && !isVideo) {
    return corsResponse(415, { error: 'Type de fichier non autorisé' });
  }
  if (isVideo && gallery.allow_video !== true) {
    return corsResponse(415, { error: 'Les vidéos ne sont pas acceptées pour cet événement' });
  }

  const maxMb    = Number(gallery.max_upload_mb) > 0 ? Number(gallery.max_upload_mb) : DEFAULT_MAX_MB;
  const maxBytes = maxMb * 1024 * 1024;
  if (contentLength > maxBytes) {
    return corsResponse(413, { error: `Fichier trop lourd (max ${maxMb} Mo)` });
  }

  // ── Génération de la presigned URL (identique à get-photo-upload-url) ──
  const folder = eventFolder(event);

  const ext         = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const now         = new Date();
  const p           = (n: number) => String(n).padStart(2, '0');
  const ts          = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const rand        = crypto.randomUUID().slice(0, 8); // évite toute collision entre uploads simultanés
  const storagePath = `photos/${folder}/${ts}-${rand}.${ext}`;
  const publicUrl   = `${photosPublicBaseUrl()}/${storagePath}`;

  // ContentLength + signableHeaders lient la taille et le type dans la signature :
  // le stockage refuse tout PUT dont le Content-Length / Content-Type ne correspond pas.
  const presignedUrl = await getSignedUrl(
    storageClient(),
    new PutObjectCommand({ Bucket: photosBucket(), Key: storagePath, ContentType: contentType, ContentLength: contentLength }),
    { expiresIn: 900, signableHeaders: new Set(['content-length', 'content-type']) },
  );

  return corsResponse(200, { presigned_url: presignedUrl, public_url: publicUrl, storage_path: storagePath });
});
