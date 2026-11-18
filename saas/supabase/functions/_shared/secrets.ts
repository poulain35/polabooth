// Clés des services (open core, lot L6) : valeur saisie dans Paramètres > Clés (Supabase Vault,
// RPC get_service_key réservée à service_role), sinon variable d'environnement du même nom.
// Sans clé saisie, la prod continue donc de marcher avec ses secrets d'edge functions.
// Ne jamais logguer une valeur.
// Sans import Deno/esm.sh : testé par secrets.test.ts sous `node --test`.

export type SecretSource = 'vault' | 'env' | 'none';
export interface ResolvedSecret { value: string | null; source: SecretSource }
export type EnvGet = (name: string) => string | undefined;

// deno-lint-ignore no-explicit-any
export interface SecretsDb { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> }
// deno-lint-ignore no-explicit-any
export interface SettingsDb { from(table: string): any }

export const denoEnv: EnvGet = (name) =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);

// Durée de vie du cache : un client créé au niveau du module survit à plusieurs requêtes ;
// une clé remplacée dans l'écran est vue au plus tard après ce délai.
export const SECRET_CACHE_TTL_MS = 60_000;

const caches = new WeakMap<object, Map<string, { at: number; promise: Promise<ResolvedSecret> }>>();

function cacheFor(db: object) {
  let cache = caches.get(db);
  if (!cache) { cache = new Map(); caches.set(db, cache); }
  return cache;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

async function readSecret(db: SecretsDb, name: string, env: EnvGet): Promise<ResolvedSecret> {
  try {
    const { data, error } = await db.rpc('get_service_key', { p_name: name });
    const stored = error ? null : nonEmpty(data);
    if (stored) return { value: stored, source: 'vault' };
  } catch { /* RPC absente ou réseau : repli sur l'environnement */ }
  const fromEnv = nonEmpty(env(name));
  return fromEnv ? { value: fromEnv, source: 'env' } : { value: null, source: 'none' };
}

/** Valeur et provenance d'une clé. Mise en cache par client et par nom (SECRET_CACHE_TTL_MS). */
export function resolveSecret(
  db: SecretsDb,
  name: string,
  env: EnvGet = denoEnv,
  now: () => number = Date.now,
): Promise<ResolvedSecret> {
  const cache = cacheFor(db);
  const hit = cache.get(name);
  if (hit && now() - hit.at < SECRET_CACHE_TTL_MS) return hit.promise;
  const promise = readSecret(db, name, env);
  cache.set(name, { at: now(), promise });
  return promise;
}

/** Clé du service `name` (ex. BREVO_API_KEY) : Vault, sinon variable d'environnement, sinon null. */
export async function getSecret(db: SecretsDb, name: string, env: EnvGet = denoEnv): Promise<string | null> {
  return (await resolveSecret(db, name, env)).value;
}

/** Plusieurs clés d'un coup (ex. le trio Google). */
export async function getSecrets(
  db: SecretsDb,
  names: string[],
  env: EnvGet = denoEnv,
): Promise<Record<string, string | null>> {
  const values = await Promise.all(names.map((name) => getSecret(db, name, env)));
  return Object.fromEntries(names.map((name, i) => [name, values[i]]));
}

/**
 * Réglage non secret (organizations.service_settings, ex. assistant_model) : valeur de l'org,
 * sinon variable d'environnement `envName`, sinon null. Sans `orgId` : la première entreprise de
 * l'installation (une seule entreprise par installation, décision D1). Lecture en échec : repli env.
 */
export async function getServiceSetting(
  db: SettingsDb,
  orgId: string | null | undefined,
  key: string,
  envName: string,
  env: EnvGet = denoEnv,
): Promise<string | null> {
  try {
    let query = db.from('organizations').select('service_settings');
    query = orgId ? query.eq('id', orgId) : query.order('created_at').limit(1);
    const { data, error } = await query.maybeSingle();
    const stored = error ? null : nonEmpty(data?.service_settings?.[key]);
    if (stored) return stored;
  } catch { /* repli sur l'environnement */ }
  return nonEmpty(env(envName));
}
