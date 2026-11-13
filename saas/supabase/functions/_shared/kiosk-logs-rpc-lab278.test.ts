// LAB-128 / LAB-278 (partie SaaS) : journaux de la borne par la RPC kiosk_record_logs (licence
// vérifiée, 100 lignes par lot, 600 lignes / 15 min par borne), puis LAB-280 : plus aucun droit direct
// d'anon sur kiosk_logs. Contrôles statiques des migrations et du script de vérification SQL.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const TESTS = new URL('../../tests/', import.meta.url);

const LOGS_RPC = '20261216000003_lab128_kiosk_record_logs.sql';
const NO_ANON = '20261218000000_lab280_kiosk_logs_no_anon_insert.sql';
const MIGRATIONS = [LOGS_RPC, NO_ANON];
const CHECKS = ['lab128_kiosk_logs_check.sql'];

const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const migration = (f: string) => strip(readPrivateHistory(new URL(f, DIR)));
const all = () => readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SECRETS = [/eyJ[A-Za-z0-9_-]{10,}/, /sbp_[A-Za-z0-9]{10,}/, /\b[a-z]{20}\.supabase\.co/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /service_role_key|sk_live_/i];

test('migrations : présentes, horodatages uniques, rejouables (DROP POLICY IF EXISTS avant chaque CREATE, CREATE OR REPLACE)', { skip: PRIVATE_HISTORY }, () => {
  const files = all();
  for (const f of MIGRATIONS) assert.ok(files.includes(f), f);
  assert.equal(new Set(files.map((f) => f.split('_')[0])).size, files.length, 'timestamps uniques');
  for (const f of MIGRATIONS) {
    const sql = migration(f);
    assert.doesNotMatch(sql, /DROP POLICY (?!IF EXISTS)/, f);
    assert.doesNotMatch(sql, /CREATE FUNCTION/, f);
    assert.doesNotMatch(sql, /CREATE TABLE|ADD COLUMN|DROP TABLE|DELETE FROM|TRUNCATE (TABLE )?public/i, f);
    for (const m of sql.matchAll(/CREATE POLICY ("[^"]+") ON (\S+)/g)) {
      const drop = sql.indexOf(`DROP POLICY IF EXISTS ${m[1]} ON ${m[2]};`);
      assert.ok(drop >= 0 && drop < m.index!, `${f} : DROP POLICY IF EXISTS ${m[1]} avant CREATE`);
    }
  }
});

test('kiosk_record_logs : signature de la spec (section 5), licence 42501, limite PT429, anon seul', { skip: PRIVATE_HISTORY }, () => {
  const sql = migration(LOGS_RPC);
  const head = flat(sql.slice(0, sql.indexOf('AS $$')));
  assert.match(head, /CREATE OR REPLACE FUNCTION public\.kiosk_record_logs\(p_machine_id TEXT, p_secret TEXT, p_logs JSONB\) RETURNS INTEGER/);
  assert.match(head, /SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(sql, /USING ERRCODE = '42501'/);
  assert.match(sql, /RAISE SQLSTATE 'PT429'[\s\S]*?HINT\s+= 'trop_de_requetes'/);
  assert.match(sql, /'kiosk:logs:' \|\| /);
  assert.match(sql, /600/);
  assert.match(sql, /jsonb_array_length\(p_logs\) > 100/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  // machine_id de la licence, jamais celui du lot.
  assert.doesNotMatch(sql, /->>\s*'machine_id'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.kiosk_record_logs\(TEXT, TEXT, JSONB\) FROM PUBLIC, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_record_logs\(TEXT, TEXT, JSONB\) TO anon;/);
});

test('scripts de vérification : transaction annulée, résultat final OK, aucun secret ni UUID figé', { skip: PRIVATE_HISTORY }, () => {
  for (const f of CHECKS) {
    const raw = readPrivateHistory(new URL(f, TESTS));
    for (const re of SECRETS) assert.doesNotMatch(raw, re, `${f} : ${re}`);
    const body = strip(raw);
    assert.match(body, /^\s*BEGIN;/, f);
    assert.match(body, /ROLLBACK;\s*$/, f);
    assert.doesNotMatch(body, /\bCOMMIT\b/i, f);
    assert.doesNotMatch(body, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i, f);
    assert.match(body, /SELECT 'LAB-128 [^']+ OK' AS resultat/, f);
    for (const m of body.matchAll(/RAISE EXCEPTION '([^']*)/g)) assert.match(m[1], /^LAB-128 KO : /, `${f} : ${m[1]}`);
  }
});

test('LAB-280 : policy anon_insert_kiosk_logs supprimée et plus aucun droit d\'anon sur kiosk_logs', { skip: PRIVATE_HISTORY }, () => {
  const files = all();
  assert.ok(files.indexOf(NO_ANON) > files.indexOf(LOGS_RPC), 'après la RPC des journaux');
  const sql = flat(migration(NO_ANON));
  assert.equal(sql, 'DROP POLICY IF EXISTS "anon_insert_kiosk_logs" ON public.kiosk_logs; REVOKE ALL ON public.kiosk_logs FROM anon;');
  // Aucune migration plus récente ne rend un droit ou une policy à anon sur kiosk_logs.
  for (const f of files.filter((x) => x > NO_ANON)) {
    const later = migration(f);
    assert.doesNotMatch(later, /GRANT[^;]*ON (TABLE )?public\.kiosk_logs[^;]*TO[^;]*\banon\b/i, f);
    assert.doesNotMatch(later, /CREATE POLICY[^;]*ON public\.kiosk_logs[^;]*TO[^;]*\banon\b/i, f);
  }
  const check = strip(readPrivateHistory(new URL('lab128_kiosk_logs_check.sql', TESTS)));
  assert.match(check, /IF EXISTS \(SELECT 1 FROM pg_policies[\s\S]*?policyname = 'anon_insert_kiosk_logs'\)/);
  assert.match(check, /INSERT INTO public\.kiosk_logs[\s\S]*?EXCEPTION WHEN insufficient_privilege/);
});
