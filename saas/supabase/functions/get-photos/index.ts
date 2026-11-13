/**
 * GET /functions/v1/get-photos?code=XXXXXX[&photo={id}&via=qr]
 * Endpoint public — retourne les photos d'un événement via son code d'accès.
 * Pour les photos du stockage (storage_path renseigné), génère une presigned GET URL
 * avec Content-Disposition: attachment pour le téléchargement sans CORS.
 * Avec via=qr (QR code de la borne) et une photo de l'événement : une ouverture par QR code est
 * comptée dans event_activity ('qr_open', une seule par photo, LAB-232).
 */

import { GetObjectCommand }           from 'npm:@aws-sdk/client-s3';
import { getSignedUrl }               from 'npm:@aws-sdk/s3-request-presigner';
import { handleCors, corsResponse }   from '../_shared/cors.ts';
import { adminClient }                from '../_shared/auth.ts';
import { LIMITS, publicGuard }        from '../_shared/public-rate-limit.ts';
import { requireFeature } from '../_shared/features.ts';
import { qrOpenActivity, recordEventActivity } from '../_shared/event-activity.ts';
import { photosBucket, storageClient } from '../_shared/storage.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'GET') return corsResponse(405, { error: 'Method not allowed' });

  const params = new URL(req.url).searchParams;
  const code = params.get('code')?.toUpperCase().trim();
  if (!code) return corsResponse(400, { error: 'Paramètre code manquant' });

  const db = adminClient();
  const guard = publicGuard('get-photos', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.getPhotosIp, guard.ip]], { codeFailures: true });
  if (limited) return limited;

  const { data: event, error } = await db
    .from('events')
    .select('id, org_id, name, status, expires_at')
    .eq('access_code', code)
    .single();

  if (error || !event) {
    await guard.codeFailed();
    return corsResponse(404, { error: "Code d'accès invalide" });
  }
  if (event.status === 'archived') return corsResponse(403, { error: 'Cet événement est clôturé' });
  if (event.expires_at && new Date(event.expires_at) < new Date()) {
    return corsResponse(403, { error: 'Ce lien a expiré' });
  }
  const disabled = await requireFeature(db, event.org_id, 'gallery');
  if (disabled) return disabled;

  // service_role contourne la RLS : la modération (photos invités en attente ou rejetées) doit
  // être filtrée ici, comme dans get_public_photos (LAB-114).
  const { data: photos, error: photosErr } = await db
    .from('photos')
    .select('id, photo_url, share_url, storage_path, created_at')
    .eq('event_id', event.id)
    .eq('status', 'approved')
    .order('created_at', { ascending: true });

  if (photosErr) return corsResponse(500, { error: 'Erreur récupération des photos' });

  const qrOpen = recordEventActivity(db, qrOpenActivity(event.id, params, (photos ?? []).map((p) => p.id)));

  // Générer des presigned GET URLs pour les photos du stockage (storage_path présent).
  // Client créé seulement s'il sert : une galerie de photos webhook ne dépend pas du stockage.
  const s3 = (photos ?? []).some((p) => p.storage_path) ? storageClient() : null;
  const bucket = photosBucket();

  const photosWithDownload = await Promise.all(
    (photos ?? []).map(async (p, i) => {
      if (!p.storage_path) {
        // Photo webhook (fotoshare) — pas dans le stockage
        return { ...p, download_url: p.share_url ?? p.photo_url };
      }
      const ext = p.storage_path.split('.').pop()?.toLowerCase() ?? 'jpg';
      // Nom horodaté (ordre d'upload) ; repli sur un index si created_at absent.
      const d  = p.created_at ? new Date(p.created_at) : null;
      const pad = (n: number) => String(n).padStart(2, '0');
      const base = d && !Number.isNaN(d.getTime())
        ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`
        : `photo-${String(i + 1).padStart(3, '0')}`;
      const filename = `${base}.${ext}`;
      const download_url = await getSignedUrl(
        s3!,
        new GetObjectCommand({
          Bucket: bucket,
          Key: p.storage_path,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
        }),
        { expiresIn: 3600 },
      );
      return { ...p, download_url };
    }),
  );

  await qrOpen;

  return corsResponse(200, {
    event_name: event.name,
    photos: photosWithDownload,
  });
});
