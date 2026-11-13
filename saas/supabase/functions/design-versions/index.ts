/**
 * POST /functions/v1/design-versions
 *
 * Historique des versions du design de l'éditeur /e/:code (LAB-115). Endpoint public : le code
 * d'accès est le secret, comme get-event et autosave-design.
 *
 * Body :
 *   { "code": "A3K9X2", "action": "list" }
 *     → { "versions": [{ id, label, format, created_at }] }   (20 plus récentes)
 *   { "code": "A3K9X2", "action": "get", "version_id": "uuid" }
 *     → { "version": { id, canvas_json, format, label, created_at } }
 *   { "code": "A3K9X2", "action": "save", "canvas_json": {...}, "format": "portrait", "label": null }
 *     → { "version": { id, label, format, created_at } }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { templateLinkExpired } from '../_shared/expiry.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { parseVersionRequest, runVersionRequest } from './logic.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: unknown;
  try { body = await req.json(); }
  catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const parsed = parseVersionRequest(body);
  if (!parsed.ok) return corsResponse(400, { error: parsed.error });
  const { request } = parsed;

  const db = adminClient();
  const guard = publicGuard('design-versions', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.designVersionsCode, request.code], [LIMITS.designVersionsIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  const { data: event } = await db
    .from('events')
    .select('id, org_id, status, end_date')
    .eq('access_code', request.code)
    .maybeSingle();

  if (!event) {
    await guard.codeFailed();
    return corsResponse(404, { error: 'Code d\'accès invalide ou événement introuvable' });
  }
  // Mêmes règles que get-event / autosave-design : l'historique suit l'accès à l'éditeur.
  if (event.status === 'archived') return corsResponse(403, { error: 'Événement clôturé' });
  if (templateLinkExpired(event.end_date)) return corsResponse(403, { error: 'Lien expiré' });
  const disabled = await requireFeature(db, event.org_id, 'client_design');
  if (disabled) return disabled;

  const outcome = await runVersionRequest(db, event.id, request);
  return corsResponse(outcome.status, outcome.body);
});
