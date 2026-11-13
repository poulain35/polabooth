/**
 * POST /functions/v1/photo-webhook
 * Endpoint PUBLIC appelé par le logiciel photobooth.
 *
 * Accepte JSON ou form-data :
 *   param1 : chemin local du fichier  (ex: c:\booth\file.jpg)
 *   param2 : URL de partage           (ex: https://fotoshare.co/abcd1234)
 *   param3 : type                     (ex: photo)
 *   param4 : nom de l'album           (ex: Mariage Dupont)
 *
 * Matching événement : events.album_name (exact) → events.name (insensible à la casse).
 * Réponse: { id, event_id, photo_url }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient }              from '../_shared/auth.ts';
import { LIMITS, publicGuard }      from '../_shared/public-rate-limit.ts';
import { requireFeature } from '../_shared/features.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  // Lire le body (JSON ou form-data)
  let param1 = '', param2 = '', param3 = '', param4 = '';
  const ct = req.headers.get('content-type') ?? '';

  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    param1 = body.param1 ?? '';
    param2 = body.param2 ?? '';
    param3 = body.param3 ?? '';
    param4 = body.param4 ?? '';
  } else {
    // form-data ou application/x-www-form-urlencoded
    const form = await req.formData().catch(async () => {
      const text = await req.text();
      const p = new URLSearchParams(text);
      const fd = new FormData();
      p.forEach((v, k) => fd.set(k, v));
      return fd;
    });
    param1 = (form.get('param1') as string) ?? '';
    param2 = (form.get('param2') as string) ?? '';
    param3 = (form.get('param3') as string) ?? '';
    param4 = (form.get('param4') as string) ?? '';
  }

  const albumName = param4.trim();
  if (!albumName) return corsResponse(400, { error: 'param4 (album name) requis' });
  if (!param2)    return corsResponse(400, { error: 'param2 (URL photo) requis' });

  const db = adminClient();
  const guard = publicGuard('photo-webhook', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.photoWebhookIp, guard.ip]]);
  if (limited) return limited;

  // Trouver l'événement : album_name exact d'abord, puis name insensible à la casse
  let event: { id: string; org_id: string } | null = null;

  const { data: byAlbum } = await db
    .from('events')
    .select('id, org_id')
    .eq('album_name', albumName)
    .limit(1)
    .single();

  if (byAlbum) {
    event = byAlbum;
  } else {
    const { data: byName } = await db
      .from('events')
      .select('id, org_id')
      .ilike('name', albumName)
      .limit(1)
      .single();
    event = byName ?? null;
  }

  if (!event) return corsResponse(404, { error: `Aucun événement trouvé pour l'album "${albumName}"` });
  const disabled = await requireFeature(db, event.org_id, 'gallery');
  if (disabled) return disabled;

  // Insérer la photo
  const { data: photo, error: insertErr } = await db
    .from('photos')
    .insert({
      event_id:   event.id,
      photo_url:  param2,
      share_url:  param2,
      local_path: param1 || null,
      source:     'webhook',
    })
    .select('id, event_id, photo_url')
    .single();

  if (insertErr) return corsResponse(500, { error: insertErr.message });

  return corsResponse(200, photo);
});
