import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_ADMIN_MESSAGE, authenticate, bearerToken, cronOnly, CRON_ONLY_MESSAGE, FORBIDDEN_ORG_MESSAGE, isServiceRoleRequest,
  NO_ORG_MESSAGE, requireAnyOrgOwner, requireAppAdmin, requireOrgAccess, requireOrgAdmin, requireServiceOrOrgAdmin,
  resolveOrgId, type AuthUser, type OrgResourceKind,
} from './admin-guard.ts';

const SERVICE_KEY = 'service-key-de-test';
const jwt = (payload: unknown) =>
  `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;
const ANON_JWT = jwt({ role: 'anon', iss: 'supabase' });
const USER_JWT = jwt({ role: 'authenticated', sub: 'u-intrus' });
const SERVICE_JWT = jwt({ role: 'service_role', iss: 'supabase' });

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

// Faux client supabase-js : select / eq / limit / maybeSingle / then sur des tables en mémoire.
function fakeDb(tables: Tables, fail: { table?: string } = {}) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let lim = Infinity;
      const result = () => {
        if (fail.table === table) return { data: null, error: { message: 'timeout' } };
        return { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, lim), error: null };
      };
      const q = {
        select() { return q; },
        eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return q; },
        limit(n: number) { lim = n; return q; },
        maybeSingle() {
          const r = result();
          return Promise.resolve(r.error ? r : { data: r.data![0] ?? null, error: null });
        },
        then(resolve: (v: unknown) => void) { resolve(result()); },
      };
      return q;
    },
  };
}

const OWNER = 'u-owner';
const INTRUDER = 'u-intrus';

const TABLES: Tables = {
  organizations: [
    { id: 'org-a', owner_id: OWNER },
    { id: 'org-b', owner_id: 'u-autre' },
  ],
  events: [
    { id: 'ev-a', org_id: 'org-a' },
    { id: 'ev-b', org_id: 'org-b' },
    { id: 'ev-orphan', org_id: null },
  ],
  photos: [{ id: 'ph-a', event_id: 'ev-a' }],
  audio_tracks: [{ id: 'au-a', event_id: 'ev-a' }],
  client_designs: [{ id: 'ds-a', event_id: 'ev-a' }],
  leads: [{ id: 'ld-a', org_id: 'org-a' }],
  booking_slots: [{ id: 'sl-a', org_id: 'org-a' }],
  prospects: [{ id: 'pr-a', org_id: 'org-a' }],
  kiosk_licenses: [{ id: 'kl-a', org_id: 'org-a' }, { id: 'kl-b', org_id: 'org-b' }],
  app_admins: [{ user_id: 'u-app-admin' }],
};

const OWNED: Record<OrgResourceKind, string> = {
  event: 'ev-a', photo: 'ph-a', audio_track: 'au-a', design: 'ds-a', lead: 'ld-a', slot: 'sl-a', prospect: 'pr-a',
  kiosk_license: 'kl-a',
};

const users: Record<string, AuthUser> = {
  [`Bearer ${OWNER}-jwt`]: { id: OWNER },
  [`Bearer ${INTRUDER}-jwt`]: { id: INTRUDER },
};
const getUser = (h: string) => Promise.resolve(users[h] ?? null);

async function body(res: Response) { return await res.json(); }

// ── Admin de l'org ──────────────────────────────────────────────────────────

for (const [kind, id] of Object.entries(OWNED) as [OrgResourceKind, string][]) {
  test(`org admin (${kind}) : propriétaire accepté, autre utilisateur authentifié refusé en 403`, async () => {
    const db = fakeDb(TABLES);
    const ok = await requireOrgAccess(db, OWNER, { kind, id });
    assert.equal(ok.response, undefined);
    assert.equal(ok.response ? null : ok.orgId, 'org-a');

    const denied = await requireOrgAccess(db, INTRUDER, { kind, id });
    assert.ok(denied.response);
    assert.equal(denied.response.status, 403);
    assert.equal((await body(denied.response)).error, FORBIDDEN_ORG_MESSAGE);
  });

  test(`org admin (${kind}) : ressource inconnue → 404 en français`, async () => {
    const res = await requireOrgAccess(fakeDb(TABLES), OWNER, { kind, id: 'inconnu' });
    assert.equal(res.response?.status, 404);
    assert.match((await body(res.response!)).error, /introuvable/);
  });
}

test("org admin : événement d'une autre org ou sans org → 403", async () => {
  const db = fakeDb(TABLES);
  assert.equal((await requireOrgAccess(db, OWNER, { kind: 'event', id: 'ev-b' })).response?.status, 403);
  assert.equal((await requireOrgAccess(db, OWNER, { kind: 'event', id: 'ev-orphan' })).response?.status, 403);
});

test('org admin : panne base → 500, jamais un accès', async () => {
  const res = await requireOrgAccess(fakeDb(TABLES, { table: 'events' }), OWNER, { kind: 'event', id: 'ev-a' });
  assert.equal(res.response?.status, 500);
  const org = await requireOrgAccess(fakeDb(TABLES, { table: 'organizations' }), OWNER, { kind: 'event', id: 'ev-a' });
  assert.equal(org.response?.status, 403);
});

test('org admin : allowAppAdmin laisse passer un administrateur de l’application, pas un intrus', async () => {
  const db = fakeDb(TABLES);
  const resource = { kind: 'kiosk_license', id: 'kl-b' } as const;
  assert.equal((await requireOrgAccess(db, 'u-app-admin', resource)).response?.status, 403);
  const admin = await requireOrgAccess(db, 'u-app-admin', resource, { allowAppAdmin: true });
  assert.equal(admin.response, undefined);
  assert.equal(admin.response ? null : admin.orgId, 'org-b');
  assert.equal((await requireOrgAccess(db, INTRUDER, resource, { allowAppAdmin: true })).response?.status, 403);
  // Ressource inconnue : 404 même pour un administrateur de l’application.
  const unknown = await requireOrgAccess(db, 'u-app-admin', { kind: 'kiosk_license', id: 'nope' }, { allowAppAdmin: true });
  assert.equal(unknown.response?.status, 404);
  assert.equal((await body(unknown.response!)).error, 'Borne introuvable');
  // Lecture de app_admins en échec : 500, jamais un accès.
  const failed = await requireOrgAccess(fakeDb(TABLES, { table: 'app_admins' }), INTRUDER, resource, { allowAppAdmin: true });
  assert.equal(failed.response?.status, 500);
});

test('resolveOrgId : photo / piste / design remontent via l’événement', async () => {
  const db = fakeDb(TABLES);
  assert.deepEqual(await resolveOrgId(db, { kind: 'photo', id: 'ph-a' }), { found: true, orgId: 'org-a' });
  assert.deepEqual(await resolveOrgId(db, { kind: 'design', id: 'nope' }), { found: false, orgId: null });
});

test('authenticate : sans header → 401 Non autorisé, JWT invalide → 401', async () => {
  const none = await authenticate(null, getUser);
  assert.equal(none.response?.status, 401);
  assert.equal((await body(none.response!)).error, 'Non autorisé');

  const bad = await authenticate('Bearer inconnu', getUser);
  assert.equal(bad.response?.status, 401);
  assert.equal((await body(bad.response!)).error, 'JWT invalide');

  const boom = await authenticate('Bearer x', () => Promise.reject(new Error('auth down')));
  assert.equal(boom.response?.status, 401);

  const ok = await authenticate(`Bearer ${OWNER}-jwt`, getUser);
  assert.equal(ok.response ? null : ok.user.id, OWNER);
});

test('requireOrgAdmin : clé anon (pas un utilisateur) → 401, intrus → 403, propriétaire → ok', async () => {
  const db = fakeDb(TABLES);
  const res = { kind: 'event', id: 'ev-a' } as const;
  assert.equal((await requireOrgAdmin(`Bearer ${ANON_JWT}`, getUser, db, res)).response?.status, 401);
  assert.equal((await requireOrgAdmin(`Bearer ${INTRUDER}-jwt`, getUser, db, res)).response?.status, 403);
  const ok = await requireOrgAdmin(`Bearer ${OWNER}-jwt`, getUser, db, res);
  assert.equal(ok.response, undefined);
});

test('requireAnyOrgOwner : propriétaire d’une org accepté, sinon 403', async () => {
  const db = fakeDb(TABLES);
  assert.equal(await requireAnyOrgOwner(db, OWNER), null);
  const res = await requireAnyOrgOwner(db, INTRUDER);
  assert.equal(res?.status, 403);
  assert.equal((await body(res!)).error, NO_ORG_MESSAGE);
  assert.equal((await requireAnyOrgOwner(fakeDb(TABLES, { table: 'organizations' }), OWNER))?.status, 500);
});

// ── Cron / service_role ─────────────────────────────────────────────────────

const req = (auth?: string) => new Request('https://x.test/fn', { method: 'POST', headers: auth ? { Authorization: auth } : {} });

test('cron : refuse sans header, clé anon et JWT utilisateur', async () => {
  for (const auth of [undefined, `Bearer ${ANON_JWT}`, `Bearer ${USER_JWT}`, 'Bearer pas-un-jwt', SERVICE_KEY]) {
    const res = cronOnly(req(auth), SERVICE_KEY);
    assert.equal(res?.status, 403, String(auth));
    assert.equal((await body(res!)).message, CRON_ONLY_MESSAGE);
  }
});

test('cron : accepte l’appel pg_cron (clé service_role exacte ou JWT service_role du Vault)', () => {
  assert.equal(cronOnly(req(`Bearer ${SERVICE_KEY}`), SERVICE_KEY), null);
  assert.equal(cronOnly(req(`bearer ${SERVICE_KEY}`), SERVICE_KEY), null);
  assert.equal(cronOnly(req(`Bearer ${SERVICE_JWT}`), SERVICE_KEY), null);
  assert.equal(cronOnly(req(`Bearer ${SERVICE_JWT}`), undefined), null);
});

test('isServiceRoleRequest : clé proche ou vide refusée', () => {
  assert.equal(isServiceRoleRequest(`Bearer ${SERVICE_KEY}x`, SERVICE_KEY), false);
  assert.equal(isServiceRoleRequest('Bearer ', SERVICE_KEY), false);
  assert.equal(isServiceRoleRequest(`Bearer ${SERVICE_KEY}`, ''), false);
  assert.equal(bearerToken('Basic abc'), null);
});

test('fonctions mixtes : service_role, ou admin de l’org ; intrus 403, anon 401', async () => {
  const db = fakeDb(TABLES);
  const res = { kind: 'slot', id: 'sl-a' } as const;
  const sys = await requireServiceOrOrgAdmin(`Bearer ${SERVICE_JWT}`, SERVICE_KEY, getUser, db, res);
  assert.equal(sys.response ? null : sys.system, true);
  const admin = await requireServiceOrOrgAdmin(`Bearer ${OWNER}-jwt`, SERVICE_KEY, getUser, db, res);
  assert.equal(admin.response ? null : admin.system, false);
  assert.equal((await requireServiceOrOrgAdmin(`Bearer ${INTRUDER}-jwt`, SERVICE_KEY, getUser, db, res)).response?.status, 403);
  assert.equal((await requireServiceOrOrgAdmin(`Bearer ${ANON_JWT}`, SERVICE_KEY, getUser, db, res)).response?.status, 401);
});

test('requireAppAdmin : membre d’app_admins → null, sinon 403, lecture en échec → 500', async () => {
  const db = fakeDb({ app_admins: [{ user_id: OWNER }] });
  assert.equal(await requireAppAdmin(db, OWNER), null);
  const denied = await requireAppAdmin(db, INTRUDER);
  assert.equal(denied?.status, 403);
  assert.equal((await body(denied!)).error, APP_ADMIN_MESSAGE);
  assert.equal((await requireAppAdmin(fakeDb({}, { table: 'app_admins' }), OWNER))?.status, 500);
});
