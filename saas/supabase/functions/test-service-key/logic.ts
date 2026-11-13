// Test d'une clé de service par un appel en lecture seule (open core L6a).
// Logique pure (fetch et lecture des clés injectés) : testée par logic.test.ts sous `node --test`.
// Ne renvoie jamais la clé ni le corps d'une erreur du fournisseur, seulement le statut HTTP.

import { GOOGLE_KEY_NAMES, getServiceKey } from '../_shared/service-keys.ts';
import type { EnvGet, ResolvedSecret, SecretSource } from '../_shared/secrets.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ReadSecret = (name: string) => Promise<ResolvedSecret>;

export interface KeyTestResult { ok: boolean; source: SecretSource; message: string }

export const TEST_TIMEOUT_MS = 10_000;

export const ENDPOINTS = {
  brevo: 'https://api.brevo.com/v3/account',
  anthropic: 'https://api.anthropic.com/v1/models',
  replicate: 'https://api.replicate.com/v1/account',
  googleToken: 'https://oauth2.googleapis.com/token',
  // Même base que _shared/modules/invoicing/pennylane.ts ; GET /customers fait partie des droits déjà utilisés.
  pennylane: 'https://app.pennylane.com/api/external/v2/customers?limit=1',
};

const SOURCE_LABEL: Record<SecretSource, string> = {
  vault: 'clé saisie dans Paramètres',
  env: 'variable d\'environnement du serveur',
  none: 'aucune clé',
};

export function sourceLabel(source: SecretSource): string {
  return SOURCE_LABEL[source];
}

function isMockEnabled(env: EnvGet): boolean {
  const v = (env('PENNYLANE_MOCK') ?? '').trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

function statusMessage(status: number): string {
  if (status === 400 || status === 401 || status === 403) {
    return `Clé refusée par le service (HTTP ${status}).`;
  }
  return `Le service a répondu HTTP ${status}. Réessayez plus tard.`;
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ status: number } | { failed: true }> {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    return { status: res.status };
  } catch {
    return { failed: true };
  }
}

function requestFor(name: string, values: Record<string, string>): { url: string; init: RequestInit } {
  switch (name) {
    case 'BREVO_API_KEY':
      return { url: ENDPOINTS.brevo, init: { headers: { 'api-key': values[name], Accept: 'application/json' } } };
    case 'ANTHROPIC_API_KEY':
      return {
        url: ENDPOINTS.anthropic,
        init: { headers: { 'x-api-key': values[name], 'anthropic-version': '2023-06-01' } },
      };
    case 'REPLICATE_API_TOKEN':
      return { url: ENDPOINTS.replicate, init: { headers: { Authorization: `Bearer ${values[name]}` } } };
    case 'PENNYLANE_API_KEY':
      return {
        url: ENDPOINTS.pennylane,
        init: { headers: { Authorization: `Bearer ${values[name]}`, Accept: 'application/json' } },
      };
    default:
      // Trio Google : échange du jeton d'actualisation contre un jeton d'accès (aucune écriture).
      return {
        url: ENDPOINTS.googleToken,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: values.GOOGLE_CLIENT_ID,
            client_secret: values.GOOGLE_CLIENT_SECRET,
            refresh_token: values.GOOGLE_REFRESH_TOKEN,
            grant_type: 'refresh_token',
          }).toString(),
        },
      };
  }
}

/** `null` si `name` n'est pas une clé testable du catalogue. */
export async function testServiceKey(
  name: string,
  readSecret: ReadSecret,
  fetchImpl: FetchLike,
  env: EnvGet,
): Promise<KeyTestResult | null> {
  const key = getServiceKey(name);
  if (!key?.testable) return null;

  const names = GOOGLE_KEY_NAMES.includes(name) ? GOOGLE_KEY_NAMES : [name];
  const resolved = await Promise.all(names.map((n) => readSecret(n)));
  const source = resolved[names.indexOf(name)].source;

  const missing = names.filter((_, i) => !resolved[i].value);
  if (missing.length) {
    const message = names.length > 1
      ? `Clé manquante : ${missing.map((n) => getServiceKey(n)?.label ?? n).join(', ')}. Les trois clés Google sont nécessaires.`
      : 'Aucune clé : ni saisie ici, ni variable d\'environnement sur le serveur.';
    return { ok: false, source, message };
  }

  if (name === 'PENNYLANE_API_KEY' && isMockEnabled(env)) {
    return { ok: false, source, message: 'Simulation Pennylane active (PENNYLANE_MOCK) : test non effectué.' };
  }

  const values = Object.fromEntries(names.map((n, i) => [n, resolved[i].value as string]));
  const { url, init } = requestFor(name, values);
  const result = await call(fetchImpl, url, init);
  if ('failed' in result) return { ok: false, source, message: 'Service injoignable. Réessayez plus tard.' };
  if (result.status >= 200 && result.status < 300) {
    return { ok: true, source, message: names.length > 1 ? 'Clés Google valides.' : 'Clé valide.' };
  }
  return { ok: false, source, message: statusMessage(result.status) };
}
