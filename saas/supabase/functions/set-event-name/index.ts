/**
 * POST /functions/v1/set-event-name
 *
 * Enregistre le nom de l'événement saisi par le client (étape "collect_name").
 * Le rôle anon n'a pas le droit d'UPDATE sur events (RLS) : on passe par le
 * service_role pour garantir que le nom est bien persisté avant l'éditeur.
 *
 * Body: { "code": "A3K9X2", "name": "Mariage Marie & Pierre" }
 * Réponse: { "name": "Mariage Marie & Pierre" }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { code, name } = body as { code?: string; name?: string };

  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!code || !cleanName) {
    return corsResponse(400, { error: 'code et name sont requis' });
  }

  const db = adminClient();
  const guard = publicGuard('set-event-name', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.setEventNameIp, guard.ip]], { codeFailures: true });
  if (limited) return limited;

  const { data: event } = await db
    .from('events')
    .select('id, status, name')
    .eq('access_code', code.toUpperCase().trim())
    .single();

  if (!event) await guard.codeFailed();
  if (!event || event.status === 'archived') {
    return corsResponse(403, { error: 'Événement invalide ou clôturé' });
  }

  const { data: updated, error } = await db
    .from('events')
    .update({ name: cleanName })
    .eq('id', event.id)
    .select('name')
    .single();

  if (error || !updated) {
    console.error('set-event-name error:', JSON.stringify(error));
    return corsResponse(500, { error: error?.message ?? 'Erreur enregistrement du nom' });
  }

  return corsResponse(200, { name: updated.name });
});
