import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, reloadOnceForNewVersion } from './chunkReload.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('isChunkLoadError reconnaît les messages des navigateurs', () => {
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/AdminDashboard-CQuMrsVz.js')));
  assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.')));
  assert.ok(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js')));
  assert.ok(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css')));
  assert.ok(isChunkLoadError('Failed to fetch dynamically imported module: /assets/a.js'));
  assert.ok(!isChunkLoadError(new Error('Cannot read properties of undefined')));
  assert.ok(!isChunkLoadError(null));
  assert.ok(!isChunkLoadError(undefined));
});

test('reloadOnceForNewVersion recharge une fois puis s’abstient dans la minute', () => {
  const storage = memoryStorage();
  let reloads = 0;
  const reload = () => { reloads += 1; };
  assert.equal(reloadOnceForNewVersion({ storage, now: 1_000_000, reload }), true);
  assert.equal(storage.data[CHUNK_RELOAD_KEY], '1000000');
  assert.equal(reloadOnceForNewVersion({ storage, now: 1_000_000 + 5_000, reload }), false);
  assert.equal(reloads, 1);
  assert.equal(reloadOnceForNewVersion({ storage, now: 1_000_000 + CHUNK_RELOAD_WINDOW_MS, reload }), true);
  assert.equal(reloads, 2);
});

test('reloadOnceForNewVersion ne recharge pas sans stockage utilisable', () => {
  let reloads = 0;
  const broken = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
  assert.equal(reloadOnceForNewVersion({ storage: broken, now: 1, reload: () => { reloads += 1; } }), false);
  assert.equal(reloadOnceForNewVersion({ storage: undefined, now: 1, reload: () => { reloads += 1; } }), false);
  assert.equal(reloads, 0);
});
