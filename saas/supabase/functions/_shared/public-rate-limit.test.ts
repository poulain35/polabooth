import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, PublicGuard, SERVICE_UNAVAILABLE_BODY, retryHint, tooManyRequests, type Rule } from './public-rate-limit.ts';

const NOW = Date.UTC(2027, 0, 10, 12, 0, 0);
const SALT = 'sel-de-test';
const IP_HEADERS = () => new Headers({ 'cf-connecting-ip': '198.51.100.9' });

type Row = { bucket: string; created_at: string };

// Faux client supabase-js (cf. rate-limit.test.ts) + compteur d'appels et pannes simulées.
function fakeDb(rows: Row[] = [], fail: { select?: boolean; insert?: boolean; throws?: boolean } = {}) {
  const db = {
    rows,
    calls: 0,
    from(table: string) {
      db.calls++;
      if (fail.throws) throw new Error('réseau coupé');
      assert.equal(table, 'booking_rate_limits');
      const filters: ((r: Row) => boolean)[] = [];
      let lim = Infinity;
      const q = {
        select() { return q; },
        eq(col: 'bucket', v: string) { filters.push((r) => r[col] === v); return q; },
        gt(col: 'created_at', v: string) { filters.push((r) => Date.parse(r[col]) > Date.parse(v)); return q; },
        order() { return q; },
        limit(n: number) { lim = n; return q; },
        insert(row: { bucket: string }) {
          if (fail.insert) return Promise.resolve({ error: { message: 'insert refusé' } });
          rows.push({ bucket: row.bucket, created_at: new Date(NOW).toISOString() });
          return Promise.resolve({ error: null });
        },
        then(resolve: (v: unknown) => void) {
          if (fail.select) return resolve({ data: null, error: { message: 'timeout' } });
          resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, lim), error: null });
        },
      };
      return q;
    },
  };
  return db;
}

function guard(fn: string, db: ReturnType<typeof fakeDb>, opts: { salt?: string; headers?: Headers } = {}) {
  return new PublicGuard(fn, {
    db,
    salt: 'salt' in opts ? opts.salt : SALT,
    headers: opts.headers ?? IP_HEADERS(),
    now: () => NOW,
  });
}

