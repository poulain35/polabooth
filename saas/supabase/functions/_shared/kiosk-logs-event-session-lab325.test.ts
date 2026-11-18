// LAB-325 : journaux de la borne avec événement et séance (kiosk_logs.event_id / session_id), RPC
// kiosk_record_logs qui les lit sans refuser un lot, purge quotidienne à 90 jours.
// Contrôles statiques de la migration et du script de vérification SQL.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const TESTS = new URL('../../tests/', import.meta.url);

const MIGRATION = '20261223000000_kiosk_logs_event_session.sql';
const PREVIOUS_RPC = '20261216000003_lab128_kiosk_record_logs.sql';
const SECRET_HASH = '20270112000423_kiosk_secret_hash.sql';
const CHECK = 'lab325_kiosk_logs_event_session_check.sql';
const UUID_RE = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const sql = () => strip(readFileSync(new URL(MIGRATION, DIR), 'utf8'));
const files = () => readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const rpcBody = (s: string) => {
  const start = s.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_record_logs');
  return s.slice(start, s.indexOf('$$;', start));
};

test('migration : horodatage unique, dernière définition de kiosk_record_logs, rejouable', () => {
  const all = files();
  assert.ok(all.includes(MIGRATION));
  assert.equal(all.filter((f) => f.startsWith('20261223000000_')).length, 1);
  const later = all.filter((f) => f > MIGRATION)
    .filter((f) => /FUNCTION public\.kiosk_record_logs\(/.test(strip(readFileSync(new URL(f, DIR), 'utf8'))));
  // LAB-423 la redéfinit pour comparer l'empreinte du secret, sans rien changer d'autre.
  assert.deepEqual(later, [SECRET_HASH], 'seule la migration LAB-423 redéfinit la RPC');
  const hashed = (s: string) => flat(s.replace(/AND (l\.)?secret <> ''\s+AND (l\.)?secret = p_secret/g,
    'AND public.kiosk_secret_matches($1secret_hash, p_secret)'));
  assert.equal(flat(rpcBody(strip(readFileSync(new URL(SECRET_HASH, DIR), 'utf8')))), hashed(rpcBody(sql())));
  const s = sql();
  assert.match(s, /ADD COLUMN IF NOT EXISTS event_id\s+UUID NULL;/);
  assert.match(s, /ADD COLUMN IF NOT EXISTS session_id UUID NULL;/);
  assert.doesNotMatch(s, /ADD COLUMN (?!IF NOT EXISTS)/);
  assert.doesNotMatch(s, /CREATE INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(s, /CREATE FUNCTION/);
  assert.doesNotMatch(s, /DROP TABLE|TRUNCATE|DROP COLUMN/i);
});

test('colonnes sans clé étrangère, index (event_id, occurred_at DESC) et session_id', () => {
  const s = sql();
  assert.doesNotMatch(s, /REFERENCES|FOREIGN KEY/i);
  assert.match(s, /CREATE INDEX IF NOT EXISTS idx_kiosk_logs_event_occurred ON public\.kiosk_logs \(event_id, occurred_at DESC\);/);
  assert.match(s, /CREATE INDEX IF NOT EXISTS idx_kiosk_logs_session_id ON public\.kiosk_logs \(session_id\);/);
});

test('kiosk_record_logs : même signature et mêmes droits, anon seul', () => {
  const s = sql();
  const head = flat(s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'), s.indexOf('AS $$')));
  assert.match(head, /^CREATE OR REPLACE FUNCTION public\.kiosk_record_logs\(p_machine_id TEXT, p_secret TEXT, p_logs JSONB\) RETURNS INTEGER/);
  assert.match(head, /SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(s, /REVOKE ALL ON FUNCTION public\.kiosk_record_logs\(TEXT, TEXT, JSONB\) FROM PUBLIC, authenticated;/);
  assert.match(s, /GRANT EXECUTE ON FUNCTION public\.kiosk_record_logs\(TEXT, TEXT, JSONB\) TO anon;/);
  assert.doesNotMatch(s, /GRANT[^;]*kiosk_record_logs[^;]*\bauthenticated\b/);
});

test('kiosk_record_logs : règles d\'avant inchangées (licence, 100 lignes, 600 / 15 min, troncatures)', { skip: PRIVATE_HISTORY }, () => {
  const before = rpcBody(strip(readPrivateHistory(new URL(PREVIOUS_RPC, DIR))));
  const after = rpcBody(sql());
  // Seul l'INSERT dans kiosk_logs change : tout ce qui le précède est identique à LAB-278.
  const upToInsert = (b: string) => flat(b.slice(0, b.indexOf('INSERT INTO public.kiosk_logs')));
  assert.equal(upToInsert(after), upToInsert(before));
  const tail = (b: string) => flat(b).slice(flat(b).indexOf('FROM jsonb_array_elements(p_logs) AS l(item) ON CONFLICT'));
  assert.ok(tail(after).startsWith('FROM'));
  assert.equal(tail(after), tail(before));
  for (const rule of ["left(l.item ->> 'context', 200)", "left(COALESCE(l.item ->> 'message', ''), 2000)",
    "left(l.item ->> 'stack_trace', 4000)", "left(l.item ->> 'app_version', 50)", "now() + INTERVAL '1 day'"]) {
    assert.ok(after.includes(rule), rule);
  }
  assert.doesNotMatch(after, /->>\s*'machine_id'/);
});

test('kiosk_record_logs : event_id et session_id facultatifs, uuid invalide → null sans refuser le lot', () => {
  const body = rpcBody(sql());
  assert.match(flat(body), /INSERT INTO public\.kiosk_logs \(id, machine_id, level, context, message, stack_trace, app_version, occurred_at, event_id, session_id\)/);
  for (const key of ['event_id', 'session_id']) {
    const guard = flat(`CASE WHEN jsonb_typeof(l.item -> '${key}') = 'string'
      AND l.item ->> '${key}' ~* ${UUID_RE} THEN (l.item ->> '${key}')::uuid END`);
    assert.ok(flat(body).includes(guard), `${key} : cast protégé par le motif uuid, sinon null`);
    // Jamais de cast nu (un uuid invalide ferait échouer tout le lot), jamais d'erreur sur la clé.
    assert.equal(flat(body).split(`(l.item ->> '${key}')::uuid`).length, 2, `${key} : un seul cast`);
  }
  const checks = body.slice(0, body.indexOf('INSERT INTO public.kiosk_logs'));
  assert.doesNotMatch(checks, /event_id|session_id/, 'aucun refus du lot sur ces clés');
});

test('purge : tâche purge-kiosk-logs quotidienne (03:25 UTC), désplanifiée avant, 90 jours', () => {
  const s = flat(sql());
  const unschedule = s.indexOf("PERFORM cron.unschedule('purge-kiosk-logs'); EXCEPTION WHEN OTHERS THEN NULL;");
  const schedule = s.indexOf("SELECT cron.schedule( 'purge-kiosk-logs', '25 3 * * *', $$");
  assert.ok(unschedule >= 0 && schedule > unschedule, 'unschedule (sans erreur) puis schedule');
  const cmd = s.slice(schedule, s.indexOf('$$ );', schedule));
  assert.match(cmd, /\$\$ DELETE FROM public\.kiosk_logs WHERE occurred_at < now\(\) - INTERVAL '90 days' AND created_at < now\(\) - INTERVAL '90 days' $/);
  // Heure libre parmi les purges SQL de la nuit.
  const others = files().filter((f) => f !== MIGRATION)
    .flatMap((f) => [...strip(readFileSync(new URL(f, DIR), 'utf8')).matchAll(/cron\.schedule\(\s*'[\w-]+',\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(!others.includes('25 3 * * *'), '03:25 déjà prise');
});

test('manifeste et surveillance : purge-kiosk-logs dans core, toujours active, impact dans l\'email', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../features.json', import.meta.url), 'utf8'));
  assert.ok(manifest.features.core.tables.includes('kiosk_logs'));
  assert.ok(manifest.features.core.crons.includes('purge-kiosk-logs'));
  assert.ok(manifest.always_on.crons.includes('purge-kiosk-logs'));
  const email = readFileSync(new URL('../check-cron-alerts/email.ts', import.meta.url), 'utf8');
  assert.match(email, /'purge-kiosk-logs': '[^']*90 jours/);
});

test('script de vérification : transaction annulée, résultat final OK, aucun secret ni UUID figé', { skip: PRIVATE_HISTORY }, () => {
  const raw = readPrivateHistory(new URL(CHECK, TESTS));
  for (const re of [/eyJ[A-Za-z0-9_-]{10,}/, /sbp_[A-Za-z0-9]{10,}/, /\b[a-z]{20}\.supabase\.co/, /service_role_key|sk_live_/i]) {
    assert.doesNotMatch(raw, re);
  }
  for (const m of raw.matchAll(/[\w.+-]+@[\w-]+\.([a-z]{2,})/gi)) assert.equal(m[1], 'test', m[0]);
  const body = strip(raw);
  assert.match(body, /^\s*BEGIN;/);
  assert.match(body, /ROLLBACK;\s*$/);
  assert.doesNotMatch(body, /\bCOMMIT\b/i);
  assert.doesNotMatch(body, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i);
  assert.match(body, /SELECT 'LAB-325 journaux OK' AS resultat;/);
  for (const m of body.matchAll(/RAISE EXCEPTION '([^']*)/g)) assert.match(m[1], /^LAB-325 KO : /, m[1]);
  // La purge vérifiée est la commande réelle de la tâche, pas une copie.
  assert.match(body, /SELECT command INTO cmd FROM cron\.job WHERE jobname = 'purge-kiosk-logs';\s+EXECUTE cmd;/);
});
