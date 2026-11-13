// Open core L6a : test d'une clé de service, fetch simulé (aucun appel réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENDPOINTS, testServiceKey, type FetchLike } from './logic.ts';
import { SERVICE_KEYS } from '../_shared/service-keys.ts';
import type { EnvGet, ResolvedSecret } from '../_shared/secrets.ts';

type Call = { url: string; init?: RequestInit };

function mockFetch(status: number | 'network', body = '{"secret":"detail fournisseur"}') {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    if (status === 'network') return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(new Response(body, { status }));
  };
  return { calls, fetchImpl };
}

const reader = (secrets: Record<string, ResolvedSecret>) =>
  (name: string) => Promise.resolve(secrets[name] ?? { value: null, source: 'none' as const });
const vault = (value: string): ResolvedSecret => ({ value, source: 'vault' });
const env = (value: string): ResolvedSecret => ({ value, source: 'env' });
const noEnv: EnvGet = () => undefined;
const headersOf = (c: Call) => (c.init?.headers ?? {}) as Record<string, string>;

test('Brevo : GET /v3/account avec l\'en-tête api-key', async () => {
  const { calls, fetchImpl } = mockFetch(200);
  const res = await testServiceKey('BREVO_API_KEY', reader({ BREVO_API_KEY: vault('xkeysib-123') }), fetchImpl, noEnv);
  assert.deepEqual(res, { ok: true, source: 'vault', message: 'Clé valide.' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINTS.brevo);
  assert.equal(calls[0].init?.method, undefined, 'GET');
  assert.equal(headersOf(calls[0])['api-key'], 'xkeysib-123');
});

test('Anthropic : GET /v1/models avec x-api-key et anthropic-version', async () => {
  const { calls, fetchImpl } = mockFetch(200);
  const res = await testServiceKey('ANTHROPIC_API_KEY', reader({ ANTHROPIC_API_KEY: env('sk-ant') }), fetchImpl, noEnv);
  assert.equal(res?.ok, true);
  assert.equal(res?.source, 'env');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models');
  assert.deepEqual(headersOf(calls[0]), { 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' });
});

test('Replicate et Pennylane : GET en Bearer', async () => {
  for (const [name, url] of [
    ['REPLICATE_API_TOKEN', 'https://api.replicate.com/v1/account'],
    ['PENNYLANE_API_KEY', 'https://app.pennylane.com/api/external/v2/customers?limit=1'],
  ]) {
    const { calls, fetchImpl } = mockFetch(200);
    const res = await testServiceKey(name, reader({ [name]: vault('tok') }), fetchImpl, noEnv);
    assert.equal(res?.ok, true, name);
    assert.equal(calls[0].url, url);
    assert.equal(calls[0].init?.method, undefined, `${name} GET`);
    assert.equal(headersOf(calls[0]).Authorization, 'Bearer tok');
  }
});

test('Google : un seul échange de jeton pour le trio, quelle que soit la clé testée', async () => {
  const secrets = {
    GOOGLE_CLIENT_ID: vault('id.apps.googleusercontent.com'),
    GOOGLE_CLIENT_SECRET: env('secret'),
    GOOGLE_REFRESH_TOKEN: vault('1//refresh'),
  };
  for (const name of Object.keys(secrets)) {
    const { calls, fetchImpl } = mockFetch(200, '{"access_token":"ya29"}');
    const res = await testServiceKey(name, reader(secrets), fetchImpl, noEnv);
    assert.equal(res?.ok, true, name);
    assert.equal(res?.message, 'Clés Google valides.');
    assert.equal(res?.source, secrets[name as keyof typeof secrets].source, name);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
    assert.equal(calls[0].init?.method, 'POST');
    const form = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('client_id'), 'id.apps.googleusercontent.com');
    assert.equal(form.get('client_secret'), 'secret');
    assert.equal(form.get('refresh_token'), '1//refresh');
  }
});

test('Google : une clé du trio manquante → pas d\'appel, message qui la nomme', async () => {
  const { calls, fetchImpl } = mockFetch(200);
  const res = await testServiceKey('GOOGLE_CLIENT_ID', reader({ GOOGLE_CLIENT_ID: vault('id') }), fetchImpl, noEnv);
  assert.equal(res?.ok, false);
  assert.equal(res?.source, 'vault');
  assert.match(res!.message, /Secret client Google, Jeton d'actualisation Google/);
  assert.equal(calls.length, 0);
});

test('aucune clé (ni Vault ni environnement) → source none, pas d\'appel', async () => {
  const { calls, fetchImpl } = mockFetch(200);
  const res = await testServiceKey('REPLICATE_API_TOKEN', reader({}), fetchImpl, noEnv);
  assert.deepEqual(res, { ok: false, source: 'none', message: 'Aucune clé : ni saisie ici, ni variable d\'environnement sur le serveur.' });
  assert.equal(calls.length, 0);
});

test('refus du fournisseur : statut HTTP seulement, jamais la clé ni le corps', async () => {
  for (const status of [401, 403, 400]) {
    const { fetchImpl } = mockFetch(status);
    const res = await testServiceKey('BREVO_API_KEY', reader({ BREVO_API_KEY: vault('cle-tres-secrete') }), fetchImpl, noEnv);
    assert.equal(res?.ok, false);
    assert.equal(res?.message, `Clé refusée par le service (HTTP ${status}).`);
    assert.doesNotMatch(JSON.stringify(res), /cle-tres-secrete|detail fournisseur/);
  }
  const { fetchImpl } = mockFetch(503);
  const down = await testServiceKey('BREVO_API_KEY', reader({ BREVO_API_KEY: vault('k') }), fetchImpl, noEnv);
  assert.equal(down?.message, 'Le service a répondu HTTP 503. Réessayez plus tard.');
});

test('erreur réseau → service injoignable', async () => {
  const { fetchImpl } = mockFetch('network');
  const res = await testServiceKey('ANTHROPIC_API_KEY', reader({ ANTHROPIC_API_KEY: vault('k') }), fetchImpl, noEnv);
  assert.deepEqual(res, { ok: false, source: 'vault', message: 'Service injoignable. Réessayez plus tard.' });
});

test('Pennylane : PENNYLANE_MOCK actif → aucun appel réel', async () => {
  const { calls, fetchImpl } = mockFetch(200);
  const mockEnv: EnvGet = (n) => (n === 'PENNYLANE_MOCK' ? '1' : undefined);
  const res = await testServiceKey('PENNYLANE_API_KEY', reader({ PENNYLANE_API_KEY: env('k') }), fetchImpl, mockEnv);
  assert.equal(res?.ok, false);
  assert.match(res!.message, /PENNYLANE_MOCK/);
  assert.equal(calls.length, 0);
});

test('nom inconnu → null ; chaque clé du catalogue testable a un appel', async () => {
  assert.equal(await testServiceKey('SUPABASE_SERVICE_ROLE_KEY', reader({}), mockFetch(200).fetchImpl, noEnv), null);
  assert.equal(await testServiceKey('', reader({}), mockFetch(200).fetchImpl, noEnv), null);
  const all = Object.fromEntries(SERVICE_KEYS.map((k) => [k.name, vault('v')]));
  for (const key of SERVICE_KEYS.filter((k) => k.testable)) {
    const { calls, fetchImpl } = mockFetch(200);
    assert.equal((await testServiceKey(key.name, reader(all), fetchImpl, noEnv))?.ok, true, key.name);
    assert.equal(calls.length, 1, key.name);
  }
});

test('index.ts : session, puis administrateur de l\'application, avant toute lecture de clé', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(src.indexOf('authenticate(') < src.indexOf('requireAppAdmin('));
  assert.ok(src.indexOf('requireAppAdmin(') < src.indexOf('req.json()'));
  assert.ok(src.indexOf('requireAppAdmin(') < src.indexOf('resolveSecret('));
});
