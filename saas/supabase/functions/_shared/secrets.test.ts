// Open core L6a : getSecret (Vault puis variable d'environnement) et getServiceSetting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSecret, getSecrets, getServiceSetting, resolveSecret, SECRET_CACHE_TTL_MS, type EnvGet,
} from './secrets.ts';

// Faux client : rpc('get_service_key', { p_name }) depuis un dictionnaire, appels comptés.
function fakeDb(vault: Record<string, string | null>, opts: { error?: boolean; throws?: boolean } = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args });
      if (opts.throws) return Promise.reject(new Error('fetch failed'));
      if (opts.error) {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
      }
      return Promise.resolve({ data: vault[String(args?.p_name)] ?? null, error: null });
    },
  };
}

const envOf = (vars: Record<string, string>): EnvGet => (name) => vars[name];

test('getSecret : la clé saisie (Vault) l\'emporte sur la variable d\'environnement', async () => {
  const db = fakeDb({ BREVO_API_KEY: 'xkeysib-vault' });
  assert.equal(await getSecret(db, 'BREVO_API_KEY', envOf({ BREVO_API_KEY: 'xkeysib-env' })), 'xkeysib-vault');
  assert.deepEqual(db.calls, [{ fn: 'get_service_key', args: { p_name: 'BREVO_API_KEY' } }]);
});

test('getSecret : sans clé saisie (null ou vide), repli sur la variable d\'environnement', async () => {
  for (const stored of [null, '', '   ']) {
    const db = fakeDb({ REPLICATE_API_TOKEN: stored });
    const resolved = await resolveSecret(db, 'REPLICATE_API_TOKEN', envOf({ REPLICATE_API_TOKEN: 'r8_env' }));
    assert.deepEqual(resolved, { value: 'r8_env', source: 'env' }, String(stored));
  }
});

test('getSecret : erreur RPC (fonction absente) ou exception → variable d\'environnement', async () => {
  const env = envOf({ ANTHROPIC_API_KEY: 'sk-ant-env' });
  assert.deepEqual(await resolveSecret(fakeDb({}, { error: true }), 'ANTHROPIC_API_KEY', env), { value: 'sk-ant-env', source: 'env' });
  assert.deepEqual(await resolveSecret(fakeDb({}, { throws: true }), 'ANTHROPIC_API_KEY', env), { value: 'sk-ant-env', source: 'env' });
});

test('getSecret : rien nulle part → null, source none', async () => {
  const db = fakeDb({});
  assert.deepEqual(await resolveSecret(db, 'PENNYLANE_API_KEY', envOf({ PENNYLANE_API_KEY: '  ' })), { value: null, source: 'none' });
  assert.equal(await getSecret(fakeDb({}), 'PENNYLANE_API_KEY', envOf({})), null);
});

test('getSecret : valeur nettoyée des espaces et retours chariot', async () => {
  assert.equal(await getSecret(fakeDb({}), 'BREVO_API_KEY', envOf({ BREVO_API_KEY: 'abc\r' })), 'abc');
});

test('cache : une lecture par client et par nom, client distinct = nouvelle lecture', async () => {
  const db = fakeDb({ BREVO_API_KEY: 'v1' });
  const env = envOf({});
  await Promise.all([getSecret(db, 'BREVO_API_KEY', env), getSecret(db, 'BREVO_API_KEY', env)]);
  assert.equal(await getSecret(db, 'BREVO_API_KEY', env), 'v1');
  assert.equal(db.calls.length, 1);
  await getSecret(db, 'REPLICATE_API_TOKEN', env);
  assert.equal(db.calls.length, 2);

  const other = fakeDb({ BREVO_API_KEY: 'v2' });
  assert.equal(await getSecret(other, 'BREVO_API_KEY', env), 'v2');
  assert.equal(other.calls.length, 1);
});

