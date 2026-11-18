// Open core L6a : test d'une clé de service, fetch simulé (aucun appel réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENDPOINTS, serviceStatus, testServiceKey, type FetchLike } from './logic.ts';
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

test('Replicate : GET en Bearer', async () => {
  const { calls, fetchImpl } = mockFetch(200);
  const res = await testServiceKey('REPLICATE_API_TOKEN', reader({ REPLICATE_API_TOKEN: vault('tok') }), fetchImpl, noEnv);
  assert.equal(res?.ok, true);
  assert.equal(calls[0].url, 'https://api.replicate.com/v1/account');
  assert.equal(calls[0].init?.method, undefined, 'GET');
  assert.equal(headersOf(calls[0]).Authorization, 'Bearer tok');
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

// ── Action « status » (LAB-344) ──────────────────────────────────────────────

const envOf = (vars: Record<string, string>): EnvGet => (n) => vars[n];

test('status : provenance de chaque clé du catalogue, jamais leur valeur', async () => {
  const res = await serviceStatus(reader({
    BREVO_API_KEY: vault('xkeysib-tres-secrete'),
    ANTHROPIC_API_KEY: env('sk-tres-secret'),
  }), envOf({ FROM_EMAIL: 'contact@exemple.fr', SMTP_PASSWORD: 'mdp-tres-secret' }));
  assert.deepEqual(Object.keys(res.keys).sort(), SERVICE_KEYS.map((k) => k.name).sort());
  assert.equal(res.keys.BREVO_API_KEY, 'vault');
  assert.equal(res.keys.ANTHROPIC_API_KEY, 'env');
  assert.equal(res.keys.REPLICATE_API_TOKEN, 'none');
  assert.deepEqual(res.email, { provider: 'brevo', ready: true, missing: [] });
  assert.doesNotMatch(JSON.stringify(res), /tres-secret|contact@exemple/);
});

test('status : Brevo sans clé ni FROM_EMAIL → noms des variables absentes', async () => {
  const res = await serviceStatus(reader({}), envOf({}));
  assert.deepEqual(res.email, { provider: 'brevo', ready: false, missing: ['BREVO_API_KEY', 'FROM_EMAIL'] });
});

test("status : sans FROM_EMAIL mais avec l'adresse d'expéditeur de l'organisation → FROM_EMAIL non réclamée", async () => {
  const res = await serviceStatus(reader({ BREVO_API_KEY: vault('k') }), envOf({}), 'contact@exemple.invalid');
  assert.deepEqual(res.email, { provider: 'brevo', ready: true, missing: [] });
  const blank = await serviceStatus(reader({ BREVO_API_KEY: vault('k') }), envOf({}), '  ');
  assert.deepEqual(blank.email.missing, ['FROM_EMAIL']);
});

test('status : SMTP complet (choisi automatiquement sans clé Brevo) → prêt', async () => {
  const res = await serviceStatus(reader({}), envOf({
    SMTP_HOST: 'smtp.exemple.fr', SMTP_USER: 'u', SMTP_PASSWORD: 'p', FROM_EMAIL: 'noreply@exemple.fr',
  }));
  assert.deepEqual(res.email, { provider: 'smtp', ready: true, missing: [] });
});

test('status : SMTP incomplet → variables manquantes nommées', async () => {
  const partial = await serviceStatus(reader({}), envOf({ SMTP_HOST: 'smtp.exemple.fr', FROM_EMAIL: 'a@exemple.fr' }));
  assert.deepEqual(partial.email, { provider: 'smtp', ready: false, missing: ['SMTP_USER', 'SMTP_PASSWORD'] });
  const none = await serviceStatus(reader({}), envOf({ EMAIL_PROVIDER: 'smtp' }));
  assert.deepEqual(none.email.missing, ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'FROM_EMAIL']);
});

test('status : aucun appel au fournisseur, garde avant la lecture du corps', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const logic = readFileSync(new URL('./logic.ts', import.meta.url), 'utf8');
  const statusCode = logic.slice(logic.indexOf('export async function serviceStatus'));
  assert.doesNotMatch(statusCode, /fetch/);
  assert.ok(src.indexOf('requireAppAdmin(') < src.indexOf("action === 'status'"));
});

// ── Cas aux limites du statut (LAB-346) ──────────────────────────────────────

test('status SMTP : ni hôte, ni identifiant, ni mot de passe, ni expéditeur dans la réponse', async () => {
  const res = await serviceStatus(reader({ GOOGLE_CLIENT_ID: vault('gid-tres-secret') }), envOf({
    SMTP_HOST: 'smtp.hote-secret.fr', SMTP_USER: 'identifiant-secret', SMTP_PASSWORD: 'mdp-tres-secret',
    FROM_EMAIL: 'expediteur@exemple.fr',
  }));
  assert.deepEqual(res.email, { provider: 'smtp', ready: true, missing: [] });
  assert.doesNotMatch(JSON.stringify(res), /secret|expediteur|hote/);
  assert.deepEqual(Object.keys(res).sort(), ['email', 'keys']);
  assert.equal(Object.keys(res.keys).length, SERVICE_KEYS.length);
  assert.ok(Object.values(res.keys).every((s) => ['vault', 'env', 'none'].includes(s)));
});

test('status : EMAIL_PROVIDER=smtp l’emporte sur une clé Brevo', async () => {
  const res = await serviceStatus(reader({ BREVO_API_KEY: vault('xkeysib') }), envOf({
    EMAIL_PROVIDER: 'smtp', FROM_EMAIL: 'a@exemple.fr',
  }));
  assert.deepEqual(res.email, { provider: 'smtp', ready: false, missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] });
  assert.equal(res.keys.BREVO_API_KEY, 'vault');
});

test('status : SMTP_USER ou FROM_EMAIL faits d’espaces comptés comme absents', async () => {
  const res = await serviceStatus(reader({}), envOf({
    SMTP_HOST: 'smtp.exemple.fr', SMTP_USER: '   ', SMTP_PASSWORD: 'p', FROM_EMAIL: '  ',
  }));
  assert.deepEqual(res.email, { provider: 'smtp', ready: false, missing: ['SMTP_USER', 'FROM_EMAIL'] });
});

test('index.ts : l’action status répond avant tout test de clé (jamais d’appel fournisseur)', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(src.indexOf("action === 'status'") < src.indexOf('testServiceKey(name'));
  const statusBlock = src.slice(src.indexOf("action === 'status'"), src.indexOf('testServiceKey(name'));
  // Adresse d'expéditeur de l'organisation du compte (la même que celle des vrais envois), puis réponse.
  assert.match(statusBlock, /\.eq\('owner_id', auth\.user\.id\)/);
  assert.match(statusBlock, /orgSender\(db, org\?\.id\)/);
  assert.match(statusBlock, /return corsResponse\(200, await serviceStatus\(readSecret, denoEnv, sender\.email\)\)/);
  assert.doesNotMatch(statusBlock, /fetch\(/);
});
