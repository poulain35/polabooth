/**
 * GET /functions/v1/get-event?code=A3K9X2
 *
 * Retourne les données de l'événement correspondant au code d'accès.
 * Endpoint public — aucune authentification requise (le code est le secret).
 *
 * Réponse:
 * {
 *   "event": { id, name, client_name, allowed_formats, status, end_date },
 *   "design": { id, canvas_json, format, status } | null
 * }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { templateLinkExpired } from '../_shared/expiry.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'GET') {
    return corsResponse(405, { error: 'Method not allowed' });
  }

  const url  = new URL(req.url);
  const code = url.searchParams.get('code')?.toUpperCase().trim();

  if (!code) {
    return corsResponse(400, { error: 'Paramètre code manquant' });
  }

  const db = adminClient();
  const guard = publicGuard('get-event', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.getEventIp, guard.ip]], { codeFailures: true });
  if (limited) return limited;

  // ── Récupérer l'événement ─────────────────────────────────
  const { data: event, error } = await db
    .from('events')
    .select('id, name, client_name, allowed_formats, status, end_date')
    .eq('access_code', code)
    .single();

  if (error || !event) {
    await guard.codeFailed();
    return corsResponse(404, { error: 'Code d\'accès invalide ou événement introuvable' });
  }

  // ── Vérifications ─────────────────────────────────────────
  if (event.status === 'archived') {
    return corsResponse(403, { error: 'Cet événement est clôturé' });
  }
  if (templateLinkExpired(event.end_date)) {
    return corsResponse(403, { error: 'Ce lien a expiré' });
  }

  // ── Design en cours (s'il existe) ─────────────────────────
  const { data: design } = await db
    .from('client_designs')
    .select('id, canvas_json, format, status')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Réponses formulaire précédentes (si elles existent) ─────
  // Sans les consentements photo de la borne (LAB-217, même filtre que src/lib/formResponses.js).
  const { data: prevFormResponse } = await db
    .from('event_form_responses')
    .select('answers')
    .eq('event_id', event.id)
    .or('answers->>type.is.null,answers->>type.neq.rgpd_consent')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return corsResponse(200, {
    event,
    design:       design ?? null,
    form_answers: prevFormResponse?.answers ?? null,
  });
});