/** Capture console.error / console.warn le temps d'un test. */
async function captureConsole<T>(run: () => Promise<T>): Promise<{ result: T; errors: string[]; warns: string[] }> {
  const errors: string[] = [];
  const warns: string[] = [];
  const { error, warn } = console;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
  try {
    return { result: await run(), errors, warns };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

const RULE: Rule = { bucket: 'test:ip', limit: 3, windowSeconds: 60 };

test('retryHint : secondes, minutes et heures arrondies au supérieur', () => {
  assert.equal(retryHint(1), 'Réessayez dans 1 seconde.');
  assert.equal(retryHint(0.2), 'Réessayez dans 1 seconde.');
  assert.equal(retryHint(42), 'Réessayez dans 42 secondes.');
  assert.equal(retryHint(60), 'Réessayez dans 1 minute.');
  assert.equal(retryHint(61), 'Réessayez dans 2 minutes.');
  assert.equal(retryHint(3600), 'Réessayez dans 1 heure.');
  assert.equal(retryHint(86400), 'Réessayez dans 24 heures.');
});

test('tooManyRequests : 429, Retry-After exposé en CORS, message français dans `error`', async () => {
  const res = tooManyRequests(90.4);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '91');
  assert.match(res.headers.get('Access-Control-Expose-Headers') ?? '', /Retry-After/);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const body = await res.json();
  assert.deepEqual(body, { error: 'Trop de requêtes. Réessayez dans 2 minutes.', code: 'trop_de_requetes', retry_after: 91 });
});

test('check : autorise sous la limite, compte chaque requête, puis 429', async () => {
  const db = fakeDb();
  const g = guard('t-basic', db);
  for (let i = 0; i < 3; i++) assert.equal(await g.check([[RULE, g.ip]]), null);
  assert.equal(db.rows.length, 3);
  assert.ok(db.rows.every((r) => r.bucket.startsWith('pub:test:ip:') && !r.bucket.includes('198.51.100.9')));

  const { result, warns } = await captureConsole(() => g.check([[RULE, g.ip]]));
  assert.equal(result?.status, 429);
  assert.equal(result?.headers.get('Retry-After'), '60');
  assert.equal(db.rows.length, 3, 'une requête refusée n\'est pas comptée');
  assert.match(warns[0], /t-basic : 429 \(test:ip\)/);
});

test('check : contrôle groupé, une règle dépassée ⇒ rien n\'est compté nulle part', async () => {
  const db = fakeDb();
  const tight: Rule = { bucket: 'test:code', limit: 1, windowSeconds: 3600 };
  const g = guard('t-group', db);
  assert.equal(await g.check([[RULE, g.ip], [tight, 'ABC123']]), null);
  assert.equal(db.rows.length, 2);
  const { result } = await captureConsole(() => g.check([[RULE, g.ip], [tight, 'ABC123']]));
  assert.equal(result?.status, 429);
  assert.equal(result?.headers.get('Retry-After'), '3600', 'Retry-After = le plus long des blocages');
  assert.equal(db.rows.length, 2);
  // un autre code n'est pas concerné
  assert.equal(await g.check([[RULE, g.ip], [tight, 'XYZ789']]), null);
});

test('check : la clé est normalisée par l\'appelant, les buckets sont isolés par clé et par règle', async () => {
  const db = fakeDb();
  const g = guard('t-iso', db);
  const one: Rule = { bucket: 'test:one', limit: 1, windowSeconds: 60 };
  const other: Rule = { bucket: 'test:other', limit: 1, windowSeconds: 60 };
  assert.equal(await g.check([[one, 'a']]), null);
  assert.equal(await g.check([[one, 'b']]), null);
  assert.equal(await g.check([[other, 'a']]), null);
  const { result } = await captureConsole(() => g.check([[one, 'a']]));
  assert.equal(result?.status, 429);
});

test('check : clé nulle ou vide ⇒ règle ignorée', async () => {
  const db = fakeDb();
  const g = guard('t-null', db);
  const one: Rule = { bucket: 'test:one', limit: 1, windowSeconds: 60 };
  for (let i = 0; i < 3; i++) assert.equal(await g.check([[one, null], [one, ''], [one, undefined]]), null);
  assert.equal(db.calls, 0);
});

test('codeFailures : les échecs bloquent l\'IP, mais check() ne compte pas d\'échec', async () => {
  const db = fakeDb();
  const g = guard('t-fail', db);
  // requêtes à code valide : jamais comptées comme échecs
  for (let i = 0; i < LIMITS.codeFailures.limit + 5; i++) {
    assert.equal(await g.check([], { codeFailures: true }), null);
  }
  assert.equal(db.rows.length, 0);

  for (let i = 0; i < LIMITS.codeFailures.limit; i++) await g.codeFailed();
  assert.equal(db.rows.length, LIMITS.codeFailures.limit);
  const { result } = await captureConsole(() => g.check([[RULE, g.ip]], { codeFailures: true }));
  assert.equal(result?.status, 429);
  assert.equal(result?.headers.get('Retry-After'), String(LIMITS.codeFailures.windowSeconds));

  // sans l'option, la fonction n'est pas concernée par les échecs de code
  assert.equal(await g.check([[RULE, g.ip]]), null);
});

test('codeFailures : compteur partagé entre fonctions pour une même IP', async () => {
  const db = fakeDb();
  const a = guard('t-shared-a', db);
  const b = guard('t-shared-b', db);
  for (let i = 0; i < LIMITS.codeFailures.limit; i++) await a.codeFailed();
  const { result } = await captureConsole(() => b.check([], { codeFailures: true }));
  assert.equal(result?.status, 429);
  const otherIp = guard('t-shared-c', db, { headers: new Headers({ 'cf-connecting-ip': '203.0.113.50' }) });
  assert.equal(await otherIp.check([], { codeFailures: true }), null);
});

test('IP introuvable : règles par IP ignorées, règles par code appliquées, log unique', async () => {
  const db = fakeDb();
  const one: Rule = { bucket: 'test:code', limit: 1, windowSeconds: 60 };
  const { result: g, errors } = await captureConsole(async () => {
    const first = guard('t-noip', db, { headers: new Headers() });
    guard('t-noip', db, { headers: new Headers() });
    return first;
  });
  assert.equal(g.ip, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /IP client introuvable/);

  assert.equal(await g.check([[RULE, g.ip], [one, 'ABC123']], { codeFailures: true }), null);
  await g.codeFailed();
  assert.equal(db.rows.length, 1, 'seul le bucket du code est compté');
  const { result } = await captureConsole(() => g.check([[RULE, g.ip], [one, 'ABC123']]));
  assert.equal(result?.status, 429);
});

test('fail-closed (LAB-392) : RATE_LIMIT_SALT absent ⇒ 503 générique, aucun accès base, log à chaque refus', async () => {
  const db = fakeDb();
  const { result, errors } = await captureConsole(async () => {
    const g = guard('t-nosalt', db, { salt: undefined });
    const out: (Response | null)[] = [];
    for (let i = 0; i < 3; i++) out.push(await g.check([[RULE, g.ip]], { codeFailures: true }));
    await g.codeFailed();
    const g2 = guard('t-nosalt', db, { salt: '' });
    out.push(await g2.check([[RULE, g2.ip]]));
    return out;
  });
  assert.equal(result.length, 4);
  for (const r of result) {
    assert.equal(r?.status, 503);
    assert.equal(r?.headers.get('Access-Control-Allow-Origin'), '*');
    const body = await r!.json();
    assert.deepEqual(body, { ...SERVICE_UNAVAILABLE_BODY });
    assert.doesNotMatch(JSON.stringify(body), /SALT/);
  }
  assert.equal(db.calls, 0);
  assert.equal(errors.length, 4);
  assert.ok(errors.every((e) => /t-nosalt : RATE_LIMIT_SALT manquant, requête refusée \(503/.test(e)));
});

test('fail-open : table en erreur (select) ⇒ requête servie + console.error', async () => {
  const db = fakeDb([], { select: true });
  const { result, errors } = await captureConsole(() => guard('t-select', db).check([[RULE, '1']]));
  assert.equal(result, null);
  assert.match(errors[0], /t-select : limitation de débit indisponible, requête servie \(fail-open\)/);
  assert.match(errors[0], /timeout/);
});

test('fail-open : insert en erreur ⇒ requête servie + console.error', async () => {
  const db = fakeDb([], { insert: true });
  const g = guard('t-insert', db);
  const { result, errors } = await captureConsole(async () => {
    const r = await g.check([[RULE, g.ip]]);
    await g.codeFailed();
    return r;
  });
  assert.equal(result, null);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => /fail-open/.test(e)));
});

