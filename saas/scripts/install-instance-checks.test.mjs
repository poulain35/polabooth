// Tests de la phase « Vérifications » de l'installation (LAB-376). Aucun réseau : faux fetch (S3 en
// mémoire) et faux serveur SMTP (socket simulé).
// Fonctions pures : install-checks-storage.test.mjs et install-checks-smtp.test.mjs (LAB-403).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact } from './install-checks-common.mjs';
import { contentMd5, corsRuleJson } from './install-checks-storage.mjs';
import { checksSummaryLine, checksVerdict, runChecks } from './install-instance-checks.mjs';
import { PASSWORD, SECRET_KEY, fakeSmtp } from './install-checks.fixture.mjs';
import { INSTALL_STEPS, stepLabel, validateInstanceEnv } from './install-instance-lib.mjs';

test('redact, checksVerdict, checksSummaryLine', () => {
  const b64 = Buffer.from('motdepasse').toString('base64');
  assert.equal(redact(`x motdepasse y ${b64}`, ['motdepasse', '', 'ab']), 'x ••• y •••');
  const items = [{ status: 'ok' }, { status: 'warn' }, { status: 'error' }, { status: 'skip' }];
  assert.deepEqual(checksVerdict(items), { counts: { ok: 1, warn: 1, error: 1, skip: 1 }, blocking: true });
  assert.equal(checksVerdict(items.slice(0, 2)).blocking, false);
  assert.equal(checksSummaryLine(items), 'Résumé des vérifications : ✓ 1 · ⚠ 1 · ✗ 1 · · 1 non vérifié(s)');
});

test('INSTALL_STEPS : vérifications après la configuration, avant toute modification', () => {
  const ids = INSTALL_STEPS.map((s) => s.id);
  assert.equal(ids.indexOf('checks'), ids.indexOf('config') + 1);
  assert.ok(ids.indexOf('checks') < ids.indexOf('auth'));
  assert.equal(stepLabel('checks'), `Étape 3/${INSTALL_STEPS.length} : Vérifications (messagerie et stockage)`);
});

// ── Faux stockage S3 (fetch) ────────────────────────────────────────────────────────────────

const ORIGIN = 'https://photobooth.exemple.fr';

