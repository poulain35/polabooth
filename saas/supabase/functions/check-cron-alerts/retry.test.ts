// Tests du nouvel essai unique du relevé sur erreur transitoire (LAB-122).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientDbError, retryOnceIfTransient, RPC_RETRY_DELAY_MS, type DbResult } from './retry.ts';

// ── Erreurs transitoires de la RPC ──────────────────────────────────────────

test('erreur transitoire : timeout SQL, verrou, connexion, réseau, passerelle → nouvel essai', () => {
  assert.equal(isTransientDbError({ code: '57014', message: 'canceling statement due to statement timeout' }, 500), true);
  assert.equal(isTransientDbError({ code: '', message: 'canceling statement due to statement timeout' }, 500), true);
  assert.equal(isTransientDbError({ code: '55P03', message: 'canceling statement due to lock timeout' }, 500), true);
  assert.equal(isTransientDbError({ code: '08006', message: 'connection failure' }, 503), true);
  assert.equal(isTransientDbError({ code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }, 504), true);
  assert.equal(isTransientDbError({ code: '', message: 'TypeError: fetch failed' }, 0), true);
  assert.equal(isTransientDbError({ code: '', message: '<html>Bad Gateway</html>' }, 502), true);
});

test('erreur non transitoire : droits, fonction absente, erreur SQL → pas de nouvel essai', () => {
  assert.equal(isTransientDbError(null, 200), false);
  assert.equal(isTransientDbError({ code: '42501', message: 'permission denied for function cron_health_snapshot' }, 403), false);
  assert.equal(isTransientDbError({ code: 'PGRST202', message: 'Could not find the function public.cron_health_snapshot' }, 404), false);
  assert.equal(isTransientDbError({ code: '42P01', message: 'relation "cron.job" does not exist' }, 400), false);
});

// ── Nouvel essai du relevé (retryOnceIfTransient) ───────────────────────────

/** Faux appel RPC : renvoie les résultats dans l'ordre et compte les appels ; sleep et onRetry espionnés. */
function rpcStub(results: DbResult[]) {
  const calls = { run: 0, sleeps: [] as number[], retries: [] as string[] };
  const run = () => Promise.resolve(results[Math.min(calls.run++, results.length - 1)]);
  const sleep = (ms: number) => { calls.sleeps.push(ms); return Promise.resolve(); };
  const onRetry = (e: { message?: string | null }) => { calls.retries.push(e.message ?? ''); };
  return { calls, go: () => retryOnceIfTransient(run, onRetry, sleep) };
}
const OK: DbResult = { error: null, status: 200 };
const TIMEOUT: DbResult = { error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 };
const DENIED: DbResult = { error: { code: '42501', message: 'permission denied for function cron_health_snapshot' }, status: 403 };

test('relevé : succès du premier coup → un seul appel, aucune pause', async () => {
  const s = rpcStub([OK]);
  assert.equal(await s.go(), OK);
  assert.deepEqual([s.calls.run, s.calls.sleeps, s.calls.retries], [1, [], []]);
});

test('relevé : erreur non transitoire → renvoyée immédiatement (→ 500), sans nouvel essai', async () => {
  const s = rpcStub([DENIED, OK]);
  assert.equal(await s.go(), DENIED);
  assert.deepEqual([s.calls.run, s.calls.sleeps], [1, []]);
});

test('relevé : timeout SQL puis succès → un nouvel essai après 2 s', async () => {
  const s = rpcStub([TIMEOUT, OK]);
  assert.equal(await s.go(), OK);
  assert.deepEqual([s.calls.run, s.calls.sleeps, s.calls.retries], [2, [RPC_RETRY_DELAY_MS], [TIMEOUT.error!.message!]]);
  assert.equal(RPC_RETRY_DELAY_MS, 2_000);
});

test('relevé : deux timeouts → une seule relance, la seconde erreur est renvoyée', async () => {
  const second: DbResult = { error: { code: '57014', message: 'second timeout' }, status: 500 };
  const s = rpcStub([TIMEOUT, second, OK]);
  assert.equal(await s.go(), second);
  assert.deepEqual([s.calls.run, s.calls.sleeps.length], [2, 1]);
});

test('relevé : échec réseau (status 0) puis erreur non transitoire → relancé une fois, erreur renvoyée', async () => {
  const network: DbResult = { error: { code: '', message: 'TypeError: fetch failed' }, status: 0 };
  const s = rpcStub([network, DENIED]);
  assert.equal(await s.go(), DENIED);
  assert.equal(s.calls.run, 2);
});
