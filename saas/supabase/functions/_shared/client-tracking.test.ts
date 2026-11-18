import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientTrackingUrl } from './client-tracking.ts';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface Call { table: string; filters: Array<[string, string, unknown]>; order?: [string, boolean]; limit?: number }

// Faux client supabase-js : select / eq / not(…, 'is', null) / order / limit / maybeSingle.
// `fail` : table en erreur (absente de la version ouverte, ou lecture en échec) ; `throws` : exception.
function fakeDb(tables: Tables, opts: { fail?: string[]; throws?: string[] } = {}) {
  const calls: Call[] = [];
  return {
    calls,
    from(table: string) {
      if (opts.throws?.includes(table)) throw new Error('réseau coupé');
      const call: Call = { table, filters: [] };
      calls.push(call);
      const q = {
        select() { return q; },
        eq(col: string, v: unknown) { call.filters.push(['eq', col, v]); return q; },
        not(col: string, op: string, v: unknown) { call.filters.push([`not.${op}`, col, v]); return q; },
        order(col: string, o: { ascending: boolean }) { call.order = [col, o.ascending]; return q; },
        limit(n: number) { call.limit = n; return q; },
        maybeSingle() {
          if (opts.fail?.includes(table)) {
            return Promise.resolve({ data: null, error: { message: `relation "public.${table}" does not exist` } });
          }
          let rows = (tables[table] ?? []).filter((r) => call.filters.every(([op, col, v]) =>
            op === 'eq' ? r[col] === v : r[col] !== null && r[col] !== undefined));
          if (call.order) {
            const [col, asc] = call.order;
            rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
          }
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
      };
      return q;
    },
  };
}

const APP = { appUrl: 'https://app.test/' };
const base: Tables = {
  leads: [
    { converted_event_id: 'ev-1', booking_token: 'ancien', created_at: '2026-01-01T00:00:00Z' },
    { converted_event_id: 'ev-1', booking_token: 'tok/é 1', created_at: '2026-03-01T00:00:00Z' },
    { converted_event_id: 'ev-1', booking_token: null, created_at: '2026-04-01T00:00:00Z' },
    { converted_event_id: 'ev-2', booking_token: 'autre', created_at: '2026-05-01T00:00:00Z' },
  ],
  events: [{ id: 'ev-1', org_id: 'org-1' }, { id: 'ev-3', org_id: 'org-1' }, { id: 'ev-2', org_id: 'org-2' }],
  organizations: [{ id: 'org-1', features: { booking: true } }, { id: 'org-2', features: { booking: false } }],
};

test('clientTrackingUrl : jeton de la demande la plus récente, lien /reservation/:token encodé', async () => {
  const db = fakeDb(base);
  assert.equal(await clientTrackingUrl(db, 'ev-1', APP), 'https://app.test/reservation/tok%2F%C3%A9%201');
  const lead = db.calls.find((c) => c.table === 'leads')!;
  assert.deepEqual(lead.filters[0], ['eq', 'converted_event_id', 'ev-1']);
  assert.deepEqual(lead.order, ['created_at', false]);
  assert.equal(lead.limit, 1);
});

test('clientTrackingUrl : null pour un événement créé à la main (aucune demande)', async () => {
  const db = fakeDb(base);
  assert.equal(await clientTrackingUrl(db, 'ev-3', APP), null);
  assert.deepEqual(db.calls.map((c) => c.table), ['leads'], 'une seule lecture sans demande');
  assert.equal(await clientTrackingUrl(db, '', APP), null);
  assert.equal(await clientTrackingUrl(db, null, APP), null);
});

test('clientTrackingUrl : null si booking est coupé, ou absent (défaut du catalogue)', async () => {
  assert.equal(await clientTrackingUrl(fakeDb(base), 'ev-2', APP), null);
  const noFlags = { ...base, organizations: [{ id: 'org-1', features: {} }] };
  assert.equal(await clientTrackingUrl(fakeDb(noFlags), 'ev-1', APP), null);
  const noDesign = { ...base, organizations: [{ id: 'org-1', features: { booking: true, client_design: false } }] };
  assert.equal(await clientTrackingUrl(fakeDb(noDesign), 'ev-1', APP), null, 'booking dépend de client_design');
  const noOrg = { ...base, organizations: [] };
  assert.equal(await clientTrackingUrl(fakeDb(noOrg), 'ev-1', APP), null);
});

test('clientTrackingUrl : version ouverte (table leads absente) ou lecture en échec → null, jamais d\'exception', async () => {
  assert.equal(await clientTrackingUrl(fakeDb(base, { fail: ['leads'] }), 'ev-1', APP), null);
  assert.equal(await clientTrackingUrl(fakeDb(base, { fail: ['events'] }), 'ev-1', APP), null);
  assert.equal(await clientTrackingUrl(fakeDb(base, { fail: ['organizations'] }), 'ev-1', APP), null);
  assert.equal(await clientTrackingUrl(fakeDb(base, { throws: ['leads'] }), 'ev-1', APP), null);
});

test('clientTrackingUrl : adresse du front inconnue → null (pas de lien relatif dans un email)', async () => {
  assert.equal(await clientTrackingUrl(fakeDb(base), 'ev-1', { appUrl: '' }), null);
});

test('client-tracking.ts : code ouvert, aucun import de _shared/modules/', () => {
  const src = readFileSync(new URL('./client-tracking.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*modules\//);
});
