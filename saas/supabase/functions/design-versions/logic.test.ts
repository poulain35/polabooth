import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_LABEL_LENGTH, MAX_VERSIONS_LISTED, parseVersionRequest, runVersionRequest, type Db } from './logic.ts';

const VERSION_ID = '0b4f6c2e-8a1d-4e5f-9c3b-2d7e6f1a0b9c';
const EVENT_ID = 'evt-1';

test('parseVersionRequest : code normalisé, action list', () => {
  assert.deepEqual(parseVersionRequest({ code: ' a3k9x2 ', action: 'list' }), {
    ok: true, request: { action: 'list', code: 'A3K9X2', kind: 'print', slot: 1 },
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
    ok: true, request: { action: 'get', code: 'A3K9X2', kind: 'print', slot: 1, versionId: VERSION_ID },
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
    ok: true, request: { action: 'save', code: 'A3K9X2', kind: 'print', slot: 1, canvasJson: canvas, format: 'stripV', label: null },
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
  const out = await runVersionRequest(db, EVENT_ID, { action: 'list', code: 'A3K9X2', kind: 'print', slot: 1 });
  assert.deepEqual(out, { status: 200, body: { versions: rows } });
  assert.deepEqual(calls, [
    ['from', 'design_versions'],
    ['select', 'id, label, format, created_at'],
    ['eq', 'event_id', EVENT_ID],
    ['eq', 'kind', 'print'],
    ['eq', 'slot', 1],
    ['order', 'created_at', { ascending: false }],
    ['limit', MAX_VERSIONS_LISTED],
  ]);
});

test('runVersionRequest get : filtre sur l\'id, l\'événement du code et le modèle photo', async () => {
  const version = { id: VERSION_ID, canvas_json: { objects: [] }, format: 'portrait', label: null, created_at: 'x' };
  const { db, calls } = fakeDb({ data: version, error: null });
  const out = await runVersionRequest(db, EVENT_ID, { action: 'get', code: 'A3K9X2', kind: 'print', slot: 1, versionId: VERSION_ID });
  assert.deepEqual(out, { status: 200, body: { version } });
  assert.deepEqual(calls.filter(([m]) => m === 'eq'), [['eq', 'id', VERSION_ID], ['eq', 'event_id', EVENT_ID], ['eq', 'kind', 'print'], ['eq', 'slot', 1]]);
});

test('runVersionRequest get : version d\'un autre événement → 404', async () => {
  const { db } = fakeDb({ data: null, error: null });
  const out = await runVersionRequest(db, EVENT_ID, { action: 'get', code: 'A3K9X2', kind: 'print', slot: 1, versionId: VERSION_ID });
  assert.deepEqual(out, { status: 404, body: { error: 'Version introuvable' } });
});

test('runVersionRequest save : event_id imposé par le code, jamais par le client', async () => {
  const saved = { id: VERSION_ID, label: null, format: 'landscape', created_at: 'x' };
  const { db, calls } = fakeDb({ data: saved, error: null });
  const out = await runVersionRequest(db, EVENT_ID, {
    action: 'save', code: 'A3K9X2', kind: 'print', slot: 1, canvasJson: { objects: [] }, format: 'landscape', label: null,
  });
  assert.deepEqual(out, { status: 200, body: { version: saved } });
  assert.deepEqual(calls[1], ['insert', { event_id: EVENT_ID, kind: 'print', slot: 1, canvas_json: { objects: [] }, format: 'landscape', label: null }]);
});

test('runVersionRequest : erreur base → 500 sans détail SQL', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { db } = fakeDb({ data: null, error: { code: '42501', message: 'permission denied' } });
  for (const request of [
    { action: 'list', code: 'A', kind: 'print', slot: 1 } as const,
    { action: 'get', code: 'A', kind: 'print', slot: 1, versionId: VERSION_ID } as const,
    { action: 'save', code: 'A', kind: 'print', slot: 1, canvasJson: {}, format: 'portrait', label: null } as const,
  ]) {
    assert.deepEqual(await runVersionRequest(db, EVENT_ID, request), {
      status: 500, body: { error: 'Erreur historique des versions' },
    });
  }
});

// ── LAB-289 : un historique par design (modèle photo / écran d'accueil) ──────────

test('parseVersionRequest : kind print par défaut, home accepté, autre valeur refusée', () => {
  const list = (kind: unknown) => parseVersionRequest({ code: 'A', action: 'list', kind });
  assert.deepEqual(list(undefined), { ok: true, request: { action: 'list', code: 'A', kind: 'print', slot: 1 } });
  assert.deepEqual(list('home'), { ok: true, request: { action: 'list', code: 'A', kind: 'home', slot: 1 } });
  for (const kind of ['', 'HOME', 'banner', 1, {}]) {
    assert.deepEqual(list(kind), { ok: false, error: 'kind invalide (print ou home)' }, JSON.stringify(kind));
  }
});

test("parseVersionRequest save : format 'home' réservé à l'écran d'accueil, et lui seul", () => {
  const save = (kind: string, format: string) =>
    parseVersionRequest({ code: 'A', action: 'save', kind, canvas_json: {}, format }).ok;
  assert.equal(save('home', 'home'), true);
  assert.equal(save('home', 'portrait'), false);
  assert.equal(save('print', 'home'), false);
  assert.equal(save('print', 'portrait'), true);
});

test("runVersionRequest : l'écran d'accueil lit et écrit son propre historique", async () => {
  const { db, calls } = fakeDb({ data: [], error: null });
  await runVersionRequest(db, EVENT_ID, { action: 'list', code: 'A', kind: 'home', slot: 1 });
  assert.deepEqual(calls.filter(([m]) => m === 'eq'), [['eq', 'event_id', EVENT_ID], ['eq', 'kind', 'home'], ['eq', 'slot', 1]]);

  const saved = fakeDb({ data: { id: VERSION_ID }, error: null });
  await runVersionRequest(saved.db, EVENT_ID, {
    action: 'save', code: 'A', kind: 'home', slot: 1, canvasJson: { objects: [] }, format: 'home', label: null,
  });
  assert.deepEqual(saved.calls[1], ['insert', { event_id: EVENT_ID, kind: 'home', slot: 1, canvas_json: { objects: [] }, format: 'home', label: null }]);
});

// ── LAB-312 : un historique par cadre (slot) ─────────────────────────────────

test("parseVersionRequest : slot 1 par défaut, 1 à 4 pour le modèle photo, 1 seul pour l'écran d'accueil", () => {
  const list = (kind: unknown, slot: unknown) => parseVersionRequest({ code: 'A', action: 'list', kind, slot });
  assert.deepEqual(list(undefined, 3), { ok: true, request: { action: 'list', code: 'A', kind: 'print', slot: 3 } });
  assert.deepEqual(list('home', 1), { ok: true, request: { action: 'list', code: 'A', kind: 'home', slot: 1 } });
  for (const [kind, slot] of [['print', 0], ['print', 5], ['print', '2'], ['print', 1.5], ['home', 2]]) {
    assert.deepEqual(list(kind, slot), { ok: false, error: 'slot invalide' }, `${kind} ${slot}`);
  }
});

test('runVersionRequest : chaque cadre lit et écrit son propre historique', async () => {
  const { db, calls } = fakeDb({ data: [], error: null });
  await runVersionRequest(db, EVENT_ID, { action: 'list', code: 'A', kind: 'print', slot: 2 });
  assert.deepEqual(calls.filter(([m]) => m === 'eq'), [['eq', 'event_id', EVENT_ID], ['eq', 'kind', 'print'], ['eq', 'slot', 2]]);

  const got = fakeDb({ data: null, error: null });
  await runVersionRequest(got.db, EVENT_ID, { action: 'get', code: 'A', kind: 'print', slot: 3, versionId: VERSION_ID });
  assert.deepEqual(got.calls.filter(([m]) => m === 'eq').at(-1), ['eq', 'slot', 3]);

  const saved = fakeDb({ data: { id: VERSION_ID }, error: null });
  await runVersionRequest(saved.db, EVENT_ID, {
    action: 'save', code: 'A', kind: 'print', slot: 4, canvasJson: {}, format: 'stripV', label: 'Avant',
  });
  assert.deepEqual(saved.calls[1], ['insert', { event_id: EVENT_ID, kind: 'print', slot: 4, canvas_json: {}, format: 'stripV', label: 'Avant' }]);
});

test('index.ts : enregistrer une version au-delà de max_frames est refusé (403)', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /request\.action === 'save' && !clientCanWriteSlot\(request\.kind, request\.slot, event\.form_config\)\) \{\s+return corsResponse\(403, \{ error: FRAME_LIMIT_ERROR \}\);/);
});
