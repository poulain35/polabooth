import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronFeatureGate, featureDisabled, instanceOrg, requireInstanceFeature } from './feature-guard.ts';
import { FEATURE_DISABLED_ERROR } from './features.ts';

type Row = Record<string, unknown> & { id: string; created_at: string };

/** Faux client : select / eq / order / limit / maybeSingle sur `organizations`. */
function fakeDb(rows: Row[], fail = false) {
  const calls: Array<{ table: string; selected?: string; eq?: [string, unknown]; order?: string; limit?: number }> = [];
  return {
    calls,
    from(table: string) {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      let result = [...rows];
      const q = {
        select(cols: string) { call.selected = cols; return q; },
        eq(col: string, value: unknown) { call.eq = [col, value]; result = result.filter((r) => r[col] === value); return q; },
        order(col: string, opts: { ascending: boolean }) {
          call.order = col;
          result.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (opts.ascending ? 1 : -1));
          return q;
        },
        limit(n: number) { call.limit = n; result = result.slice(0, n); return q; },
        maybeSingle() {
          return Promise.resolve(fail ? { data: null, error: { message: 'boom' } } : { data: result[0] ?? null, error: null });
        },
      };
      return q;
    },
  };
}

const ORGS: Row[] = [
  { id: 'recente', created_at: '2026-05-01T00:00:00Z', features: { gallery: true } },
  { id: 'instance', created_at: '2024-01-01T00:00:00Z', features: { gallery: false, booking: true } },
];

test('featureDisabled : 404 fonctionnalite_desactivee avec CORS', async () => {
  const res = featureDisabled();
  assert.equal(res.status, 404);
  assert.ok(res.headers.get('Access-Control-Allow-Origin'));
  assert.deepEqual(await res.json(), { error: FEATURE_DISABLED_ERROR });
});

test('instanceOrg : la plus ancienne organisation, null si aucune, erreur si lecture impossible', async () => {
  const db = fakeDb(ORGS);
  assert.deepEqual(await instanceOrg(db), { id: 'instance', features: { gallery: false, booking: true } });
  assert.deepEqual(db.calls[0], { table: 'organizations', selected: 'id, features', order: 'created_at', limit: 1 });
  assert.equal(await instanceOrg(fakeDb([])), null);
  await assert.rejects(instanceOrg(fakeDb(ORGS, true)));
});

test('requireInstanceFeature : réglages de l\'org de l\'instance, défauts sans org, 500 en échec', async () => {
  assert.equal((await requireInstanceFeature(fakeDb(ORGS), 'gallery'))?.status, 404);
  assert.equal(await requireInstanceFeature(fakeDb(ORGS), 'booking'), null);
  assert.equal(await requireInstanceFeature(fakeDb(ORGS), 'help'), null, 'clé absente = défaut');
  assert.equal(await requireInstanceFeature(fakeDb([]), 'ai_visuals'), null);
  assert.equal((await requireInstanceFeature(fakeDb([]), 'invoicing'))?.status, 404, 'privée : inactive par défaut');
  assert.equal((await requireInstanceFeature(fakeDb(ORGS, true), 'help'))?.status, 500);
});

test('cronFeatureGate : active → null ; inactive → 200 avec résumé (pas un échec de cron)', async () => {
  assert.equal(await cronFeatureGate(fakeDb(ORGS), 'booking'), null);
  const res = await cronFeatureGate(fakeDb(ORGS), 'invoicing');
  assert.equal(res?.status, 200);
  assert.deepEqual(await res!.json(), { ok: true, skipped: FEATURE_DISABLED_ERROR, feature: 'invoicing' });
});

test('cronFeatureGate : orgId fourni → cette org ; absent ou vide → org de l\'instance', async () => {
  const db = fakeDb(ORGS);
  assert.equal(await cronFeatureGate(db, 'gallery', 'recente'), null);
  assert.deepEqual(db.calls[0], { table: 'organizations', selected: 'features', eq: ['id', 'recente'] });
  assert.equal((await cronFeatureGate(fakeDb(ORGS), 'gallery', ''))?.status, 200);
  assert.equal((await cronFeatureGate(fakeDb(ORGS), 'gallery', undefined))?.status, 200);
});

test('cronFeatureGate : lecture en échec → 500, jamais ignorée en silence', async () => {
  assert.equal((await cronFeatureGate(fakeDb(ORGS, true), 'booking', 'instance'))?.status, 500);
  assert.equal((await cronFeatureGate(fakeDb(ORGS, true), 'booking'))?.status, 500);
});
