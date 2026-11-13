/**
 * POST /functions/v1/kiosk-admin-pin
 * Réservé au propriétaire du compte de la borne et aux administrateurs de l'application
 * (table app_admins).
 *
 * Body:    { action: 'set', license_id: string, pin: string }  → enregistre le hash du PIN
 *          { action: 'push', license_id: string }              → envoie le PIN défini à la borne
 * Réponse: { admin_pin_set_at, admin_pin_pushed_at, admin_pin_received_at }
 *
 * Le PIN ne quitte jamais cette fonction en clair : seul son hash PBKDF2 est stocké.
 * Convention des edge functions : le JWT de l'utilisateur ne sert qu'à auth.getUser() ;
 * les lectures et écritures passent par adminClient() (côté serveur uniquement), après
 * vérification explicite que l'utilisateur est super-admin ou propriétaire du compte de la borne.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { hashPin, isValidPin } from './pinHash.ts';

const STATUS_COLUMNS = 'admin_pin_set_at, admin_pin_pushed_at, admin_pin_received_at';

type Db = ReturnType<typeof adminClient>;

async function requireSession(authHeader: string | null): Promise<{ response: Response } | { db: Db; userId: string }> {
  if (!authHeader) return { response: corsResponse(401, { error: 'Non authentifié' }) };
  const user = await sessionUser(authHeader);
  if (!user) return { response: corsResponse(401, { error: 'Session invalide' }) };
  return { db: adminClient(), userId: user.id };
}

// Super-admin, ou propriétaire du compte de la borne. Une borne retirée n'est plus gérée.
async function requireLicenseAccess(db: Db, userId: string, licenseId: string): Promise<Response | null> {
  const [{ data: admin, error: adminError }, { data: license, error: licenseError }] = await Promise.all([
    db.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    db.from('kiosk_licenses').select('org_id').eq('id', licenseId).is('retired_at', null).maybeSingle(),
  ]);
  if (adminError || licenseError) return corsResponse(500, { error: 'Vérification des droits impossible' });
  if (!license) return corsResponse(404, { error: 'Borne introuvable' });
  if (admin) return null;

  const { data: org, error: orgError } = await db
    .from('organizations')
    .select('id')
    .eq('id', license.org_id)
    .eq('owner_id', userId)
    .maybeSingle();
  if (orgError) return corsResponse(500, { error: 'Vérification des droits impossible' });
  if (!org) return corsResponse(403, { error: 'Réservé au propriétaire de la borne' });
  return null;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const guard = await requireSession(req.headers.get('Authorization'));
  if ('response' in guard) return guard.response;
  const { db, userId } = guard;

  let body: { action?: string; license_id?: string; pin?: unknown };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { action, license_id } = body;
  if (!license_id) return corsResponse(400, { error: 'license_id requis' });

  const denied = await requireLicenseAccess(db, userId, license_id);
  if (denied) return denied;

  const now = new Date().toISOString();
  let patch: Record<string, string>;
  if (action === 'set') {
    if (!isValidPin(body.pin)) return corsResponse(400, { error: 'Le PIN doit contenir 4 à 8 chiffres' });
    patch = { admin_pin_hash: await hashPin(body.pin), admin_pin_set_at: now };
  } else if (action === 'push') {
    patch = { admin_pin_pushed_at: now };
  } else {
    return corsResponse(400, { error: 'action inconnue' });
  }

  let query = db.from('kiosk_licenses').update(patch).eq('id', license_id).is('retired_at', null);
  if (action === 'push') query = query.not('admin_pin_hash', 'is', null);
  const { data, error } = await query.select(STATUS_COLUMNS).maybeSingle();

  if (error) return corsResponse(500, { error: error.message });
  if (!data) {
    return corsResponse(404, {
      error: action === 'push' ? 'Définissez d’abord un PIN pour cette borne' : 'Borne introuvable',
    });
  }
  return corsResponse(200, data);
});
