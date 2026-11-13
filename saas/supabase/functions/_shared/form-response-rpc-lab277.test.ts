// LAB-128 / LAB-277 : formulaire client par la RPC submit_form_response (limite par IP, 64 Ko),
// puis plus aucun INSERT direct dans event_form_responses (migration de verrouillage, appliquée après
// le déploiement du front). Contrôles statiques des migrations et du script de vérification SQL.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const TESTS = new URL('../../tests/', import.meta.url);

const FORM_RPC = '20261216000002_lab128_submit_form_response.sql';
const LOCKDOWN = '20261216000004_lab128_form_responses_lockdown.sql';
const MIGRATIONS = [FORM_RPC, LOCKDOWN];
const CHECKS = ['lab128_form_responses_check.sql'];

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

test('verrouillage : dernière migration LAB-128, appliquée après le déploiement du front', { skip: PRIVATE_HISTORY }, () => {
  const lab128 = all().filter((f) => f.includes('_lab128_'));
  assert.equal(lab128[lab128.length - 1], LOCKDOWN);
  assert.match(readPrivateHistory(new URL(LOCKDOWN, DIR)), /APRÈS le déploiement du front/);
});

test('submit_form_response : DEFINER, search_path, 64 Ko, 20 envois par IP, échec de code compté sans exception', { skip: PRIVATE_HISTORY }, () => {
  const sql = migration(FORM_RPC);
  const head = flat(sql.slice(0, sql.indexOf('AS $$')));
  assert.match(head, /CREATE OR REPLACE FUNCTION public\.submit_form_response\(p_code TEXT, p_answers JSONB\) RETURNS BOOLEAN/);
  assert.match(head, /SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(sql, /jsonb_typeof\(p_answers\) <> 'object'/);
  assert.match(sql, /octet_length\(p_answers::text\) > 65536/);
  assert.match(sql, /public\.rpc_code_guard\(\)/);
  assert.match(sql, /'form:submit:ip:' \|\| /);
  assert.match(sql, /public\.kiosk_rate_limited\(v_bucket, 20\)/);
  assert.match(sql, /RAISE SQLSTATE 'PT429'[\s\S]*?HINT\s+= 'trop_de_requetes'/);
  assert.match(flat(sql), /e\.access_code = p_code AND e\.status = 'active'/);
  // Code inconnu : l'échec est enregistré puis false (une exception annulerait l'enregistrement).
  assert.match(sql, /PERFORM public\.rpc_code_failed\(v_code_bucket\);\s+RETURN false;/);
  assert.match(sql, /org_feature_enabled\([^)]*'guest_form'\)/);
  assert.match(sql, /RAISE EXCEPTION 'fonctionnalite_desactivee' USING ERRCODE = 'PT404';/);
  assert.match(sql, /INSERT INTO public\.event_form_responses \(event_id, answers\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_form_response\(TEXT, JSONB\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_form_response\(TEXT, JSONB\) TO anon, authenticated;/);
});

test('verrouillage du formulaire : policies d\'insertion retirées, plus d\'INSERT pour anon ni authenticated', { skip: PRIVATE_HISTORY }, () => {
  const sql = migration(LOCKDOWN);
  for (const name of ['anon_insert_form_response', 'anon peut soumettre une réponse au formulaire', 'anon_insert_form_responses', 'event_form_responses_owner_insert']) {
    assert.ok(sql.includes(`DROP POLICY IF EXISTS "${name}" ON public.event_form_responses;`), name);
  }
  assert.match(sql, /REVOKE INSERT ON public\.event_form_responses FROM anon, authenticated;/);
  assert.doesNotMatch(sql, /\bGRANT\b|CREATE POLICY|owner_select/);
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