function fakeS3({
  endpoint = 'https://s3.fr-par.scw.cloud', bucket = 'medias', publicBase = 'https://medias.s3.fr-par.scw.cloud',
  publicRead = true, cors = null, existingCors = '', corsDenied = false, putError = null, deleteStatus = 204,
} = {}) {
  const objects = new Map();
  const calls = [];
  const state = { cors };
  const xmlError = (status, code) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`, { status });
  const allowHeaders = (origin) => (state.cors?.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT', 'access-control-allow-headers': 'content-type' }
    : {});
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method, headers, body: init.body });
    if (u.origin === new URL(publicBase).origin) {
      const key = decodeURIComponent(u.pathname.slice(1));
      if (!publicRead) return xmlError(403, 'AccessDenied');
      if (!objects.has(key)) return xmlError(404, 'NoSuchKey');
      return new Response(objects.get(key), { status: 200, headers: allowHeaders(headers.origin) });
    }
    assert.equal(u.origin, new URL(endpoint).origin);
    assert.ok(u.pathname.startsWith(`/${bucket}`), `adresse path-style attendue : ${url}`);
    const key = decodeURIComponent(u.pathname.slice(bucket.length + 2));
    if (method === 'OPTIONS') {
      return state.cors?.includes(headers.origin) ? new Response(null, { status: 200, headers: allowHeaders(headers.origin) }) : xmlError(403, 'CORSResponse');
    }
    assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK-42\/\d{8}\/fr-par\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    const body = init.body ?? '';
    assert.equal(headers['x-amz-content-sha256'], createHash('sha256').update(body).digest('hex'));
    if (u.search === '?cors') {
      if (corsDenied) return xmlError(403, 'AccessDenied');
      if (method === 'GET') return state.cors ? new Response(existingCors, { status: 200 }) : xmlError(404, 'NoSuchCORSConfiguration');
      assert.equal(method, 'PUT');
      assert.equal(headers['content-md5'], contentMd5(body));
      state.cors = [...body.matchAll(/<AllowedOrigin>([^<]+)<\/AllowedOrigin>/g)].map((m) => m[1]);
      return new Response(null, { status: 200 });
    }
    if (method === 'PUT') {
      if (putError) return xmlError(...putError);
      assert.equal(headers['content-type'], 'text/plain; charset=utf-8');
      objects.set(key, body);
      return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') {
      if (deleteStatus < 300) objects.delete(key);
      return deleteStatus === 204 ? new Response(null, { status: 204 }) : xmlError(deleteStatus, 'AccessDenied');
    }
    throw new Error(`requête inattendue ${method} ${url}`);
  };
  return { fetch, calls, objects, state };
}

const ENV = {
  SUPABASE_DB_PASSWORD: 'base-42',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: `sbp_${'a'.repeat(40)}`,
  APP_URL: `${ORIGIN}/`,
  COMPANY_NAME: 'Société Équipée',
  ADMIN_EMAIL: 'admin@exemple.fr',
  FROM_EMAIL: 'contact@exemple.fr',
  SMTP_HOST: 'smtp.exemple.fr',
  SMTP_USER: 'contact@exemple.fr',
  SMTP_PASSWORD: PASSWORD,
  STORAGE_ENDPOINT: 'https://s3.fr-par.scw.cloud',
  STORAGE_REGION: 'fr-par',
  STORAGE_ACCESS_KEY_ID: 'AK-42',
  STORAGE_SECRET_ACCESS_KEY: SECRET_KEY,
  STORAGE_BUCKET: 'medias',
  STORAGE_PUBLIC_URL: 'https://medias.s3.fr-par.scw.cloud',
};

function configOf(env = {}) {
  const { config, errors } = validateInstanceEnv({ ...ENV, ...env });
  assert.deepEqual(errors, []);
  return config;
}

async function run(config, { smtp = fakeSmtp(), s3 = fakeS3(), ...opts } = {}) {
  const items = await runChecks(config, {
    fetch: s3.fetch, smtpConnect: smtp.connect, now: () => new Date('2026-11-18T10:00:00Z'),
    sleep: async () => {}, corsRetries: 2, ...opts,
  });
  const json = JSON.stringify(items);
  assert.ok(!json.includes(PASSWORD), 'mot de passe SMTP absent');
  assert.ok(!json.includes(SECRET_KEY), 'clé secrète absente');
  for (const call of s3.calls) {
    const signature = call.headers.authorization?.match(/Signature=(\w+)/)?.[1];
    if (signature) assert.ok(!json.includes(signature), 'signature absente');
  }
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  return { items, byId, smtp, s3 };
}

test('runChecks : tout va bien (CORS déjà posé) → email envoyé, fichier lu puis supprimé', async () => {
  const s3 = fakeS3({ cors: [ORIGIN] });
  const { items, byId, smtp } = await run(configOf(), { s3 });
  assert.deepEqual(items.map((i) => [i.id, i.status]), [
    ['smtp', 'ok'], ['storage-write:medias', 'ok'], ['storage-read:medias', 'ok'], ['cors:medias', 'ok'], ['storage-delete:medias', 'ok'],
  ]);
  assert.match(byId.smtp.message, /email de test envoyé à admin@exemple\.fr/);
  assert.equal(smtp.messages.length, 1);
  assert.equal(s3.objects.size, 0, 'fichier de test supprimé');
  assert.ok(s3.calls.some((c) => c.method === 'PUT' && c.url === 'https://s3.fr-par.scw.cloud/medias/polabooth-verification/2026-11-18T10-00-00-000Z.txt'));
  assert.ok(!s3.calls.some((c) => c.url.endsWith('?cors')), 'CORS non touché');
  const preflight = s3.calls.find((c) => c.method === 'OPTIONS');
  assert.deepEqual([preflight.headers.origin, preflight.headers['access-control-request-method'], preflight.headers['access-control-request-headers']], [ORIGIN, 'PUT', 'content-type']);
  assert.equal(checksVerdict(items).blocking, false);
});

test('runChecks : mot de passe SMTP faux → bloquant, le stockage est vérifié quand même', async () => {
  const { byId, items, smtp } = await run(configOf(), { smtp: fakeSmtp({ password: 'autre' }), s3: fakeS3({ cors: [ORIGIN] }) });
  assert.equal(byId.smtp.status, 'error');
  assert.match(byId.smtp.message, /Identifiants SMTP refusés pour contact@exemple\.fr \(535/);
  assert.match(byId.smtp.hint, /SMTP_PASSWORD/);
  assert.equal(smtp.messages.length, 0);
  assert.equal(byId['storage-write:medias'].status, 'ok');
  assert.equal(checksVerdict(items).blocking, true);
});

test('runChecks : --skip-email-test → avertissement, aucun email', async () => {
  const { byId, smtp } = await run(configOf(), { skipEmailTest: true, s3: fakeS3({ cors: [ORIGIN] }) });
  assert.equal(byId.smtp.status, 'warn');
  assert.match(byId.smtp.message, /--skip-email-test/);
  assert.equal(smtp.messages.length, 0);
});

test('runChecks : CORS absent → règle du guide posée (règles existantes gardées)', async () => {
  const existingCors = '<CORSConfiguration><CORSRule><AllowedOrigin>https://autre.fr</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule></CORSConfiguration>';
  const s3 = fakeS3({ cors: ['https://autre.fr'], existingCors });
  const { byId } = await run(configOf(), { s3 });
  assert.equal(byId['cors:medias'].status, 'ok');
  assert.match(byId['cors:medias'].message, /posé/);
  const put = s3.calls.find((c) => c.method === 'PUT' && c.url.endsWith('?cors'));
  assert.equal(put.url, 'https://s3.fr-par.scw.cloud/medias?cors');
  assert.match(put.body, /<AllowedOrigin>https:\/\/autre\.fr<\/AllowedOrigin>.*<AllowedOrigin>https:\/\/photobooth\.exemple\.fr<\/AllowedOrigin>/);
  assert.deepEqual(s3.state.cors, ['https://autre.fr', ORIGIN]);
});

test('runChecks : CORS absent et pose refusée (Cloudflare R2) → avertissement, règle JSON et où la coller', async () => {
  const env = { STORAGE_ENDPOINT: 'https://compte.r2.cloudflarestorage.com', STORAGE_PUBLIC_URL: 'https://pub-123.r2.dev' };
  const s3 = fakeS3({ endpoint: env.STORAGE_ENDPOINT, publicBase: env.STORAGE_PUBLIC_URL, corsDenied: true });
  const { byId, items } = await run(configOf(env), { s3 });
  const cors = byId['cors:medias'];
  assert.equal(cors.status, 'warn');
  assert.match(cors.message, /pas le droit de le poser \(403 AccessDenied\)/);
  assert.match(cors.hint, /bucket medias › Settings › CORS Policy/);
  assert.deepEqual(JSON.parse(cors.details.join('\n')), JSON.parse(corsRuleJson(ORIGIN)));
  assert.equal(checksVerdict(items).blocking, false);
});

test('runChecks : simulation (--dry-run) → CORS signalé mais jamais posé', async () => {
  const s3 = fakeS3();
  const { byId, smtp } = await run(configOf(), { s3, dryRun: true });
  assert.equal(byId['cors:medias'].status, 'warn');
  assert.match(byId['cors:medias'].message, /simulation : rien n'est modifié/);
  assert.ok(!s3.calls.some((c) => c.url.endsWith('?cors')));
  assert.equal(smtp.messages.length, 1, 'l\'email de test part aussi en simulation');
  assert.equal(s3.objects.size, 0);
});

test('runChecks : bucket non public → bloquant avec la solution', async () => {
  const { byId, items, s3 } = await run(configOf(), { s3: fakeS3({ publicRead: false, cors: [ORIGIN] }) });
  assert.equal(byId['storage-read:medias'].status, 'error');
  assert.match(byId['storage-read:medias'].message, /Lecture publique refusée \(403\) : le bucket « medias » n'est pas public/);
  assert.match(byId['storage-read:medias'].hint, /lecture du bucket publique/);
  assert.equal(byId['storage-delete:medias'].status, 'ok');
  assert.equal(s3.objects.size, 0);
  assert.equal(checksVerdict(items).blocking, true);
});

test('runChecks : adresse publique en http → bloquant', async () => {
  const config = configOf();
  config.storage.STORAGE_PUBLIC_URL = 'http://medias.s3.fr-par.scw.cloud';
  const s3 = fakeS3({ publicBase: 'http://medias.s3.fr-par.scw.cloud', cors: [ORIGIN] });
  const { byId } = await run(config, { s3 });
  assert.equal(byId['storage-read:medias'].status, 'error');
  assert.match(byId['storage-read:medias'].message, /Adresse publique en http/);
});

test('runChecks : envoi refusé (clé secrète fausse) → bloquant, lecture non vérifiée, rien à supprimer', async () => {
  const { byId, s3 } = await run(configOf(), { s3: fakeS3({ putError: [403, 'SignatureDoesNotMatch'], cors: [ORIGIN] }) });
  assert.equal(byId['storage-write:medias'].status, 'error');
  assert.match(byId['storage-write:medias'].hint, /STORAGE_SECRET_ACCESS_KEY/);
  assert.equal(byId['storage-read:medias'].status, 'skip');
  assert.equal(byId['storage-delete:medias'], undefined);
  assert.ok(!s3.calls.some((c) => c.method === 'DELETE'));
});

test('runChecks : suppression refusée → simple avertissement', async () => {
  const { byId, items } = await run(configOf(), { s3: fakeS3({ deleteStatus: 403, cors: [ORIGIN] }) });
  assert.equal(byId['storage-delete:medias'].status, 'warn');
  assert.match(byId['storage-delete:medias'].hint, /polabooth-verification/);
  assert.equal(checksVerdict(items).blocking, false);
});

test('runChecks : bucket des photos vérifié à part', async () => {
  const s3medias = fakeS3({ cors: [ORIGIN] });
  const s3photos = fakeS3({ bucket: 'photos', publicBase: 'https://photos.exemple.fr', cors: [ORIGIN] });
  const fetch = (url, init) => (new URL(url).pathname.startsWith('/photos') || url.startsWith('https://photos.exemple.fr') ? s3photos.fetch(url, init) : s3medias.fetch(url, init));
  const config = configOf({ STORAGE_PHOTOS_BUCKET: 'photos', STORAGE_PHOTOS_PUBLIC_URL: 'https://photos.exemple.fr' });
  const items = await runChecks(config, { fetch, smtpConnect: fakeSmtp().connect, now: () => new Date('2026-11-18T10:00:00Z') });
  assert.deepEqual(items.filter((i) => i.id.endsWith(':photos')).map((i) => i.status), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(s3photos.objects.size, 0);
});
