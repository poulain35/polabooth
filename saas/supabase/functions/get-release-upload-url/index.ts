/**
 * POST /functions/v1/get-release-upload-url  (LAB-269, Parc kiosk > Versions kiosk)
 * Réservé aux administrateurs de l'application (app_admins, même règle que is_app_admin()).
 *
 * Body:    { version: '1.2.3', content_length: number }
 * Réponse: { presigned_url, public_url, storage_path, content_type }
 *
 * URL PUT présignée vers le stockage des médias (R2 ou S3) pour l'installeur de la borne :
 * `releases/setup-polakiosk-<version>.exe`, en application/octet-stream, 500 Mo au maximum (413
 * au-delà). L'installeur dépasse la limite de 50 Mo par fichier de Supabase Storage (offre gratuite).
 * Type et taille sont liés dans la signature : le stockage refuse un PUT qui diffère.
 *
 * Bucket des photos (photosBucket()) : celui des envois de la borne (get-kiosk-upload-url), présent
 * sur toute instance et déjà ouvert en PUT au SaaS (CORS). Le bucket audio appartient au livre d'or.
 * Le navigateur envoie ensuite le fichier, puis enregistre la version dans kiosk_releases
 * (exe_url = public_url).
 */

import { PutObjectCommand }         from 'npm:@aws-sdk/client-s3';
import { getSignedUrl }             from 'npm:@aws-sdk/s3-request-presigner';
import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAppAdmin } from '../_shared/admin-guard.ts';
import { photosBucket, photosPublicBaseUrl, storageClient } from '../_shared/storage.ts';
import { resolveReleaseUpload, UPLOAD_URL_TTL_SECONDS, type ReleaseUploadBody } from './releaseUpload.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const denied = await requireAppAdmin(adminClient(), auth.user.id);
  if (denied) return denied;

  let body: ReleaseUploadBody;
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const upload = resolveReleaseUpload(body ?? {});
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
    public_url:    `${photosPublicBaseUrl()}/${upload.storagePath}`,
    storage_path:  upload.storagePath,
    content_type:  upload.contentType,
  });
});
