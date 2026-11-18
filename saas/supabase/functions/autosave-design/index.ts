/**
 * POST /functions/v1/autosave-design
 *
 * Sauvegarde du design en cours (brouillon), bouton « Sauvegarder » de l'éditeur /e/:code.
 *
 * Body: { "code": "A3K9X2", "canvas_json": {...}, "format": "portrait", "kind": "print" }
 *   kind : 'print' (modèle photo, défaut) ou 'home' (écran d'accueil de la borne, format 'home',
 *   seulement si form_config.kiosk.home.personalized et client_design sont vrais).
 *   Un design validé (écran d'accueil, ou cadre du modèle photo depuis LAB-294) est en lecture
 *   seule : 409 { error, code: 'design_locked' }, statut inchangé ; l'admin le rouvre en le refusant.
 * Réponse: { "design_id": "uuid" }
 *
 * "with_version": true (LAB-323) : enregistre aussi une version (design_versions, label null) avec le
 * même contenu, pour que l'éditeur n'envoie le brouillon qu'une fois. Réponse :
 * { "design_id", "version": { id, label, format, created_at } } ; "version": null si le brouillon est
 * enregistré mais pas la version (rien n'est perdu, l'historique a une entrée de moins).
 *
 * Plusieurs cadres (LAB-312, spec choix-cadre-invite) : "slot" (1 par défaut, 1 à 4) choisit le
 * cadre ; au-delà de form_config.kiosk.frame_choice.max_frames (ou > 1 si le choix est coupé) → 403.
 * "label" (facultatif, 24 caractères, null ou blanc = effacé) : nom du cadre sur la borne, modèle
 * photo seulement ; absent = nom inchangé. L'écran d'accueil reste en slot 1.
 * Suppression : { "code", "slot": n, "delete": true } supprime le cadre n (> 1) et son historique,
 * s'il n'est pas validé (409 sinon, 404 s'il n'existe pas) → { "deleted": true, "slot": n }.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { eventByCode, normalizeAccessCode } from '../_shared/event-by-code.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import {
  DESIGN_LOCKED_CODE, FIRST_FRAME_ERROR, FRAME_LIMIT_ERROR, FRAME_LOCKED_ERROR, HOME_DISABLED_ERROR,
  clientCanDeleteFrame, clientCanWriteSlot, clientDesignLocked, designLockedError, formatAllowedForKind,
  homeEditorEnabled, parseDesignKind, parseDesignSlot, parseFrameLabel, slotAllowedForKind,
} from '../_shared/design-kind.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { code, canvas_json, format } = body as {
    code?: unknown; canvas_json?: unknown; format?: string;
  };

  const remove = body.delete === true;
  const accessCode = normalizeAccessCode(code);
  if (!accessCode || (!remove && (!canvas_json || !format))) {
    return corsResponse(400, { error: 'code, canvas_json et format sont requis' });
  }
  const kind = parseDesignKind(body.kind);
  if (!kind) return corsResponse(400, { error: 'kind invalide (print ou home)' });
  const slot = parseDesignSlot(body.slot);
  if (slot === null || !slotAllowedForKind(kind, slot)) return corsResponse(400, { error: 'slot invalide' });
  if (remove && !clientCanDeleteFrame(kind, slot, undefined)) return corsResponse(400, { error: FIRST_FRAME_ERROR });
  if (!remove && !formatAllowedForKind(kind, format)) {
    return corsResponse(400, { error: 'format invalide pour ce design' });
  }
  const label = kind === 'print' ? parseFrameLabel(body.label) : undefined;

  const db = adminClient();
  const guard = publicGuard('autosave-design', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.autosaveCode, accessCode], [LIMITS.autosaveIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  const found = await eventByCode(db, accessCode, {
    fn: 'autosave-design',
    columns: ['form_config'],
    guard,
    notFound: { status: 403, error: 'Événement invalide ou clôturé' },
    archived: { status: 403, error: 'Événement invalide ou clôturé' },
    expiry: { rule: 'template', refusal: { status: 403, error: 'Lien expiré' } },
    feature: 'client_design',
  });
  if (found.response) return found.response;
  const { event } = found;

  if (remove) return await deleteFrame(db, event.id, slot);
  if (!clientCanWriteSlot(kind, slot, event.form_config)) return corsResponse(403, { error: FRAME_LIMIT_ERROR });

  if (kind === 'home' && !homeEditorEnabled(event.form_config)) return corsResponse(403, { error: HOME_DISABLED_ERROR });
  if (await clientDesignLocked(db, event.id, kind, slot)) {
    return corsResponse(409, { error: designLockedError(kind), code: DESIGN_LOCKED_CODE });
  }

  const { data: design, error } = await db
    .from('client_designs')
    .upsert(
      { event_id: event.id, kind, slot, canvas_json, format, status: 'draft', ...(label === undefined ? {} : { label }) },
      { onConflict: 'event_id,kind,slot' }
    )
    .select('id')
    .single();

  if (error || !design) {
    console.error('Autosave error:', JSON.stringify(error));
    return corsResponse(500, { error: 'Erreur sauvegarde' });
  }

  if (body.with_version !== true) return corsResponse(200, { design_id: design.id });

  const { data: version, error: versionErr } = await db
    .from('design_versions')
    .insert({ event_id: event.id, kind, slot, canvas_json, format, label: null })
    .select('id, label, format, created_at')
    .single();
  if (versionErr || !version) console.error('Autosave version error:', JSON.stringify(versionErr));
  return corsResponse(200, { design_id: design.id, version: version ?? null });
});

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** Supprime un cadre ajouté (slot > 1) non validé, puis son historique. */
async function deleteFrame(db: Db, eventId: string, slot: number): Promise<Response> {
  const { data: deleted, error } = await db
    .from('client_designs')
    .delete()
    .eq('event_id', eventId)
    .eq('kind', 'print')
    .eq('slot', slot)
    .neq('status', 'approved')
    .select('id');
  if (error) {
    console.error('Suppression du cadre :', JSON.stringify(error));
    return corsResponse(500, { error: 'Erreur lors de la suppression du cadre' });
  }
  if (!deleted?.length) {
    const { data: current } = await db
      .from('client_designs')
      .select('status')
      .eq('event_id', eventId)
      .eq('kind', 'print')
      .eq('slot', slot)
      .maybeSingle();
    return current
      ? corsResponse(409, { error: FRAME_LOCKED_ERROR })
      : corsResponse(404, { error: 'Cadre introuvable' });
  }
  const { error: versionsErr } = await db
    .from('design_versions')
    .delete()
    .eq('event_id', eventId)
    .eq('kind', 'print')
    .eq('slot', slot);
  if (versionsErr) console.error("Suppression de l'historique du cadre :", JSON.stringify(versionsErr));
  return corsResponse(200, { deleted: true, slot });
}
