import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_FAILED_MESSAGE, createSaveQueue, isRetryableSaveError, saveTimeoutMs, sendWithRetry,
} from './saveQueue.js';

const noWait = () => Promise.resolve();
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('saveTimeoutMs : 20 s + envoi à 100 Ko/s, 2 min au plus', () => {
  assert.equal(saveTimeoutMs(0), 20_000);
  assert.equal(saveTimeoutMs(6_000_000), 80_000);
  assert.equal(saveTimeoutMs(50_000_000), 120_000);
  assert.equal(saveTimeoutMs(undefined), 20_000);
});

test('isRetryableSaveError : délai, réseau coupé et 5xx oui ; 4xx et 429 non', () => {
  assert.equal(isRetryableSaveError({ timeout: true }), true);
  assert.equal(isRetryableSaveError(new TypeError('Failed to fetch')), true);
  assert.equal(isRetryableSaveError({ status: 503, message: 'x' }), true);
  assert.equal(isRetryableSaveError({ status: 409, message: 'verrouillé' }), false);
  assert.equal(isRetryableSaveError({ status: 429, message: 'Trop de requêtes' }), false);
  assert.equal(isRetryableSaveError(null), false);
});

test('sendWithRetry : succès du premier coup, signal transmis', async () => {
  let signal;
  const result = await sendWithRetry(async (s) => { signal = s; return 'ok'; }, { timeoutMs: 1000, wait: noWait });
  assert.equal(result, 'ok');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test('sendWithRetry : délai dépassé → envoi annulé, nouvel essai annoncé, puis réussite', async () => {
  const signals = [];
  const retries = [];
  let calls = 0;
  const result = await sendWithRetry((signal) => {
    signals.push(signal);
    calls += 1;
    if (calls === 1) return new Promise(() => {}); // ne répond jamais, ignore même le signal
    return 'ok';
  }, { timeoutMs: 20, wait: noWait, onRetry: (err, attempt) => retries.push([err.timeout, attempt]) });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(retries, [[true, 1]]);
});

test('sendWithRetry : toujours en échec → erreur claire après le dernier essai, jamais d\'attente sans fin', async () => {
  let calls = 0;
  await assert.rejects(
    sendWithRetry(() => { calls += 1; return new Promise(() => {}); }, { timeoutMs: 10, attempts: 2, wait: noWait }),
    (err) => err.message === SAVE_FAILED_MESSAGE && err.retryable === true && err.cause.timeout === true,
  );
  assert.equal(calls, 2);
});

test('sendWithRetry : réseau coupé puis rétabli', async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return 'ok';
  }, { timeoutMs: 1000, wait: noWait });
  assert.equal(result, 'ok');
});

test('sendWithRetry : erreur définitive (409) levée telle quelle, sans nouvel essai', async () => {
  let calls = 0;
  const locked = Object.assign(new Error('Écran validé'), { status: 409 });
  await assert.rejects(
    sendWithRetry(async () => { calls += 1; throw locked; }, { timeoutMs: 1000, wait: noWait }),
    (err) => err === locked,
  );
  assert.equal(calls, 1);
});

test('sendWithRetry : attend le délai entre deux essais', async () => {
  const waits = [];
  let calls = 0;
  await sendWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('x'), { status: 502 });
    return 'ok';
  }, { timeoutMs: 1000, retryDelayMs: 1234, wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [1234]);
});

test('createSaveQueue : une seule sauvegarde en cours, même pour deux brouillons', async () => {
  const queue = createSaveQueue();
  let active = 0;
  let maxActive = 0;
  const gates = [deferred(), deferred()];
  const job = (i) => async () => {
    active += 1; maxActive = Math.max(maxActive, active);
    await gates[i].promise;
    active -= 1;
    return i;
  };
  const a = queue.enqueue('print:1', job(0));
  const b = queue.enqueue('home', job(1));
  await Promise.resolve();
  assert.equal(queue.busy, true);
  assert.equal(queue.waiting, 1);
  gates[0].resolve();
  assert.equal(await a, 0);
  gates[1].resolve();
  assert.equal(await b, 1);
  assert.equal(maxActive, 1);
  assert.equal(queue.busy, false);
});

test('createSaveQueue : une seule en attente par brouillon, le contenu le plus récent part', async () => {
  const queue = createSaveQueue();
  const gate = deferred();
  const sent = [];
  const first = queue.enqueue('print:1', async () => { await gate.promise; sent.push('v1'); return 'v1'; });
  await Promise.resolve();
  const second = queue.enqueue('print:1', async () => { sent.push('v2'); return 'v2'; });
  const third = queue.enqueue('print:1', async () => { sent.push('v3'); return 'v3'; });
  assert.equal(queue.waiting, 1);
  assert.equal(second, third);
  gate.resolve();
  assert.equal(await first, 'v1');
  assert.equal(await second, 'v3');
  assert.deepEqual(sent, ['v1', 'v3']);
});

test('createSaveQueue : un échec n\'arrête pas la file', async () => {
  const queue = createSaveQueue();
  const failed = queue.enqueue('print:1', async () => { throw new Error('panne'); });
  const next = queue.enqueue('home', async () => 'ok');
  await assert.rejects(failed, /panne/);
  assert.equal(await next, 'ok');
});

test('createSaveQueue : cancel retire l\'attente, settled attend l\'envoi en cours', async () => {
  const queue = createSaveQueue();
  const gate = deferred();
  let done = false;
  const running = queue.enqueue('print:2', async () => { await gate.promise; done = true; throw new Error('x'); });
  await Promise.resolve();
  const waiting = queue.enqueue('print:2', async () => 'jamais');
  queue.cancel('print:2', { skipped: true });
  assert.deepEqual(await waiting, { skipped: true });
  const settled = queue.settled('print:2');
  gate.resolve();
  await settled;
  assert.equal(done, true);
  await assert.rejects(running);
  await queue.settled('autre');
});
