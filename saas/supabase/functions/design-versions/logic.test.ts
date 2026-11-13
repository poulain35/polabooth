import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LABEL_LENGTH, MAX_VERSIONS_LISTED, parseVersionRequest, runVersionRequest, type Db } from './logic.ts';

const VERSION_ID = '0b4f6c2e-8a1d-4e5f-9c3b-2d7e6f1a0b9c';
const EVENT_ID = 'evt-1';

test('parseVersionRequest : code normalisé, action list', () => {
  assert.deepEqual(parseVersionRequest({ code: ' a3k9x2 ', action: 'list' }), {
    ok: true, request: { action: 'list', code: 'A3K9X2' },
  });
});

test('parseVersionRequest : corps, code ou action invalides → erreur', () => {
  for (const body of [null, 'x', [], {}, { action: 'list' }, { code: '  ', action: 'list' }, { code: 1, action: 'list' }]) {
    assert.equal(parseVersionRequest(body).ok, false, JSON.stringify(body));
  }
  assert.deepEqual(parseVersionRequest({ code: 'A3K9X2', action: 'delete' }), {
    ok: false, error: 'action invalide (list, get ou save)',
  });
});

test('parseVersionRequest : get exige un uuid', () => {
  assert.deepEqual(parseVersionRequest({ code: 'A3K9X2', action: 'get', version_id: VERSION_ID }), {
    ok: true, request: { action: 'get', code: 'A3K9X2', versionId: VERSION_ID },
  });
  for (const version_id of [undefined, '', '42', `${VERSION_ID}' or 1=1`, 'evt-1']) {
    assert.deepEqual(parseVersionRequest({ code: 'A3K9X2', action: 'get', version_id }), {
      ok: false, error: 'version_id invalide',
    });
  }
});

test('parseVersionRequest : save exige un canvas_json objet et un format connu', () => {
  const canvas = { version: '5.3.0', objects: [] };
  assert.deepEqual(parseVersionRequest({ code: 'a3k9x2', action: 'save', canvas_json: canvas, format: 'stripV', label: null }), {
    ok: true, request: { action: 'save', code: 'A3K9X2', canvasJson: canvas, format: 'stripV', label: null },
  });
  assert.equal(parseVersionRequest({ code: 'A', action: 'save', format: 'portrait' }).ok, false);
  assert.equal(parseVersionRequest({ code: 'A', action: 'save', canvas_json: [], format: 'portrait' }).ok, false);
  assert.equal(parseVersionRequest({ code: 'A', action: 'save', canvas_json: canvas, format: 'carre' }).ok, false);
  assert.equal(parseVersionRequest({ code: 'A', action: 'save', canvas_json: canvas }).ok, false);
});

test('parseVersionRequest : label nettoyé, tronqué, vide → null', () => {
  const save = (label: unknown) => {
    const p = parseVersionRequest({ code: 'A', action: 'save', canvas_json: {}, format: 'portrait', label });
    assert.ok(p.ok && p.request.action === 'save');
    return p.request.label;
  };
  assert.equal(save('  Avant mariage  '), 'Avant mariage');
  assert.equal(save('   '), null);
  assert.equal(save(42), null);
  assert.equal(save('x'.repeat(500))?.length, MAX_LABEL_LENGTH);
});

/** Faux client supabase-js : enregistre la chaîne d'appels et renvoie `result`. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'insert']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, ...args]); return builder; };
  }
  for (const m of ['single', 'maybeSingle']) {
    builder[m] = () => { calls.push([m]); return Promise.resolve(result); };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const db: Db = { from: (table: string) => { calls.push(['from', table]); return builder; } };
  return { db, calls };
}

test('runVersionRequest list : versions de l\'événement du code, 20 plus récentes, sans canvas_json', async () => {
  const rows = [{ id: VERSION_ID, label: null, format: 'portrait', created_at: '2026-10-25T10:00:00Z' }];
  const { db, calls } = fakeDb({ data: rows, error: null });
  const out = await runVersionRequest(db, EVENT_ID, { action: 'list', code: 'A3K9X2' });
  assert.deepEqual(out, { status: 200, body: { versions: rows } });
  assert.deepEqual(calls, [
    ['from', 'design_versions'],
    ['select', 'id, label, format, created_at'],
    ['eq', 'event_id', EVENT_ID],
    ['order', 'created_at', { ascending: false }],
    ['limit', MAX_VERSIONS_LISTED],
  ]);
});

test('runVersionRequest get : filtre sur l\'id ET l\'événement du code', async () => {
  const version = { id: VERSION_ID, canvas_json: { objects: [] }, format: 'portrait', label: null, created_at: 'x' };
  const { db, calls } = fakeDb({ data: version, error: null });
  const out = await runVersionRequest(db, EVENT_ID, { action: 'get', code: 'A3K9X2', versionId: VERSION_ID });
  assert.deepEqual(out, { status: 200, body: { version } });
  assert.deepEqual(calls.filter(([m]) => m === 'eq'), [['eq', 'id', VERSION_ID], ['eq', 'event_id', EVENT_ID]]);
});

test('runVersionRequest get : version d\'un autre événement → 404', async () => {
  const { db } = fakeDb({ data: null, error: null });
  const out = await runVersionRequest(db, EVENT_ID, { action: 'get', code: 'A3K9X2', versionId: VERSION_ID });
  assert.deepEqual(out, { status: 404, body: { error: 'Version introuvable' } });
});

test('runVersionRequest save : event_id imposé par le code, jamais par le client', async () => {
  const saved = { id: VERSION_ID, label: null, format: 'landscape', created_at: 'x' };
  const { db, calls } = fakeDb({ data: saved, error: null });
  const out = await runVersionRequest(db, EVENT_ID, {
    action: 'save', code: 'A3K9X2', canvasJson: { objects: [] }, format: 'landscape', label: null,
  });
  assert.deepEqual(out, { status: 200, body: { version: saved } });
  assert.deepEqual(calls[1], ['insert', { event_id: EVENT_ID, canvas_json: { objects: [] }, format: 'landscape', label: null }]);
});

test('runVersionRequest : erreur base → 500 sans détail SQL', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { db } = fakeDb({ data: null, error: { code: '42501', message: 'permission denied' } });
  for (const request of [
    { action: 'list', code: 'A' } as const,
    { action: 'get', code: 'A', versionId: VERSION_ID } as const,
    { action: 'save', code: 'A', canvasJson: {}, format: 'portrait', label: null } as const,
  ]) {
    assert.deepEqual(await runVersionRequest(db, EVENT_ID, request), {
      status: 500, body: { error: 'Erreur historique des versions' },
    });
  }
});
