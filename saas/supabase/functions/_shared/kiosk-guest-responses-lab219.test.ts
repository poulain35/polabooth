// LAB-219 : réponses au questionnaire de la borne (kiosk_guest_responses), écriture par RPC à secret
// machine, suppression 30 jours après la fin de l'événement. Contrôles statiques de la migration,
// du script de vérification SQL (lancé en dev), de la surveillance des crons et de la doc.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261125000000_kiosk_guest_responses.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
const raw = readPrivateHistory(new URL(MIGRATION, DIR));
const sql = strip(raw);
const check = readPrivateHistory(new URL('../../tests/lab219_kiosk_guest_responses_check.sql', import.meta.url));
const cronEmail = readFileSync(new URL('../check-cron-alerts/email.ts', import.meta.url), 'utf8');
const saasDoc = readPrivateHistory(new URL('../../../CLAUDE.md', import.meta.url));

const RPC_SIG = 'text, uuid, text, text, uuid, timestamptz, jsonb, jsonb, boolean, text, text, uuid[]';
const fnBody = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};
const policy = (name: string) => {
  const m = new RegExp(`CREATE POLICY ${name}[^;]*;`).exec(sql);
  assert.ok(m, `${name} introuvable`);
  return flat(m[0]);
};

test('migration : postérieure à 20261124000000, timestamp unique dans le dossier', { skip: PRIVATE_HISTORY }, () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(all.indexOf(MIGRATION) > all.findIndex((f) => f.startsWith('20261124000000_')));
  assert.equal(all.filter((f) => f.startsWith('20261125000000')).length, 1);
});

test('table : RLS active, anon sans aucun droit, authenticated limité à SELECT et DELETE', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.kiosk_guest_responses \(\s+id\s+uuid PRIMARY KEY,/);
  assert.match(sql, /event_id\s+uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE CASCADE/);
  assert.match(sql, /marketing_consent\s+boolean NOT NULL DEFAULT false/);
  assert.match(sql, /ALTER TABLE public\.kiosk_guest_responses ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.kiosk_guest_responses FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT, DELETE ON public\.kiosk_guest_responses TO authenticated;/);
  for (const m of sql.matchAll(/GRANT [^;]* ON public\.kiosk_guest_responses TO ([^;]+);/g)) {
    assert.doesNotMatch(m[1], /anon/, m[0]);
  }
});

test('RLS : seulement SELECT et DELETE, réservés au propriétaire de l\'organisation de l\'événement', { skip: PRIVATE_HISTORY }, () => {
  const policies = [...sql.matchAll(/CREATE POLICY (\S+)\s+ON public\.kiosk_guest_responses FOR (\w+) TO (\w+)/g)]
    .map((m) => `${m[1]}:${m[2]}:${m[3]}`);
  assert.deepEqual(policies, [
    'kiosk_guest_responses_owner_select:SELECT:authenticated',
    'kiosk_guest_responses_owner_delete:DELETE:authenticated',
  ]);
  for (const name of ['kiosk_guest_responses_owner_select', 'kiosk_guest_responses_owner_delete']) {
    const p = policy(name);
    assert.match(p, /ev\.id = kiosk_guest_responses\.event_id/, name);
    assert.match(p, /SELECT o\.id FROM public\.organizations o WHERE o\.owner_id = auth\.uid\(\)/, name);
    assert.doesNotMatch(p, /USING \(true\)/, name);
  }
});

test('colonne events.guest_responses_exported_at, sans effet sur les RPC kiosk existantes', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ALTER TABLE public\.events\s+ADD COLUMN IF NOT EXISTS guest_responses_exported_at timestamptz;/);
  assert.doesNotMatch(sql, /FUNCTION public\.kiosk_get_event\(/);
});

test('conservation : constante unique (30 jours) dans guest_responses_purge_at, appelée partout', { skip: PRIVATE_HISTORY }, () => {
  assert.equal(sql.match(/30 days/g)?.length, 1);
  const body = fnBody('guest_responses_purge_at');
  assert.match(body, /coalesce\(p_end_date, p_start_date, p_answered_at\) \+ interval '30 days'/);
  assert.match(body, /LANGUAGE sql\s+STABLE/);
  assert.doesNotMatch(body, /SECURITY DEFINER/);
  assert.match(fnBody('kiosk_record_guest_response'), /public\.guest_responses_purge_at\(v_end_date, v_start_date, p_answered_at\) < now\(\)/);
  assert.match(fnBody('guest_responses_summary'), /public\.guest_responses_purge_at\(e\.end_date, e\.start_date, min\(r\.answered_at\)\)/);
  assert.match(sql, /public\.guest_responses_purge_at\(e\.end_date, e\.start_date, r\.answered_at\) < now\(\)\s+\$\$\s*\);/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guest_responses_purge_at\(timestamptz, timestamptz, timestamptz\)\s+FROM PUBLIC, anon;/);
});

