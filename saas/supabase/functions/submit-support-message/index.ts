/**
 * POST /functions/v1/submit-support-message
 *
 * Escalade « laisser un message » de la page d'aide client : enregistre le message
 * dans support_messages et notifie le loueur par email.
 *
 * Endpoint public (page d'aide) — protégé par l'anon key Supabase.
 *
 * Body: { code?, name?, phone?, message, urgency?, transcript? }
 * Réponse: { ok: true }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { sendSupportNotificationEmail } from '../_shared/email.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { requireFeature } from '../_shared/features.ts';
import { requireInstanceFeature } from '../_shared/feature-guard.ts';

const MAX_MESSAGE_CHARS = 4000;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  let body: {
    code?: unknown; name?: unknown; phone?: unknown;
    message?: unknown; urgency?: unknown; transcript?: unknown;
  };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : '';
  if (!message) return corsResponse(400, { error: 'Message vide' });

  const code    = typeof body.code === 'string' ? body.code.toUpperCase().trim() : null;
  const name    = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : null;
  const phone   = typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : null;
  const urgency = body.urgency === 'blocking' ? 'blocking' : 'normal';
  const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-24) : null;

  const db = adminClient();
  const guard = publicGuard('submit-support-message', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.supportIp, guard.ip], [LIMITS.supportIpDay, guard.ip]]);
  if (limited) return limited;

  // Résoudre l'événement + l'org + le contact loueur depuis le code (si fourni).
  let eventId: string | null = null;
  let orgId: string | null = null;
  let eventName = '';
  let contactEmail = '';
  if (code) {
    const { data: event } = await db
      .from('events')
      .select('id, org_id, name')
      .eq('access_code', code)
      .maybeSingle();
    if (event) {
      eventId   = event.id;
      orgId     = event.org_id;
      eventName = event.name ?? '';
      if (event.org_id) {
        const { data: org } = await db
          .from('organizations')
          .select('contact_email')
          .eq('id', event.org_id)
          .maybeSingle();
        contactEmail = org?.contact_email ?? '';
      }
    }
  }

  const disabled = orgId ? await requireFeature(db, orgId, 'help') : await requireInstanceFeature(db, 'help');
  if (disabled) return disabled;

  const { error: insErr } = await db.from('support_messages').insert({
    org_id:       orgId,
    event_id:     eventId,
    access_code:  code,
    client_name:  name,
    client_phone: phone,
    message,
    urgency,
    transcript,
  });
  if (insErr) {
    console.error('submit-support-message insert:', insErr);
    return corsResponse(500, { error: 'Enregistrement du message échoué' });
  }

  // Notifier le loueur (best-effort — ne bloque pas la réponse client si l'email échoue).
  const to = contactEmail || Deno.env.get('SUPPORT_NOTIFY_EMAIL') || '';
  if (to) {
    try {
      await sendSupportNotificationEmail({
        to, eventName,
        clientName:  name ?? '',
        clientPhone: phone ?? '',
        message, urgency,
        sender:      await orgSender(db, orgId),
      });
    } catch (e) {
      console.error('support email failed:', e);
    }
  }

  return corsResponse(200, { ok: true });
});
