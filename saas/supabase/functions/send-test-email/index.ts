/**
 * POST /functions/v1/send-test-email  (mise en route, LAB-345 ; Réglages › Services connectés)
 * Réservé aux administrateurs de l'application (app_admins), comme test-service-key.
 *
 * Body    : aucun (ignoré). Le destinataire est l'email du compte connecté, jamais un paramètre.
 * Réponse : 200 { ok, provider: 'brevo' | 'smtp', to, message, hint? }
 *
 * Envoie un email par le même chemin que les vrais envois (sendHtmlEmail : marque, garde-fou,
 * Brevo ou SMTP), avec l'expéditeur de l'organisation du compte. Aucune clé ni aucun secret dans la
 * réponse ; pas de ligne email_logs. 10 envois par heure et par compte.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAppAdmin } from '../_shared/admin-guard.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { sendHtmlEmail } from '../_shared/email.ts';
import { resolveEmailProvider } from '../_shared/email-provider.ts';
import { parseEmailGuardConfig } from '../_shared/email-guard.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
import { smtpConfigFromEnv } from '../_shared/smtp.ts';
import { denoEnv } from '../_shared/secrets.ts';
import { sendTestEmail } from './logic.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const db = adminClient();
  const denied = await requireAppAdmin(db, auth.user.id);
  if (denied) return denied;

  const guard = publicGuard('send-test-email', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.testEmailUser, auth.user.id]]);
  if (limited) return limited;

  const { data: org } = await db
    .from('organizations')
    .select('id')
    .eq('owner_id', auth.user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  const brevoKey = () => serviceSecret('BREVO_API_KEY');
  const result = await sendTestEmail({
    to: auth.user.email,
    provider: await resolveEmailProvider(brevoKey),
    hasBrevoKey: !!(await brevoKey()),
    hasSmtpHost: smtpConfigFromEnv() !== null,
    sender: await orgSender(db, org?.id),
    guard: parseEmailGuardConfig(denoEnv),
  }, sendHtmlEmail);
  if (!result.ok) console.warn(`send-test-email : ${result.message}`);
  return corsResponse(200, result);
});
