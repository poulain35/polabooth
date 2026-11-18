/**
 * GET /functions/v1/get-event?code=A3K9X2
 *
 * Retourne les données de l'événement correspondant au code d'accès.
 * Endpoint public — aucune authentification requise (le code est le secret).
 *
 * Réponse:
 * {
 *   "event": { id, name, client_name, allowed_formats, status, start_date, end_date },
 *   "design": { id, canvas_json, format, status } | null,       // modèle photo (kind = 'print')
 *   "home_editor": boolean,    // onglet « Mon écran d'accueil » (LAB-289)
 *   "home_design": { id, canvas_json, format, status, final_png_url } | null,
 *   "frame_choice": { enabled, max_frames },   // choix du cadre par l'invité (LAB-312)
 *   "frames": [{ id, slot, label, format, canvas_json, status }] | null,
 *   "kiosk_preview": { display_name, formats, result_screen, result }  // LAB-308
 * }
 *
 * home_editor = form_config.kiosk.home.personalized ET client_design. kiosk_preview : valeurs de
 * l'aperçu sur la borne, construites champ par champ (kiosk-preview.ts). Rien d'autre de
 * form_config n'est renvoyé. home_design (kind = 'home') n'est lu et renvoyé que si home_editor est vrai.
 * design = cadre 1 du modèle photo (comme avant : le seul). frames = tous les cadres 'print', triés
 * par slot, seulement si frame_choice.enabled (booléen strict) ; null sinon, et un seul cadre est lu.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { eventByCode, normalizeAccessCode } from '../_shared/event-by-code.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { MAX_FRAME_SLOTS, frameChoiceConfig, homeEditorEnabled } from '../_shared/design-kind.ts';
import { buildKioskPreview } from './kiosk-preview.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'GET') {
    return corsResponse(405, { error: 'Method not allowed' });
  }

  const url  = new URL(req.url);
  const code = normalizeAccessCode(url.searchParams.get('code'));

  if (!code) {
    return corsResponse(400, { error: 'Paramètre code manquant' });
  }

  const db = adminClient();
  const guard = publicGuard('get-event', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.getEventIp, guard.ip]], { codeFailures: true });
  if (limited) return limited;

  // ── Récupérer l'événement ─────────────────────────────────
  // Pas de fonctionnalité exigée : l'accueil (Landing) vérifie le code avant l'éditeur.
  const found = await eventByCode(db, code, {
    fn: 'get-event',
    columns: ['name', 'client_name', 'allowed_formats', 'status', 'start_date', 'end_date', 'form_config'],
    guard,
    notFound: { status: 404, error: 'Code d\'accès invalide ou événement introuvable' },
    archived: { status: 403, error: 'Cet événement est clôturé' },
    expiry: { rule: 'template', refusal: { status: 403, error: 'Ce lien a expiré' } },
  });
  if (found.response) return found.response;

  // form_config n'est lu que pour l'onglet écran d'accueil, le choix du cadre et l'aperçu sur la
  // borne : jamais renvoyé.
  const { form_config, org_id: orgId, ...event } = found.event;
  const homeEditor = homeEditorEnabled(form_config);
  const frameChoice = frameChoiceConfig(form_config);

  // ── Cadres du modèle photo (s'ils existent) : le cadre 1 seul si le choix est coupé ──
  const { data: frames } = await db
    .from('client_designs')
    .select('id, slot, label, format, canvas_json, status')
    .eq('event_id', event.id)
    .eq('kind', 'print')
    .lte('slot', frameChoice.enabled ? MAX_FRAME_SLOTS : 1)
    .order('slot', { ascending: true });
  const first = (frames ?? []).find((f: { slot: number }) => f.slot === 1);
  const design = first
    ? { id: first.id, canvas_json: first.canvas_json, format: first.format, status: first.status }
    : null;

  // ── Écran d'accueil (s'il existe et si l'onglet est ouvert) ─
  const { data: homeDesign } = homeEditor
    ? await db
      .from('client_designs')
      .select('id, canvas_json, format, status, final_png_url')
      .eq('event_id', event.id)
      .eq('kind', 'home')
      .maybeSingle()
    : { data: null };

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

  // ── Aperçu sur la borne : écran de partage publié par l'organisation (LAB-308) ─
  const { data: resultScreen } = orgId
    ? await db
      .from('kiosk_screens')
      .select('published')
      .eq('org_id', orgId)
      .eq('kind', 'result')
      .maybeSingle()
    : { data: null };
  const kioskPreview = buildKioskPreview(form_config, resultScreen?.published ?? null);

  return corsResponse(200, {
    event,
    design,
    home_editor:   homeEditor,
    home_design:   homeDesign ?? null,
    frame_choice:  frameChoice,
    frames:        frameChoice.enabled ? frames ?? [] : null,
    form_answers:  prevFormResponse?.answers ?? null,
    kiosk_preview: kioskPreview,
  });
});
