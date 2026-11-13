// Clés des services lues par les edge functions (open core, lot L6b) : la valeur saisie dans
// Paramètres > Clés (Vault, RPC get_service_key), sinon la variable d'environnement du même nom.
// Un seul client par instance de fonction : le cache de secrets.ts (60 s) y est rattaché, une clé
// n'est donc pas relue à chaque email ou à chaque appel Pennylane.
// Aucun import du code privé (open core, lot L3b) : le client Pennylane est dans pennylane.ts.
// Appel REST direct, sans esm.sh : email.ts l'importe et reste chargeable sous `node --test`.
// Sans SUPABASE_URL ni clé service (tests) : variable d'environnement seulement.
// Ne jamais logguer une valeur.

import { denoEnv, getSecret, getSecrets, type EnvGet, type SecretsDb } from './secrets.ts';

/** Client minimal (RPC PostgREST) avec la clé service_role ; null sans configuration Supabase. */
export function restSecretsDb(env: EnvGet = denoEnv, fetchImpl: typeof fetch = (...a) => fetch(...a)): SecretsDb | null {
  const url = env('SUPABASE_URL')?.replace(/\/+$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return {
    async rpc(fn, args = {}) {
      const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!res.ok) return { data: null, error: { status: res.status } };
      return { data: await res.json().catch(() => null), error: null };
    },
  };
}

let db: SecretsDb | null | undefined;

function serviceDb(): SecretsDb | null {
  if (db === undefined) db = restSecretsDb();
  return db;
}

const envOnly = (name: string) => {
  const value = denoEnv(name)?.trim();
  return value ? value : null;
};

/** Clé `name` (ex. BREVO_API_KEY) : Paramètres > Clés, sinon variable d'environnement, sinon null. */
export async function serviceSecret(name: string): Promise<string | null> {
  const client = serviceDb();
  return client ? getSecret(client, name) : envOnly(name);
}

/** Plusieurs clés d'un coup (ex. le trio Google). */
export async function serviceSecrets(names: string[]): Promise<Record<string, string | null>> {
  const client = serviceDb();
  return client ? getSecrets(client, names) : Object.fromEntries(names.map((n) => [n, envOnly(n)]));
}

