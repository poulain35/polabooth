/**
 * POST /functions/v1/get-photo-upload-url
 * Réservé à l'admin propriétaire de l'organisation de l'événement. Génère une presigned PUT URL pour envoyer une photo au stockage (R2 ou S3).
 *
 * Body:    { event_id, filename, content_type }
 * Réponse: { presigned_url, public_url, storage_path }
 *
 * Dossier : photos/{slug-du-nom-event}-{8 premiers car. de l'event_id}/
 * → lisible dans Cloudflare tout en restant unique (pas de collision entre homonymes).
 */

import { PutObjectCommand }           from 'npm:@aws-sdk/client-s3';
import { getSignedUrl }               from 'npm:@aws-sdk/s3-request-presigner';
import { handleCors, corsResponse }   from '../_shared/cors.ts';
import { adminClient, sessionUser }   from '../_shared/auth.ts';
import { authenticate, requireOrgAccess } from '../_shared/admin-guard.ts';
import { requireFeature } from '../_shared/features.ts';
import { eventFolder, photosBucket, photosPublicBaseUrl, storageClient } from '../_shared/storage.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;

  let body: { event_id?: string; filename?: string; content_type?: string };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { event_id, filename, content_type } = body;
  if (!event_id || !filename || !content_type) {
    return corsResponse(400, { error: 'event_id, filename et content_type sont requis' });
  }

  const db = adminClient();
  const access = await requireOrgAccess(db, auth.user.id, { kind: 'event', id: event_id });
  if (access.response) return access.response;
  const disabled = await requireFeature(db, access.orgId, 'gallery');
  if (disabled) return disabled;

  const { data: event } = await db
    .from('events')
    .select('name')
    .eq('id', event_id)
    .single();

  const folder = eventFolder({ id: event_id, name: event?.name });

  const ext         = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const now         = new Date();
  const p           = (n: number) => String(n).padStart(2, '0');
  const ts          = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const rand        = crypto.randomUUID().slice(0, 8); // évite toute collision (ex: photo pleine vs miniature au même instant)
  const storagePath = `photos/${folder}/${ts}-${rand}.${ext}`;
  const publicUrl   = `${photosPublicBaseUrl()}/${storagePath}`;

  const presignedUrl = await getSignedUrl(
    storageClient(),
    new PutObjectCommand({ Bucket: photosBucket(), Key: storagePath, ContentType: content_type }),
    { expiresIn: 900 },
  );

  return corsResponse(200, { presigned_url: presignedUrl, public_url: publicUrl, storage_path: storagePath });
});
