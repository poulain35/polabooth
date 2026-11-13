/**
 * POST /functions/v1/autosave-design
 *
 * Sauvegarde automatique du design en cours (brouillon).
 * Appelé toutes les 30 secondes depuis l'éditeur.
 *
 * Body: { "code": "A3K9X2", "canvas_json": {...}, "format": "portrait" }
 * Réponse: { "design_id": "uuid" }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { templateLinkExpired } from '../_shared/expiry.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { code, canvas_json, format } = body as {
    code?: string; canvas_json?: unknown; format?: string;
  };

  if (!code || !canvas_json || !format) {
    return corsResponse(400, { error: 'code, canvas_json et format sont requis' });
  }

  const db = adminClient();
  const accessCode = code.toUpperCase().trim();
  const guard = publicGuard('autosave-design', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.autosaveCode, accessCode], [LIMITS.autosaveIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  const { data: event } = await db
    .from('events')
    .select('id, org_id, status, end_date')
    .eq('access_code', accessCode)
    .single();

  if (!event) await guard.codeFailed();
  if (!event || event.status === 'archived') {
    return corsResponse(403, { error: 'Événement invalide ou clôturé' });
  }
  if (templateLinkExpired(event.end_date)) {
    return corsResponse(403, { error: 'Lien expiré' });
  }
  const disabled = await requireFeature(db, event.org_id, 'client_design');
  if (disabled) return disabled;

  const { data: design, error } = await db
    .from('client_designs')
    .upsert(
      { event_id: event.id, canvas_json, format, status: 'draft' },
      { onConflict: 'event_id' }
    )
    .select('id')
    .single();

  if (error || !design) {
    console.error('Autosave error:', JSON.stringify(error));
    return corsResponse(500, { error: error?.message ?? 'Erreur sauvegarde', details: error?.code });
  }

  return corsResponse(200, { design_id: design.id });
});
