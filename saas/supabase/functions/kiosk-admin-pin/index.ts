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
import { authenticate, requireOrgAccess } from '../_shared/admin-guard.ts';
import { hashPin, isValidPin } from './pinHash.ts';

const STATUS_COLUMNS = 'admin_pin_set_at, admin_pin_pushed_at, admin_pin_received_at';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const userId = auth.user.id;
  const db = adminClient();

  let body: { action?: string; license_id?: string; pin?: unknown };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const { action, license_id } = body;
  if (!license_id || typeof license_id !== 'string') return corsResponse(400, { error: 'license_id requis' });

  // Propriétaire de l'organisation de la borne, ou administrateur de l'application (LAB-242).
  // Une borne retirée n'est plus gérée : l'écriture plus bas filtre retired_at (404).
  const access = await requireOrgAccess(db, userId, { kind: 'kiosk_license', id: license_id }, { allowAppAdmin: true });
  if (access.response) return access.response;

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

  if (error) {
    console.error('kiosk-admin-pin : écriture impossible', error);
    return corsResponse(500, { error: 'Enregistrement impossible, réessayez dans un instant.' });
  }
  if (!data) {
    return corsResponse(404, {
      error: action === 'push' ? 'Définissez d’abord un PIN pour cette borne' : 'Borne introuvable',
    });
  }
  return corsResponse(200, data);
});
