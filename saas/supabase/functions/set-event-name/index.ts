/**
 * POST /functions/v1/set-event-name
 *
 * Enregistre le nom de l'événement saisi par le client (étape "collect_name").
 * Le rôle anon n'a pas le droit d'UPDATE sur events (RLS) : on passe par le
 * service_role pour garantir que le nom est bien persisté avant l'éditeur.
 *
 * Body: { "code": "A3K9X2", "name": "Mariage Marie & Pierre" }   (nom : 120 caractères au plus)
 * Réponse: { "name": "Mariage Marie & Pierre" }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { eventByCode, normalizeAccessCode } from '../_shared/event-by-code.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';

/** Longueur maximale du nom saisi par le client (LAB-392). */
const EVENT_NAME_MAX_LENGTH = 120;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { code, name } = body as { code?: unknown; name?: unknown };

  const accessCode = normalizeAccessCode(code);
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!accessCode || !cleanName) {
    return corsResponse(400, { error: 'code et name sont requis' });
  }
  if (cleanName.length > EVENT_NAME_MAX_LENGTH) {
    return corsResponse(400, { error: `Le nom ne doit pas dépasser ${EVENT_NAME_MAX_LENGTH} caractères` });
  }

  const db = adminClient();
  const guard = publicGuard('set-event-name', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.setEventNameIp, guard.ip]], { codeFailures: true });
  if (limited) return limited;

  // Mêmes règles que l'éditeur (get-event / autosave-design) : le nom se saisit avant l'éditeur.
  const found = await eventByCode(db, accessCode, {
    fn: 'set-event-name',
    columns: [],
    guard,
    notFound: { status: 403, error: 'Événement invalide ou clôturé' },
    archived: { status: 403, error: 'Événement invalide ou clôturé' },
    expiry: { rule: 'template', refusal: { status: 403, error: 'Lien expiré' } },
    feature: 'client_design',
  });
  if (found.response) return found.response;

  const { data: updated, error } = await db
    .from('events')
    .update({ name: cleanName })
    .eq('id', found.event.id)
    .select('name')
    .single();

  if (error || !updated) {
    console.error('set-event-name error:', JSON.stringify(error));
    return corsResponse(500, { error: 'Erreur enregistrement du nom' });
  }

  return corsResponse(200, { name: updated.name });
});
