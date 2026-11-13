// LAB-276 : statut d'administrateur de l'application (menu « Création », routes des catalogues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppAdminStore } from './appAdmin.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('état initial : en chargement, pas admin', () => {
  const store = createAppAdminStore({ getUserId: async () => 'u1', checkAdmin: async () => true });
  assert.deepEqual(store.getState(), { userId: null, isAdmin: false, loading: true });
});

test('admin : isAdmin vrai seulement si la RPC renvoie exactement true', async () => {
  for (const [answer, expected] of [[true, true], [false, false], ['true', false], [1, false], [null, false]]) {
    const store = createAppAdminStore({ getUserId: async () => 'u1', checkAdmin: async () => answer });
    await store.load();
    assert.deepEqual(store.getState(), { userId: 'u1', isAdmin: expected, loading: false }, String(answer));
  }
});

test('refus par défaut : erreur de la RPC ou de la session = pas admin, sans exception', async () => {
  const failing = createAppAdminStore({ getUserId: async () => 'u1', checkAdmin: async () => { throw new Error('réseau'); } });
  await failing.load();
  assert.deepEqual(failing.getState(), { userId: 'u1', isAdmin: false, loading: false });

  const noSession = createAppAdminStore({ getUserId: async () => { throw new Error('session'); }, checkAdmin: async () => true });
  await noSession.load();
  assert.deepEqual(noSession.getState(), { userId: null, isAdmin: false, loading: false });
});

test('sans session : pas d\'appel à la RPC', async () => {
  let calls = 0;
  const store = createAppAdminStore({ getUserId: async () => null, checkAdmin: async () => { calls += 1; return true; } });
  await store.load();
  assert.equal(calls, 0);
  assert.deepEqual(store.getState(), { userId: null, isAdmin: false, loading: false });
});

test('lectures simultanées regroupées, pas de relecture pour le même compte', async () => {
  let calls = 0;
  const gate = deferred();
  const store = createAppAdminStore({ getUserId: async () => 'u1', checkAdmin: () => { calls += 1; return gate.promise; } });
  const a = store.load();
  const b = store.load();
  assert.equal(a, b);
  gate.resolve(true);
  await a;
  await store.load();
  assert.equal(calls, 1);
  assert.equal(store.getState().isAdmin, true);
});

test('changement de compte : relecture, statut du compte précédent jamais exposé', async () => {
  let user = 'admin';
  const answers = { admin: true, other: false };
  const gate = deferred();
  const store = createAppAdminStore({
    getUserId: async () => user,
    checkAdmin: () => (user === 'other' ? gate.promise : Promise.resolve(answers[user])),
  });
  await store.load();
  assert.equal(store.getState().isAdmin, true);

  user = 'other';
  const seen = [];
  store.subscribe(() => seen.push(store.getState()));
  const p = store.load();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(store.getState(), { userId: 'other', isAdmin: false, loading: true });
  gate.resolve(answers.other);
  await p;
  assert.deepEqual(store.getState(), { userId: 'other', isAdmin: false, loading: false });
  assert.ok(seen.every((s) => !(s.userId === 'other' && s.isAdmin)));
});

test('abonnement : prévenu à chaque changement, désabonnement effectif', async () => {
  let user = 'u1';
  const store = createAppAdminStore({ getUserId: async () => user, checkAdmin: async () => true });
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  await store.load();
  assert.ok(n >= 1);
  const before = n;
  off();
  user = null;
  await store.load();
  assert.equal(store.getState().userId, null);
  assert.equal(n, before);
});
