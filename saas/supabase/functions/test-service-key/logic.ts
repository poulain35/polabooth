// Test d'une clé de service par un appel en lecture seule (open core L6a).
// Logique pure (fetch et lecture des clés injectés) : testée par logic.test.ts sous `node --test`.
// Ne renvoie jamais la clé ni le corps d'une erreur du fournisseur, seulement le statut HTTP.
// Le test des clés d'un module privé est déclaré par le module (keyTests de son catalogue, LAB-403).

import { SERVICE_KEY_NAMES, getServiceKey, type KeyTest } from '../_shared/service-keys.ts';
import { PRIVATE_MODULES } from '../_shared/private-modules.ts';
import type { EnvGet, ResolvedSecret, SecretSource } from '../_shared/secrets.ts';
import { resolveEmailProvider, type EmailProvider } from '../_shared/email-provider.ts';
import { smtpConfigFromEnv } from '../_shared/smtp.ts';
import { identityDefaults } from '../_shared/org-identity.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ReadSecret = (name: string) => Promise<ResolvedSecret>;

export interface KeyTestResult { ok: boolean; source: SecretSource; message: string }

export const TEST_TIMEOUT_MS = 10_000;

export const ENDPOINTS = {
  brevo: 'https://api.brevo.com/v3/account',
};

const SOURCE_LABEL: Record<SecretSource, string> = {
  vault: 'clé saisie dans Paramètres',
  env: 'variable d\'environnement du serveur',
  none: 'aucune clé',
};

export function sourceLabel(source: SecretSource): string {
  return SOURCE_LABEL[source];
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

/** Test des clés seules : celles du code ouvert, puis celles déclarées par les modules privés. */
const KEY_TESTS: Record<string, KeyTest> = {
  BREVO_API_KEY: {
    request: (value) => ({ url: ENDPOINTS.brevo, init: { headers: { 'api-key': value, Accept: 'application/json' } } }),
  },
  ...Object.assign({}, ...PRIVATE_MODULES.map((m) => m.keyTests ?? {})),
};

/** `null` si `name` n'est pas une clé testable du catalogue. */
export async function testServiceKey(
  name: string,
  readSecret: ReadSecret,
  fetchImpl: FetchLike,
  env: EnvGet,
): Promise<KeyTestResult | null> {
  const key = getServiceKey(name);
  const test = KEY_TESTS[name];
  if (!key?.testable || !test) return null;

  const group = test.group;
  const names = group?.names ?? [name];
  const resolved = await Promise.all(names.map((n) => readSecret(n)));
  const source = resolved[names.indexOf(name)].source;

  const missing = names.filter((_, i) => !resolved[i].value);
  if (missing.length) {
    const message = group
      ? `Clé manquante : ${missing.map((n) => getServiceKey(n)?.label ?? n).join(', ')}. ${group.missing}`
      : 'Aucune clé : ni saisie ici, ni variable d\'environnement sur le serveur.';
    return { ok: false, source, message };
  }

  const skipped = test.skip?.(env) ?? null;
  if (skipped) return { ok: false, source, message: skipped };

  const values = Object.fromEntries(names.map((n, i) => [n, resolved[i].value as string]));
  const { url, init } = test.request(values[name], values);
  const result = await call(fetchImpl, url, init);
  if ('failed' in result) return { ok: false, source, message: 'Service injoignable. Réessayez plus tard.' };
  if (result.status >= 200 && result.status < 300) {
    return { ok: true, source, message: group?.ok ?? 'Clé valide.' };
  }
  return { ok: false, source, message: statusMessage(result.status) };
}

// ── Action « status » (mise en route de l'admin, LAB-344) ─────────────────────
// Dit ce qui est réglé, sans appeler aucun fournisseur et sans renvoyer aucune valeur : seulement la
// provenance de chaque clé et les NOMS des variables absentes (les noms ne sont pas des secrets).

export interface ServiceStatus {
  email: { provider: EmailProvider; ready: boolean; missing: string[] };
  keys: Record<string, SecretSource>;
}

const filled = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * État des emails et des clés du catalogue. `email.ready` : transport réglé (Brevo : une clé ;
 * SMTP : SMTP_HOST, SMTP_USER et SMTP_PASSWORD) et adresse d'expéditeur connue. `senderEmail` : l'adresse
 * que les vrais envois utiliseront (`orgSender` : celle saisie pour l'organisation, sinon FROM_EMAIL) ;
 * absente, seule FROM_EMAIL compte. FROM_EMAIL n'est donc réclamée que si aucune adresse n'est connue.
 */
export async function serviceStatus(
  readSecret: ReadSecret,
  env: EnvGet,
  senderEmail?: string,
): Promise<ServiceStatus> {
  const resolved = await Promise.all(SERVICE_KEY_NAMES.map((name) => readSecret(name)));
  const keys: Record<string, SecretSource> = Object.fromEntries(
    SERVICE_KEY_NAMES.map((name, i) => [name, resolved[i].source]),
  );
  const brevo = resolved[SERVICE_KEY_NAMES.indexOf('BREVO_API_KEY')];
  const provider = await resolveEmailProvider(() => Promise.resolve(brevo.value), env);

  const missing: string[] = [];
  if (provider === 'brevo') {
    if (!brevo.value) missing.push('BREVO_API_KEY');
  } else {
    if (!smtpConfigFromEnv(env)) missing.push('SMTP_HOST');
    if (!filled(env('SMTP_USER'))) missing.push('SMTP_USER');
    if (!env('SMTP_PASSWORD')) missing.push('SMTP_PASSWORD');
  }
  if (!filled(senderEmail) && !filled(identityDefaults(env).senderEmail)) missing.push('FROM_EMAIL');

  return { email: { provider, ready: missing.length === 0, missing }, keys };
}