test('fail-open : client qui lève une exception ⇒ requête servie', async () => {
  const db = fakeDb([], { throws: true });
  const g = guard('t-throw', db);
  const { result, errors } = await captureConsole(async () => {
    const r = await g.check([[RULE, g.ip]], { codeFailures: true });
    await g.codeFailed();
    return r;
  });
  assert.equal(result, null);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /réseau coupé/);
});

test('LIMITS : fenêtres ≤ 48 h (purge cron) et lectures bornées', () => {
  const buckets = new Set<string>();
  for (const [name, rule] of Object.entries(LIMITS)) {
    assert.ok(rule.windowSeconds <= 48 * 3600, `${name} : fenêtre > 48 h, purgée avant expiration`);
    assert.ok(rule.limit > 0 && rule.limit <= 600, `${name} : limite hors bornes (select de ${rule.limit} lignes)`);
    assert.ok(!buckets.has(rule.bucket), `${name} : préfixe de bucket dupliqué`);
    buckets.add(rule.bucket);
  }
});

test('LIMITS : usage réel jamais bloqué (kiosk, éditeur client, invités derrière un NAT)', () => {
  const perMinute = (r: Rule) => r.limit / (r.windowSeconds / 60);
  // Autosave : debounce 1,5 s ⇒ 40/min max pour un éditeur en continu.
  assert.ok(perMinute(LIMITS.autosaveCode) >= 40);
  // Kiosk : 1 séance ≥ 30 s ⇒ 2 emails/min par borne ; plusieurs bornes derrière un routeur.
  assert.ok(perMinute(LIMITS.kioskEmailIp) >= 2 * 6);
  // 150 invités qui ouvrent la galerie en même temps derrière le Wi-Fi de la salle.
  assert.ok(LIMITS.getPhotosIp.limit >= 150);
  assert.ok(LIMITS.getEventIp.limit >= 150);
  // Upload invité : 2 URL par photo, plafond identique à l'enregistrement.
  assert.equal(LIMITS.guestUploadIp.limit, 2 * LIMITS.guestRecordIp.limit);
});
