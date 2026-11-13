// Gardes d'autorisation des edge functions admin et cron.
// Sans import Deno/esm.sh : testé par admin-guard.test.ts sous `node --test`.
// Le client Supabase et getUser() sont injectés (voir sessionUser dans auth.ts).

import { corsResponse } from './cors.ts';
import { timingSafeEqual } from './signed-link.ts';

export const CRON_ONLY_MESSAGE = 'Réservé au cron (service_role).';
export const FORBIDDEN_ORG_MESSAGE =
  "Accès refusé : vous n'êtes pas administrateur de l'organisation de cette ressource.";
export const NO_ORG_MESSAGE = "Accès refusé : réservé aux administrateurs d'une organisation.";

export interface AuthUser { id: string; email?: string | null }
export type GetUser = (authHeader: string) => Promise<AuthUser | null>;

// deno-lint-ignore no-explicit-any
export interface GuardDb { from(table: string): any }

export type OrgResourceKind = 'event' | 'photo' | 'audio_track' | 'design' | 'lead' | 'slot' | 'prospect';
export interface OrgResource { kind: OrgResourceKind; id: string }

const NOT_FOUND: Record<OrgResourceKind, string> = {
  event: 'Événement introuvable',
  photo: 'Photo introuvable',
  audio_track: 'Piste introuvable',
  design: 'Design introuvable',
  lead: 'Lead introuvable',
  slot: 'Créneau introuvable',
  prospect: 'Prospect introuvable',
};

const DIRECT_ORG_TABLE: Partial<Record<OrgResourceKind, string>> = {
  event: 'events',
  lead: 'leads',
  slot: 'booking_slots',
  prospect: 'prospects',
};

const VIA_EVENT_TABLE: Partial<Record<OrgResourceKind, string>> = {
  photo: 'photos',
  audio_track: 'audio_tracks',
  design: 'client_designs',
};

export function bearerToken(authHeader: string | null | undefined): string | null {
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

/** Lit la claim `role` sans vérifier la signature : sûr uniquement derrière verify_jwt = true. */
export function isServiceRoleJwt(authHeader: string | null | undefined): boolean {
  const token = bearerToken(authHeader);
  const payload = token?.split('.')[1];
  if (!payload) return false;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(b64))?.role === 'service_role';
  } catch { return false; }
}

/**
 * Appel pg_cron ou appel interne : clé service_role exacte (comparaison à temps constant),
 * ou JWT de rôle service_role (clé du Vault). La fonction doit garder verify_jwt = true.
 */
export function isServiceRoleRequest(authHeader: string | null | undefined, serviceKey: string | null | undefined): boolean {
  const token = bearerToken(authHeader);
  if (!token) return false;
  if (serviceKey && timingSafeEqual(token, serviceKey)) return true;
  return isServiceRoleJwt(authHeader);
}

export function cronOnly(req: Request, serviceKey: string | null | undefined): Response | null {
  if (isServiceRoleRequest(req.headers.get('Authorization'), serviceKey)) return null;
  return corsResponse(403, { error: 'interdit', message: CRON_ONLY_MESSAGE });
}

export type Guarded<T> = (T & { response?: undefined }) | { response: Response };

export async function authenticate(authHeader: string | null | undefined, getUser: GetUser): Promise<Guarded<{ user: AuthUser }>> {
  if (!authHeader || !bearerToken(authHeader)) return { response: corsResponse(401, { error: 'Non autorisé' }) };
  let user: AuthUser | null = null;
  try { user = await getUser(authHeader); } catch { user = null; }
  if (!user?.id) return { response: corsResponse(401, { error: 'JWT invalide' }) };
  return { user };
}

