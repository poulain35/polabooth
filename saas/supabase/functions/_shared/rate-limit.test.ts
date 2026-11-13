import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkRateLimit, clientIp, countHits, evaluateRateLimit, hashKey, ipHeaderNames, peekRateLimit } from './rate-limit.ts';

const H = 3600 * 1000;
const NOW = Date.UTC(2027, 0, 10, 12, 0, 0);

test('evaluateRateLimit : sous la limite', () => {
  assert.deepEqual(evaluateRateLimit([], 5, H, NOW), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(evaluateRateLimit([NOW - 10, NOW - 20, NOW - 30, NOW - 40], 5, H, NOW), { allowed: true, retryAfterSeconds: 0 });
});

test('evaluateRateLimit : limite atteinte → Retry-After jusqu\'à la libération d\'une place', () => {
  const ts = [NOW - 50 * 60_000, NOW - 40 * 60_000, NOW - 30 * 60_000, NOW - 20 * 60_000, NOW - 10 * 60_000];
  assert.deepEqual(evaluateRateLimit(ts, 5, H, NOW), { allowed: false, retryAfterSeconds: 600 });
});

test('evaluateRateLimit : les entrées hors fenêtre ne comptent pas', () => {
  const ts = [NOW - 2 * H, NOW - H - 1, NOW - 3, NOW - 2, NOW - 1];
  assert.equal(evaluateRateLimit(ts, 5, H, NOW).allowed, true);
});

test('hashKey : sha256(valeur + sel), sel obligatoire', async () => {
  const expected = createHash('sha256').update('1.2.3.4' + 'sel').digest('hex');
  assert.equal(await hashKey('1.2.3.4', 'sel'), expected);
  assert.notEqual(await hashKey('1.2.3.4', 'autre'), expected);
  await assert.rejects(() => hashKey('1.2.3.4', ''));
});

test('clientIp : dernier élément de X-Forwarded-For à défaut d\'autre en-tête', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '10.0.0.1');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
  assert.equal(clientIp(new Headers()), 'unknown');
});

// Faux client supabase-js : table en mémoire, filtres eq / gt, tri, limite, count.
function fakeDb(rows: { bucket: string; created_at: string }[]) {
  return {
    rows,
    from(table: string) {
      assert.equal(table, 'booking_rate_limits');
      const filters: ((r: { bucket: string; created_at: string }) => boolean)[] = [];
      let desc = false;
      let lim = Infinity;
      let head = false;
      const q = {
        select(_cols: string, opts?: { head?: boolean }) { head = !!opts?.head; return q; },
        eq(col: 'bucket', v: string) { filters.push((r) => r[col] === v); return q; },
        gt(col: 'created_at', v: string) { filters.push((r) => Date.parse(r[col]) > Date.parse(v)); return q; },
        order(_c: string, o: { ascending: boolean }) { desc = !o.ascending; return q; },
        limit(n: number) { lim = n; return q; },
        insert(row: { bucket: string }) {
          rows.push({ bucket: row.bucket, created_at: new Date(NOW).toISOString() });
          return Promise.resolve({ error: null });
        },
        then(resolve: (v: unknown) => void) {
          let out = rows.filter((r) => filters.every((f) => f(r)));
          out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
          if (desc) out.reverse();
          out = out.slice(0, lim);
          resolve(head ? { count: out.length, error: null } : { data: out, error: null });
        },
      };
      return q;
    },
  };
}

test('checkRateLimit : enregistre les requêtes autorisées, bloque la 6e', async () => {
  const db = fakeDb([]);
  for (let i = 0; i < 5; i++) {
    assert.equal((await checkRateLimit(db, 'ip:a', 5, 3600, NOW)).allowed, true);
  }
  const blocked = await checkRateLimit(db, 'ip:a', 5, 3600, NOW);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 3600);
  assert.equal(db.rows.length, 5);
  assert.equal((await checkRateLimit(db, 'ip:b', 5, 3600, NOW)).allowed, true);
});

test('checkRateLimit : une place se libère après la fenêtre', async () => {
  const old = new Date(NOW - H - 1000).toISOString();
  const db = fakeDb(Array.from({ length: 5 }, () => ({ bucket: 'ip:a', created_at: old })));
  assert.equal((await checkRateLimit(db, 'ip:a', 5, 3600, NOW)).allowed, true);
});