test('cache : relu après SECRET_CACHE_TTL_MS', async () => {
  const vault: Record<string, string> = { BREVO_API_KEY: 'ancienne' };
  const db = fakeDb(vault);
  let t = 1_000;
  const now = () => t;
  assert.equal((await resolveSecret(db, 'BREVO_API_KEY', envOf({}), now)).value, 'ancienne');
  vault.BREVO_API_KEY = 'nouvelle';
  t += SECRET_CACHE_TTL_MS - 1;
  assert.equal((await resolveSecret(db, 'BREVO_API_KEY', envOf({}), now)).value, 'ancienne');
  t += 1;
  assert.equal((await resolveSecret(db, 'BREVO_API_KEY', envOf({}), now)).value, 'nouvelle');
  assert.equal(db.calls.length, 2);
});

test('getSecrets : trio Google, mélange Vault / environnement / absent', async () => {
  const db = fakeDb({ GOOGLE_CLIENT_ID: 'id-vault' });
  assert.deepEqual(
    await getSecrets(db, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'], envOf({ GOOGLE_CLIENT_SECRET: 'secret-env' })),
    { GOOGLE_CLIENT_ID: 'id-vault', GOOGLE_CLIENT_SECRET: 'secret-env', GOOGLE_REFRESH_TOKEN: null },
  );
});

// Faux client : from('organizations').select().eq() | order().limit() .maybeSingle().
function settingsDb(rows: Record<string, unknown>[], fail = false) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      let filter: ((r: Record<string, unknown>) => boolean) | null = null;
      const q = {
        select(cols: string) { calls.push(`select:${cols}`); return q; },
        eq(col: string, v: unknown) { calls.push(`eq:${col}`); filter = (r) => r[col] === v; return q; },
        order(col: string) { calls.push(`order:${col}`); return q; },
        limit(n: number) { calls.push(`limit:${n}`); return q; },
        maybeSingle() {
          if (fail) return Promise.resolve({ data: null, error: { message: 'timeout' } });
          const found = filter ? rows.find(filter) : rows[0];
          return Promise.resolve({ data: found ?? null, error: null });
        },
      };
      return q;
    },
  };
}

test('getServiceSetting : valeur de l\'org, sinon variable d\'environnement', async () => {
  const db = settingsDb([
    { id: 'org-1', service_settings: { assistant_model: 'claude-sonnet-5-5' } },
    { id: 'org-2', service_settings: {} },
  ]);
  const env = envOf({ ASSISTANT_MODEL: 'modele-env' });
  assert.equal(await getServiceSetting(db, 'org-1', 'assistant_model', 'ASSISTANT_MODEL', env), 'claude-sonnet-5-5');
  assert.equal(await getServiceSetting(db, 'org-2', 'assistant_model', 'ASSISTANT_MODEL', env), 'modele-env');
  assert.equal(await getServiceSetting(db, 'org-2', 'google_calendar_id', 'GOOGLE_CALENDAR_ID', env), null);
  assert.deepEqual(db.calls.slice(0, 3), ['from:organizations', 'select:service_settings', 'eq:id']);
});

test('getServiceSetting : sans orgId, première entreprise de l\'installation', async () => {
  const db = settingsDb([{ id: 'org-1', service_settings: { google_calendar_id: 'agenda@group.calendar.google.com' } }]);
  assert.equal(await getServiceSetting(db, null, 'google_calendar_id', 'GOOGLE_CALENDAR_ID', envOf({})), 'agenda@group.calendar.google.com');
  assert.deepEqual(db.calls, ['from:organizations', 'select:service_settings', 'order:created_at', 'limit:1']);
});

test('getServiceSetting : lecture en échec ou valeur vide → variable d\'environnement', async () => {
  const env = envOf({ GOOGLE_CALENDAR_ID: 'primary' });
  assert.equal(await getServiceSetting(settingsDb([], true), 'org-1', 'google_calendar_id', 'GOOGLE_CALENDAR_ID', env), 'primary');
  const blank = settingsDb([{ id: 'org-1', service_settings: { google_calendar_id: ' ' } }]);
  assert.equal(await getServiceSetting(blank, 'org-1', 'google_calendar_id', 'GOOGLE_CALENDAR_ID', env), 'primary');
});
