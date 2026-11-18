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
 *
 * "kind" facultatif (LAB-289) : 'print' (modèle photo, défaut) ou 'home' (écran d'accueil, format
 * 'home', seulement si l'onglet est ouvert). Pas de nouvelle version sur un design validé (écran
 * d'accueil, ou cadre du modèle photo depuis LAB-294) → 409 { error, code: 'design_locked' }.
 * "slot" facultatif (LAB-312) : numéro du cadre du modèle photo (1 par défaut, 1 à 4), chacun son
 * historique. Enregistrer une version au-delà de frame_choice.max_frames → 403. Ici, "label" est le
 * nom de la version, pas celui du cadre (client_designs.label, écrit par autosave-design).
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { eventByCode } from '../_shared/event-by-code.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { parseVersionRequest, runVersionRequest } from './logic.ts';
import {
  DESIGN_LOCKED_CODE, FRAME_LIMIT_ERROR, HOME_DISABLED_ERROR, clientCanWriteSlot, clientDesignLocked, designLockedError,
  homeEditorEnabled,
} from '../_shared/design-kind.ts';

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

  // Mêmes règles que get-event / autosave-design : l'historique suit l'accès à l'éditeur.
  const found = await eventByCode(db, request.code, {
    fn: 'design-versions',
    columns: ['form_config'],
    guard,
    notFound: { status: 404, error: 'Code d\'accès invalide ou événement introuvable' },
    archived: { status: 403, error: 'Événement clôturé' },
    expiry: { rule: 'template', refusal: { status: 403, error: 'Lien expiré' } },
    feature: 'client_design',
  });
  if (found.response) return found.response;
  const { event } = found;

  if (request.action === 'save' && !clientCanWriteSlot(request.kind, request.slot, event.form_config)) {
    return corsResponse(403, { error: FRAME_LIMIT_ERROR });
  }

  if (request.kind === 'home' && !homeEditorEnabled(event.form_config)) {
    return corsResponse(403, { error: HOME_DISABLED_ERROR });
  }
  if (request.action === 'save' && await clientDesignLocked(db, event.id, request.kind, request.slot)) {
    return corsResponse(409, { error: designLockedError(request.kind), code: DESIGN_LOCKED_CODE });
  }

  const outcome = await runVersionRequest(db, event.id, request);
  return corsResponse(outcome.status, outcome.body);
});