test('résumé : SECURITY INVOKER (RLS appliquée), interdit à anon', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('guest_responses_summary');
  assert.match(body, /SECURITY INVOKER/);
  assert.match(body, /SET search_path = public, pg_temp/);
  assert.match(body, /count\(\*\) FILTER \(WHERE r\.marketing_consent\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guest_responses_summary\(\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.guest_responses_summary\(\) TO authenticated, service_role;/);
});

test('RPC kiosk : secret machine vérifié avant tout, comme kiosk_record_photo (LAB-197)', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('kiosk_record_guest_response');
  assert.match(body, /SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  assert.match(body, /l\.is_active\s+AND l\.secret <> ''\s+AND l\.secret = p_secret/);
  assert.doesNotMatch(body, /secret IS NULL/);
  assert.match(body, /RAISE EXCEPTION 'kiosk_record_guest_response : licence kiosk invalide ou inactive'/);
  assert.ok(body.indexOf('p_secret') < body.indexOf('FROM public.events'), 'licence vérifiée avant l\'événement');
  assert.match(body, /e\.access_code = UPPER\(TRIM\(p_code\)\)/);
  const grants = flat(sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION public.kiosk_record_guest_response(')));
  assert.ok(grants.startsWith(`REVOKE ALL ON FUNCTION public.kiosk_record_guest_response(${RPC_SIG}) FROM PUBLIC, authenticated;`));
  assert.match(grants, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.kiosk_record_guest_response\\(${RPC_SIG.replace(/[[\]()]/g, '\\$&')}\\) TO anon, service_role;`));
});

test('RPC kiosk : idempotente, arrivée tardive ignorée sans erreur, entrées bornées', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('kiosk_record_guest_response');
  assert.match(body, /ON CONFLICT \(id\) DO NOTHING;\s+RETURN p_response_id;/);
  const late = body.indexOf('guest_responses_purge_at(');
  assert.ok(late > 0 && late < body.indexOf('INSERT INTO public.kiosk_guest_responses'), 'date vérifiée avant l\'insertion');
  assert.match(body.slice(late, late + 200), /< now\(\) THEN\s+RETURN p_response_id;/);
  assert.match(body, /p_answered_at > now\(\) \+ interval '5 minutes'/);
  assert.match(body, /jsonb_typeof\(p_answers\) <> 'object'/);
  assert.match(body, /jsonb_typeof\(v_questions\) <> 'array'/);
  assert.match(body, /octet_length\(p_answers::text\) > 16384/);
  assert.match(body, /USING ERRCODE = '22023'/);
  // Les fonctions qui lèvent une erreur sur un mauvais type ne sont appelées qu'après la vérification du type.
  assert.ok(body.indexOf('jsonb_object_keys(p_answers)') > body.indexOf("jsonb_typeof(p_answers) <> 'object'"));
  assert.match(body, /left\(v_val #>> '\{\}', 500\)/);
  assert.match(body, /lower\(trim\(v_answers ->> \(q ->> 'id'\)\)\) INTO v_email/);
});

test('cron purge-kiosk-guest-responses : SQL pur, quotidien, rejouable', { skip: PRIVATE_HISTORY }, () => {
  const unschedule = sql.indexOf("cron.unschedule('purge-kiosk-guest-responses')");
  const schedule = sql.search(/cron\.schedule\(\s+'purge-kiosk-guest-responses',\s+'15 3 \* \* \*',/);
  assert.ok(unschedule > 0 && schedule > unschedule);
  const job = sql.slice(schedule);
  assert.match(job, /DELETE FROM public\.kiosk_guest_responses r\s+USING public\.events e\s+WHERE e\.id = r\.event_id/);
  assert.doesNotMatch(sql, /net\.http_post|vault\.|cron_http_post/);
});

test('surveillance : impact métier de purge-kiosk-guest-responses dans l\'alerte cron', () => {
  assert.match(cronEmail, /'purge-kiosk-guest-responses': '[^']*questionnaire de la borne[^']*'/);
});

test('script de vérification dev : transaction annulée, rôles anon / inconnu / propriétaire, pas de secret', { skip: PRIVATE_HISTORY }, () => {
  assert.match(check, /^BEGIN;$/m);
  assert.match(check, /^ROLLBACK;\s*$/m);
  assert.doesNotMatch(check, /^COMMIT;/m);
  for (const role of ['SET LOCAL ROLE anon;', 'SET LOCAL ROLE authenticated;']) assert.ok(check.includes(role), role);
  assert.match(check, /'ks_' \|\| md5\(gen_random_uuid\(\)::text\)/);
  assert.match(check, /SELECT command INTO cmd FROM cron\.job WHERE jobname = 'purge-kiosk-guest-responses';\s+EXECUTE cmd;/);
  assert.doesNotMatch(check, /eyJ[A-Za-z0-9_-]{10,}|sbp_[A-Za-z0-9]{10,}|\b[a-z]{20}\.supabase\.co/);
  for (const m of check.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi)) {
    assert.match(m[0], /@example\.com$/i, m[0]);
  }
});

test('doc : table et RPC décrites dans saas/CLAUDE.md', { skip: PRIVATE_HISTORY }, () => {
  assert.match(saasDoc, /kiosk_guest_responses/);
  assert.match(saasDoc, /kiosk_record_guest_response/);
  assert.match(saasDoc, /purge-kiosk-guest-responses/);
});
