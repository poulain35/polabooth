/**
 * POST /functions/v1/get-kiosk-upload-url
 * PolaKiosk (LAB-213, LAB-229) : URL PUT présignée R2 pour le fichier d'une séance (montage photo,
 * animation MP4 ou son affiche). Appelé par le kiosk avec la clé anon (Bearer), comme
 * send-kiosk-photo. L'autorisation reprend celle de kiosk_record_photo (voir kioskUpload.ts) : licence
 * active (machine_id + secret non vide) et couple (événement, code d'accès) actif. Jamais de clé
 * service_role côté kiosk.
 *
 * Body:    { access_code, event_id, machine_id, secret, session_id, filename, content_length,
 *            kind? = "media" | "poster" }
 * Réponse: { presigned_url, storage_path, public_url, content_type }
 *
 * Chemin R2 : photos/{slug-du-nom-event}-{8 premiers car. de l'event_id}/{session_id}/{filename},
 * même dossier que get-photo-upload-url. Même séance → même chemin : un renvoi écrase le même objet
 * et kiosk_record_photo renvoie la ligne déjà créée (pas de doublon). kind "poster" : toujours
 * {dossier de la séance}/poster.jpg en image/jpeg (filename ignoré).
 *
 * Taille : 60 Mo pour un MP4, 25 Mo pour une image ; au-delà, 413.
 *
 * Le type et la taille sont liés dans la signature (comme get-guest-upload-url) : R2 refuse un PUT
 * dont le Content-Type ou le Content-Length diffère.
 */

import { PutObjectCommand }           from 'npm:@aws-sdk/client-s3';
import { getSignedUrl }               from 'npm:@aws-sdk/s3-request-presigner';
import { handleCors, corsResponse }   from '../_shared/cors.ts';
import { adminClient }                from '../_shared/auth.ts';
import { photosBucket, photosPublicBaseUrl, storageClient } from '../_shared/storage.ts';
import { resolveKioskUpload, UPLOAD_URL_TTL_SECONDS, type KioskUploadBody } from './kioskUpload.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: KioskUploadBody;
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const upload = await resolveKioskUpload(adminClient(), body ?? {});
  if (!upload.ok) return corsResponse(upload.status, { error: upload.error });

  const presignedUrl = await getSignedUrl(
    storageClient(),
    new PutObjectCommand({
      Bucket: photosBucket(),
      Key: upload.storagePath,
      ContentType: upload.contentType,
      ContentLength: upload.contentLength,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-length', 'content-type']) },
  );

  return corsResponse(200, {
    presigned_url: presignedUrl,
    storage_path:  upload.storagePath,
    public_url:    `${photosPublicBaseUrl()}/${upload.storagePath}`,
    content_type:  upload.contentType,
  });
});
