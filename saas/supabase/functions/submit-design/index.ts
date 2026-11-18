/**
 * POST /functions/v1/submit-design
 *
 * Sauvegarde le design final (PNG + JSON), marque l'événement comme soumis,
 * déclenche le webhook configuré et envoie un email de notification à l'admin.
 *
 * kind (LAB-289) : 'print' (modèle photo, défaut) ou 'home' (écran d'accueil de la borne). Pour
 * 'home' : format 'home', PNG d'exactement 1920×1080 rangé dans designs/{event_id}/home/,
 * events.status inchangé, webhook 'home_design.submitted', notification « écran d'accueil
 * envoyé ». Refusé si l'onglet n'est pas ouvert (form_config.kiosk.home).
 *
 * Design validé (écran d'accueil, ou cadre du modèle photo depuis LAB-294) : lecture seule,
 * 409 { error, code: 'design_locked' }, statut inchangé ; l'admin le rouvre en le refusant.
 *
 * Plusieurs cadres (LAB-312) : "slot" (1 par défaut, 1 à 4) choisit le cadre du modèle photo,
 * refusé au-delà de frame_choice.max_frames (403) ; "label" (24 caractères, facultatif) est son nom
 * sur la borne. PNG d'un cadre > 1 : designs/{event_id}/{horodatage}_slot{n}.png.
 *
 * Un email par événement (LAB-322) : l'admin n'est prévenu que quand plus aucun cadre créé n'est à
 * envoyer (brouillon, ou refusé pas encore renvoyé), par un seul email qui liste les cadres à valider.
 * "notify": false (cadres d'un envoi groupé avant le dernier) : pas d'email. Un seul cadre : email
 * d'avant. Règles : ../_shared/design-frames.ts.
 *
 * Body:
 * {
 *   "code":        "A3K9X2",
 *   "canvas_json": { ...fabric.js state... },
 *   "format":      "portrait",
 *   "kind":        "print",                      // facultatif : 'print' (défaut) ou 'home'
 *   "slot":        1,                            // facultatif : numéro du cadre (1 par défaut)
 *   "label":       "Cadre 1",                    // facultatif : nom du cadre (modèle photo)
 *   "notify":      false,                        // facultatif : false = pas d'email admin (envoi groupé)
 *   "png_base64":  "data:image/png;base64,..."  // PNG haute résolution
 * }
 *
 * Réponse: { "design_id": "uuid", "message": "Design envoyé avec succès" }
 */

import { decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { eventByCode, normalizeAccessCode } from '../_shared/event-by-code.ts';
import { sendHtmlEmail, sendSubmitNotificationEmail } from '../_shared/email.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { appUrl } from '../_shared/app-url.ts';
import { openFrames, renderFramesSubmitNotificationEmail, submitNotification } from '../_shared/design-frames.ts';
import {
  DESIGN_LOCKED_CODE, FRAME_LIMIT_ERROR, HOME_DISABLED_ERROR, clientCanWriteSlot, clientDesignLocked,
  designLockedError, formatAllowedForKind, homeEditorEnabled, parseDesignKind, parseDesignSlot, parseFrameLabel,
  slotAllowedForKind,
} from '../_shared/design-kind.ts';
import {
  designPngPath, pngFitsKind, renderHomeSubmitNotificationEmail, submitSuccessMessage,
  submitUpdatesEventStatus, submitWebhookEvent,
} from './logic.ts';

const APP_URL = appUrl();

type SubmitEvent = { name: string; client_name: string | null; client_email: string | null; form_config: unknown };

function fmtTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return corsResponse(405, { error: 'Method not allowed' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return corsResponse(400, { error: 'Body JSON invalide' });
  }

  const { code, canvas_json, format, png_base64 } = body as {
    code?: unknown;
    canvas_json?: unknown;
    format?: string;
    png_base64?: string;
  };

  const accessCode = normalizeAccessCode(code);
  if (!accessCode || !canvas_json || !format || !png_base64) {
    return corsResponse(400, { error: 'Champs requis manquants: code, canvas_json, format, png_base64' });
  }
  const kind = parseDesignKind(body.kind);
  if (!kind) return corsResponse(400, { error: 'kind invalide (print ou home)' });
  if (!formatAllowedForKind(kind, format)) {
    return corsResponse(400, { error: 'format invalide pour ce design' });
  }
  const slot = parseDesignSlot(body.slot);
  if (slot === null || !slotAllowedForKind(kind, slot)) return corsResponse(400, { error: 'slot invalide' });
  const label = kind === 'print' ? parseFrameLabel(body.label) : undefined;
  const notify = body.notify !== false;

  const db = adminClient();
  const guard = publicGuard('submit-design', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.submitDesignCode, accessCode], [LIMITS.submitDesignIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  // ── Valider le code d'accès ───────────────────────────────
  const found = await eventByCode<SubmitEvent>(db, accessCode, {
    fn: 'submit-design',
    columns: ['name', 'client_name', 'client_email', 'form_config'],
    guard,
    notFound: { status: 404, error: 'Code d\'accès invalide' },
    archived: { status: 403, error: 'Événement clôturé' },
    expiry: { rule: 'template', refusal: { status: 403, error: 'Lien expiré' } },
    feature: 'client_design',
  });
  if (found.response) return found.response;
  const { event } = found;
  if (!clientCanWriteSlot(kind, slot, event.form_config)) return corsResponse(403, { error: FRAME_LIMIT_ERROR });

  // ── Onglet de l'écran d'accueil ouvert ; design (écran ou cadre) pas encore validé ──
  if (kind === 'home' && !homeEditorEnabled(event.form_config)) return corsResponse(403, { error: HOME_DISABLED_ERROR });
  if (await clientDesignLocked(db, event.id, kind, slot)) {
    return corsResponse(409, { error: designLockedError(kind), code: DESIGN_LOCKED_CODE });
  }

  let binary: Uint8Array;
  try {
    binary = decodeBase64((png_base64 as string).replace(/^data:image\/png;base64,/, ''));
  } catch {
    return corsResponse(400, { error: 'PNG invalide' });
  }
  if (!pngFitsKind(kind, binary)) {
    return corsResponse(400, { error: "L'écran d'accueil doit être un PNG de 1920×1080 px" });
  }

  // ── Upload du PNG dans Supabase Storage ───────────────────
  let finalPngUrl: string | null = null;
  try {
    const fileName = designPngPath(event.id, kind, fmtTimestamp(new Date()), slot);

    const { data: uploaded, error: storageErr } = await db.storage
      .from('designs')
      .upload(fileName, binary, { contentType: 'image/png', upsert: true });

    if (storageErr) {
      console.error('Storage error:', storageErr);
    } else {
      const { data: { publicUrl } } = db.storage.from('designs').getPublicUrl(uploaded.path);
      finalPngUrl = publicUrl;
    }
  } catch (e) {
    console.error('Erreur upload PNG:', e);
  }

  // ── Sauvegarder / mettre à jour le design ─────────────────
  const { data: design, error: designErr } = await db
    .from('client_designs')
    .upsert(
      {
        event_id:      event.id,
        kind,
        slot,
        ...(label === undefined ? {} : { label }),
        canvas_json:   canvas_json,
        format:        format,
        final_png_url: finalPngUrl,
        status:        'submitted',
        submitted_at:  new Date().toISOString(),
      },
      { onConflict: 'event_id,kind,slot' }
    )
    .select('id')
    .single();

  if (designErr || !design) {
    console.error(designErr);
    return corsResponse(500, { error: 'Erreur lors de la sauvegarde du design' });
  }

  // ── Mettre à jour le statut de l'événement (modèle photo seulement) ──
  if (submitUpdatesEventStatus(kind)) {
    await db.from('events').update({ status: 'submitted' }).eq('id', event.id);
  }

  // ── Récupérer la config de l'organisation ─────────────────
  const { data: org } = await db
    .from('organizations')
    .select('webhook_url, notify_email')
    .eq('id', event.org_id)
    .single();

  const adminUrl = `${APP_URL}/admin/events/${event.id}`;

  // ── Déclencher le webhook ─────────────────────────────────
  if (org?.webhook_url) {
    const payload = {
      event:        submitWebhookEvent(kind),
      event_id:     event.id,
      event_name:   event.name,
      client_name:  event.client_name ?? 'Anonyme',
      submitted_at: new Date().toISOString(),
      format:       format,
      download_url: finalPngUrl ?? null,
      admin_url:    adminUrl,
    };
    // Fire & forget
    fetch(org.webhook_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }).catch((e) => console.error('Webhook error:', e));
  }

  // ── Email de notification à l'admin ──────────────────────
  if (org?.notify_email && kind === 'home') {
    const { subject, html } = renderHomeSubmitNotificationEmail({
      eventName:  event.name,
      clientName: event.client_name ?? 'Anonyme',
      adminUrl,
    });
    try {
      await sendHtmlEmail({ to: org.notify_email, subject, html, sender: await orgSender(db, event.org_id) });
    } catch (e) {
      console.error("Notification écran d'accueil :", e);
    }
  } else if (org?.notify_email && notify) {
    // Cadres lus après l'enregistrement : un email quand tous les cadres créés sont envoyés.
    const { data: rows } = await db
      .from('client_designs')
      .select('id, slot, label, format, status')
      .eq('event_id', event.id)
      .eq('kind', 'print');
    const frames = openFrames(rows, event.form_config, design.id);
    const mode = submitNotification(frames, notify);
    if (mode === 'single') {
      await sendSubmitNotificationEmail({
        to:         org.notify_email,
        eventName:  event.name,
        clientName: event.client_name ?? 'Anonyme',
        adminUrl:   adminUrl,
        sender:     await orgSender(db, event.org_id),
      });
    } else if (mode === 'frames') {
      const { subject, html } = renderFramesSubmitNotificationEmail({
        eventName:  event.name,
        clientName: event.client_name ?? 'Anonyme',
        adminUrl,
        frames,
      });
      try {
        await sendHtmlEmail({ to: org.notify_email, subject, html, sender: await orgSender(db, event.org_id) });
      } catch (e) {
        console.error('Notification des cadres :', e);
      }
    }
  }

  return corsResponse(200, {
    design_id: design.id,
    message:   submitSuccessMessage(kind),
  });
});
