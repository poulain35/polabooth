/**
 * POST /functions/v1/submit-design
 *
 * Sauvegarde le design final (PNG + JSON), marque l'événement comme soumis,
 * déclenche le webhook configuré et envoie un email de notification à l'admin.
 *
 * Body:
 * {
 *   "code":        "A3K9X2",
 *   "canvas_json": { ...fabric.js state... },
 *   "format":      "portrait",
 *   "png_base64":  "data:image/png;base64,..."  // PNG haute résolution
 * }
 *
 * Réponse: { "design_id": "uuid", "message": "Template soumis avec succès" }
 */

import { decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { requireFeature } from '../_shared/features.ts';
import { sendSubmitNotificationEmail } from '../_shared/email.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { templateLinkExpired } from '../_shared/expiry.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { appUrl } from '../_shared/app-url.ts';

const APP_URL = appUrl();

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
    code?: string;
    canvas_json?: unknown;
    format?: string;
    png_base64?: string;
  };

  if (!code || !canvas_json || !format || !png_base64) {
    return corsResponse(400, { error: 'Champs requis manquants: code, canvas_json, format, png_base64' });
  }

  const db = adminClient();
  const accessCode = code.toUpperCase().trim();
  const guard = publicGuard('submit-design', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.submitDesignCode, accessCode], [LIMITS.submitDesignIp, guard.ip]],
    { codeFailures: true },
  );
  if (limited) return limited;

  // ── Valider le code d'accès ───────────────────────────────
  const { data: event, error: evtErr } = await db
    .from('events')
    .select('id, name, client_name, client_email, org_id, status, end_date')
    .eq('access_code', accessCode)
    .single();

  if (evtErr || !event) {
    await guard.codeFailed();
    return corsResponse(404, { error: 'Code d\'accès invalide' });
  }
  if (event.status === 'archived') {
    return corsResponse(403, { error: 'Événement clôturé' });
  }
  if (templateLinkExpired(event.end_date)) {
    return corsResponse(403, { error: 'Lien expiré' });
  }
  const disabled = await requireFeature(db, event.org_id, 'client_design');
  if (disabled) return disabled;

  // ── Upload du PNG dans Supabase Storage ───────────────────
  let finalPngUrl: string | null = null;
  try {
    const base64Data = (png_base64 as string).replace(/^data:image\/png;base64,/, '');
    const binary     = decodeBase64(base64Data);
    const fileName   = `${event.id}/${fmtTimestamp(new Date())}.png`;

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
        canvas_json:   canvas_json,
        format:        format,
        final_png_url: finalPngUrl,
        status:        'submitted',
        submitted_at:  new Date().toISOString(),
      },
      { onConflict: 'event_id' }  // un seul design par événement
    )
    .select('id')
    .single();

  if (designErr || !design) {
    console.error(designErr);
    return corsResponse(500, { error: 'Erreur lors de la sauvegarde du design' });
  }

  // ── Mettre à jour le statut de l'événement ────────────────
  await db.from('events').update({ status: 'submitted' }).eq('id', event.id);

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
      event:        'design.submitted',
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
  if (org?.notify_email) {
    await sendSubmitNotificationEmail({
      to:         org.notify_email,
      eventName:  event.name,
      clientName: event.client_name ?? 'Anonyme',
      adminUrl:   adminUrl,
      sender:     await orgSender(db, event.org_id),
    });
  }

  return corsResponse(200, {
    design_id: design.id,
    message:   'Template soumis avec succès',
  });
});
