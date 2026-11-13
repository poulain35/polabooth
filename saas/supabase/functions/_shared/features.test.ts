import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_DISABLED_ERROR, isFeatureEnabled, requireFeature } from './features.ts';
import { corsHeaders } from './cors.ts';

type Row = Record<string, unknown>;

// Faux client supabase-js : from('organizations').select().eq().maybeSingle().
function fakeDb(rows: Row[], fail = false) {
  const calls: { table: string; column?: string; value?: unknown; selected?: string }[] = [];
  return {
    calls,
    from(table: string) {
      const call: { table: string; column?: string; value?: unknown; selected?: string } = { table };
      calls.push(call);
      const q = {
        select(cols: string) { call.selected = cols; return q; },
        eq(col: string, v: unknown) { call.column = col; call.value = v; return q; },
        maybeSingle() {
          if (fail) return Promise.resolve({ data: null, error: { message: 'timeout' } });
          return Promise.resolve({ data: rows.find((r) => r[call.column!] === call.value) ?? null, error: null });
        },
      };
      return q;
    },
  };
}

test('isFeatureEnabled : défauts, socle et dépendances', () => {
  assert.equal(isFeatureEnabled({}, 'gallery'), true);
  assert.equal(isFeatureEnabled({}, 'booking'), false);
  assert.equal(isFeatureEnabled({ core: false }, 'core'), true);
  assert.equal(isFeatureEnabled({ gallery: false, delivery_email: true }, 'delivery_email'), false);
  assert.equal(isFeatureEnabled({ booking: true, invoicing: true }, 'invoicing'), true);
  assert.equal(isFeatureEnabled({ booking: true }, 'inconnue'), false);
});

test('requireFeature : active → null, lit organizations.features de l\'org', async () => {
  const db = fakeDb([{ id: 'org-1', features: { audio_guestbook: true } }, { id: 'org-2', features: {} }]);
  assert.equal(await requireFeature(db, 'org-1', 'audio_guestbook'), null);
  assert.equal(await requireFeature(db, 'org-1', 'gallery'), null, 'clé absente = défaut ouvert');
  assert.deepEqual(db.calls[0], { table: 'organizations', selected: 'features', column: 'id', value: 'org-1' });
});

test('requireFeature : désactivée → 404 fonctionnalite_desactivee avec CORS', async () => {
  const db = fakeDb([{ id: 'org-1', features: { gallery: false, booking: true, client_design: false } }]);
  for (const id of ['gallery', 'delivery_email', 'booking', 'prospects'] as const) {
    const res = await requireFeature(db, 'org-1', id);
    assert.ok(res, id);
    assert.equal(res.status, 404, id);
    assert.deepEqual(await res.json(), { error: FEATURE_DISABLED_ERROR });
    for (const [k, v] of Object.entries(corsHeaders)) assert.equal(res.headers.get(k), v);
  }
  assert.equal(FEATURE_DISABLED_ERROR, 'fonctionnalite_desactivee');
});

test('requireFeature : org introuvable → valeurs par défaut du catalogue', async () => {
  const db = fakeDb([]);
  assert.equal(await requireFeature(db, 'absente', 'gallery'), null);
  assert.equal((await requireFeature(db, 'absente', 'booking'))?.status, 404);
  assert.equal(await requireFeature(db, 'absente', 'core'), null);
});

test('requireFeature : lecture en échec → 500, jamais un faux « actif »', async () => {
  const res = await requireFeature(fakeDb([], true), 'org-1', 'gallery');
  assert.equal(res?.status, 500);
});
