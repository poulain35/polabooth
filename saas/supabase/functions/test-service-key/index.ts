/**
 * POST /functions/v1/test-service-key  (open core L6a, Paramètres > Clés)
 * Réservé aux administrateurs de l'application (app_admins, comme les RPC set_service_key…).
 *
 * Body:    { name: 'BREVO_API_KEY' | 'GOOGLE_CLIENT_ID' | … }
 * Réponse: { ok, source: 'vault' | 'env' | 'none', message }
 *
 * Lit la clé comme les autres fonctions (getSecret : Vault, sinon variable d'environnement) et
 * fait un appel en lecture seule chez le fournisseur. Ne renvoie jamais la clé.
 *
 * Body:    { action: 'status' }  (mise en route de l'admin, LAB-344)
 * Réponse: { email: { provider: 'brevo' | 'smtp', ready, missing: [noms] },
 *            keys: { BREVO_API_KEY: 'vault' | 'env' | 'none', … } }
 * Aucun appel au fournisseur, aucune valeur renvoyée : la provenance des clés et les noms des
 * variables absentes seulement.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAppAdmin } from '../_shared/admin-guard.ts';
import { denoEnv, resolveSecret } from '../_shared/secrets.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { serviceStatus, testServiceKey } from './logic.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const db = adminClient();
  const denied = await requireAppAdmin(db, auth.user.id);
  if (denied) return denied;

  let body: { name?: unknown; action?: unknown };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }
  const readSecret = (n: string) => resolveSecret(db, n, denoEnv);

  if (body?.action === 'status') {
    // Adresse d'expéditeur des vrais envois pour l'organisation du compte (comme send-test-email).
    const { data: org } = await db
      .from('organizations')
      .select('id')
      .eq('owner_id', auth.user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    const sender = await orgSender(db, org?.id);
    return corsResponse(200, await serviceStatus(readSecret, denoEnv, sender.email));
  }

  const name = typeof body?.name === 'string' ? body.name : '';

  const result = await testServiceKey(name, readSecret, fetch, denoEnv);
  if (!result) return corsResponse(400, { error: 'Clé inconnue' });
  return corsResponse(200, result);
});