test('countHits : compte le bucket dans la fenêtre', async () => {
  const db = fakeDb([
    { bucket: 'global', created_at: new Date(NOW - 1000).toISOString() },
    { bucket: 'global', created_at: new Date(NOW - 2 * 86400_000).toISOString() },
    { bucket: 'ip:a', created_at: new Date(NOW - 1000).toISOString() },
  ]);
  assert.equal(await countHits(db, 'global', 86400, NOW), 1);
});

// ── Couverture complémentaire (agent Test LAB-58) ────────────────────────────

const DAY_S = 86400;

test('checkRateLimit : par email, 3 par jour glissant (défaut per_email_per_day)', async () => {
  const db = fakeDb([]);
  for (let i = 0; i < 3; i++) assert.equal((await checkRateLimit(db, 'email:h1', 3, DAY_S, NOW)).allowed, true);
  const blocked = await checkRateLimit(db, 'email:h1', 3, DAY_S, NOW);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, DAY_S);
  // une requête vieille de 23 h compte encore, une de 25 h non
  const db2 = fakeDb([
    { bucket: 'email:h1', created_at: new Date(NOW - 23 * H).toISOString() },
    { bucket: 'email:h1', created_at: new Date(NOW - 23 * H).toISOString() },
    { bucket: 'email:h1', created_at: new Date(NOW - 25 * H).toISOString() },
  ]);
  assert.equal((await checkRateLimit(db2, 'email:h1', 3, DAY_S, NOW)).allowed, true);
  assert.equal((await checkRateLimit(db2, 'email:h1', 3, DAY_S, NOW)).allowed, false);
});

test('checkRateLimit : buckets isolés (ip / email / global), refus non enregistré', async () => {
  const db = fakeDb(Array.from({ length: 5 }, () => ({ bucket: 'ip:a', created_at: new Date(NOW - 1000).toISOString() })));
  assert.equal((await checkRateLimit(db, 'ip:a', 5, 3600, NOW)).allowed, false);
  assert.equal(db.rows.length, 5);
  assert.equal((await checkRateLimit(db, 'email:a', 3, DAY_S, NOW)).allowed, true);
  assert.equal(await countHits(db, 'global', DAY_S, NOW), 0);
});

test('countHits : compteur global — alerte une seule fois au franchissement (before === limit)', async () => {
  const limit = 50;
  const db = fakeDb(Array.from({ length: 49 }, () => ({ bucket: 'global', created_at: new Date(NOW - 1000).toISOString() })));
  const alerts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const before = await countHits(db, 'global', DAY_S, NOW);
    db.rows.push({ bucket: 'global', created_at: new Date(NOW).toISOString() });
    if (before === limit) alerts.push(before);
  }
  assert.deepEqual(alerts, [50]);
});

test('clientIp : cf-connecting-ip puis x-real-ip, prioritaires sur XFF', () => {
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '198.51.100.9', 'x-real-ip': '198.51.100.2' })), '198.51.100.9');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': ' 198.51.100.9 ' })), '198.51.100.9');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
});

test('clientIp : un XFF forgé par le client ne contourne pas la limite (dernier élément)', () => {
  const forged = (spoof: string) => new Headers({ 'x-forwarded-for': `${spoof}, 203.0.113.7` });
  assert.equal(clientIp(forged('1.1.1.1')), '203.0.113.7');
  assert.equal(clientIp(forged('2.2.2.2')), '203.0.113.7');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, , ' })), '203.0.113.7');
});

test('ipHeaderNames : noms présents seulement, jamais les valeurs', () => {
  const names = ipHeaderNames(new Headers({ 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '198.51.100.9', 'user-agent': 'x' }));
  assert.deepEqual(names, ['cf-connecting-ip', 'x-forwarded-for']);
  assert.equal(JSON.stringify(names).includes('203.0.113.7'), false);
});

test('peekRateLimit : décide sans enregistrer (LAB-111)', async () => {
  const db = fakeDb(Array.from({ length: 4 }, () => ({ bucket: 'pub:x', created_at: new Date(NOW - 1000).toISOString() })));
  assert.equal((await peekRateLimit(db, 'pub:x', 5, 3600, NOW)).allowed, true);
  assert.equal((await peekRateLimit(db, 'pub:x', 5, 3600, NOW)).allowed, true);
  assert.equal(db.rows.length, 4);
  assert.equal((await peekRateLimit(db, 'pub:x', 4, 3600, NOW)).allowed, false);
});
