/**
 * DELETE /functions/v1/delete-photo
 * Réservé à l'admin propriétaire de l'organisation de l'événement de la photo. Supprime une photo de la base et du stockage si applicable :
 * le fichier principal (storage_path) et sa miniature / affiche (thumbnail_url sur la base publique des photos), mêmes clés que la
 * purge media-expiry (photoKeys).
 *
 * Body: { photo_id }
 */

import { DeleteObjectCommand }           from 'npm:@aws-sdk/client-s3';
import { handleCors, corsResponse }      from '../_shared/cors.ts';
import { adminClient, sessionUser }      from '../_shared/auth.ts';
import { authenticate, requireOrgAccess } from '../_shared/admin-guard.ts';
import { requireFeature } from '../_shared/features.ts';
import { photosBucket, photosPublicBaseUrl, storageClient } from '../_shared/storage.ts';
import { photoKeys }                     from '../media-expiry/logic.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'DELETE') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;

  let body: { photo_id?: string };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }
  const { photo_id } = body;
  if (!photo_id) return corsResponse(400, { error: 'photo_id requis' });

  const db = adminClient();

  const access = await requireOrgAccess(db, auth.user.id, { kind: 'photo', id: photo_id });
  if (access.response) return access.response;
  const disabled = await requireFeature(db, access.orgId, 'gallery');
  if (disabled) return disabled;

  const { data: photo } = await db
    .from('photos')
    .select('id, storage_path, thumbnail_url')
    .eq('id', photo_id)
    .single();

  if (!photo) return corsResponse(404, { error: 'Photo introuvable' });

  const keys = photoKeys(photo, photosPublicBaseUrl());
  if (keys.length) {
    const s3 = storageClient();
    const bucket = photosBucket();
    await Promise.all(keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(() => {})));
  }

  const { error: deleteErr } = await db.from('photos').delete().eq('id', photo_id);
  if (deleteErr) return corsResponse(500, { error: deleteErr.message });

  return corsResponse(200, { success: true });
});