/** org_id de la ressource ; `found: false` si la ressource n'existe pas. */
export async function resolveOrgId(db: GuardDb, resource: OrgResource): Promise<{ found: boolean; orgId: string | null }> {
  const direct = DIRECT_ORG_TABLE[resource.kind];
  if (direct) {
    const { data, error } = await db.from(direct).select('org_id').eq('id', resource.id).maybeSingle();
    if (error) throw new Error(error.message ?? 'resolveOrgId');
    return data ? { found: true, orgId: data.org_id ?? null } : { found: false, orgId: null };
  }
  const table = VIA_EVENT_TABLE[resource.kind]!;
  const { data, error } = await db.from(table).select('event_id').eq('id', resource.id).maybeSingle();
  if (error) throw new Error(error.message ?? 'resolveOrgId');
  if (!data) return { found: false, orgId: null };
  if (!data.event_id) return { found: true, orgId: null };
  const event = await resolveOrgId(db, { kind: 'event', id: data.event_id });
  return { found: true, orgId: event.orgId };
}

export async function ownsOrg(db: GuardDb, userId: string, orgId: string | null | undefined): Promise<boolean> {
  if (!orgId || !userId) return false;
  const { data, error } = await db.from('organizations').select('id').eq('id', orgId).eq('owner_id', userId).maybeSingle();
  return !error && !!data;
}

export function forbiddenOrg(): Response {
  return corsResponse(403, { error: FORBIDDEN_ORG_MESSAGE });
}

/** L'utilisateur doit être propriétaire de l'organisation de la ressource. */
export async function requireOrgAccess(db: GuardDb, userId: string, resource: OrgResource): Promise<Guarded<{ orgId: string }>> {
  let resolved: { found: boolean; orgId: string | null };
  try { resolved = await resolveOrgId(db, resource); } catch {
    return { response: corsResponse(500, { error: 'Vérification des droits impossible' }) };
  }
  if (!resolved.found) return { response: corsResponse(404, { error: NOT_FOUND[resource.kind] }) };
  if (!(await ownsOrg(db, userId, resolved.orgId))) return { response: forbiddenOrg() };
  return { orgId: resolved.orgId! };
}

/** Pour les actions sans ressource (génération IA) : l'utilisateur doit posséder au moins une organisation. */
export async function requireAnyOrgOwner(db: GuardDb, userId: string): Promise<Response | null> {
  const { data, error } = await db.from('organizations').select('id').eq('owner_id', userId).limit(1);
  if (error) return corsResponse(500, { error: 'Vérification des droits impossible' });
  return Array.isArray(data) && data.length > 0 ? null : corsResponse(403, { error: NO_ORG_MESSAGE });
}

/** Fonctions mixtes (cron / appel interne / bouton admin) : service_role, ou admin de l'org de la ressource. */
export async function requireServiceOrOrgAdmin(
  authHeader: string | null | undefined,
  serviceKey: string | null | undefined,
  getUser: GetUser,
  db: GuardDb,
  resource: OrgResource,
): Promise<Guarded<{ system: boolean }>> {
  if (isServiceRoleRequest(authHeader, serviceKey)) return { system: true };
  const admin = await requireOrgAdmin(authHeader, getUser, db, resource);
  if (admin.response) return admin;
  return { system: false };
}

/** Admin authentifié ET propriétaire de l'org de la ressource. */
export async function requireOrgAdmin(
  authHeader: string | null | undefined,
  getUser: GetUser,
  db: GuardDb,
  resource: OrgResource,
): Promise<Guarded<{ user: AuthUser; orgId: string }>> {
  const auth = await authenticate(authHeader, getUser);
  if (auth.response) return auth;
  const access = await requireOrgAccess(db, auth.user.id, resource);
  if (access.response) return access;
  return { user: auth.user, orgId: access.orgId };
}

export const APP_ADMIN_MESSAGE = "Accès refusé : réservé aux administrateurs de l'application.";

/** Administrateur de l'application (table app_admins, même règle que is_app_admin() en SQL). */
export async function requireAppAdmin(db: GuardDb, userId: string): Promise<Response | null> {
  const { data, error } = await db.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) return corsResponse(500, { error: 'Vérification des droits impossible' });
  return data ? null : corsResponse(403, { error: APP_ADMIN_MESSAGE });
}
