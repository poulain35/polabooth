// LAB-223 : consentement photo de la borne (kiosk_photo_consents), écriture par RPC à secret machine,
// suppression avec les photos de l'événement, nettoyage des lignes rgpd_consent d'event_form_responses.
// Contrôles statiques de la migration, du script de vérification SQL (lancé en dev), de la
// surveillance des crons, du filtre LAB-217 conservé et de la doc.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261126000000_kiosk_photo_consent.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
const raw = readPrivateHistory(new URL(MIGRATION, DIR));
const sql = strip(raw);
const check = readPrivateHistory(new URL('../../tests/lab223_kiosk_photo_consents_check.sql', import.meta.url));
const cronEmail = readFileSync(new URL('../check-cron-alerts/email.ts', import.meta.url), 'utf8');
const getEvent = readFileSync(new URL('../get-event/index.ts', import.meta.url), 'utf8');
const formResponses = readFileSync(new URL('../../../src/lib/formResponses.js', import.meta.url), 'utf8');
const saasDoc = readPrivateHistory(new URL('../../../CLAUDE.md', import.meta.url));
const kioskDoc = readPrivateHistory(new URL('../../../../kiosk/CLAUDE.md', import.meta.url));

const RPC_SIG = 'text, uuid, text, text, uuid, uuid, timestamptz, text';
const fnBody = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('migration : postérieure à 20261125000000, timestamp unique dans le dossier', { skip: PRIVATE_HISTORY }, () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(all.indexOf(MIGRATION) > all.indexOf('20261125000000_kiosk_guest_responses.sql'));
  assert.equal(all.filter((f) => f.startsWith('20261126000000')).length, 1);
});

test('table : liée à la séance, RLS active, anon sans aucun droit, authenticated limité à SELECT', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.kiosk_photo_consents \(\s+id\s+uuid PRIMARY KEY,/);
  assert.match(sql, /event_id\s+uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE CASCADE/);
  assert.match(sql, /session_id\s+uuid NOT NULL/);
  assert.match(sql, /consented_at\s+timestamptz NOT NULL/);
  assert.doesNotMatch(sql, /email|phone|guest_name/i, 'aucune donnée personnelle');
  assert.match(sql, /ALTER TABLE public\.kiosk_photo_consents ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.kiosk_photo_consents FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT ON public\.kiosk_photo_consents TO authenticated;/);
  for (const m of sql.matchAll(/GRANT [^;]* ON public\.kiosk_photo_consents TO ([^;]+);/g)) {
    assert.doesNotMatch(m[1], /anon/, m[0]);
  }
});

test('RLS : une seule policy, SELECT réservé aux administrateurs de l\'application', { skip: PRIVATE_HISTORY }, () => {
  const policies = [...sql.matchAll(/CREATE POLICY (\S+)\s+ON public\.kiosk_photo_consents FOR (\w+) TO (\w+)/g)]
    .map((m) => `${m[1]}:${m[2]}:${m[3]}`);
  assert.deepEqual(policies, ['kiosk_photo_consents_admin_select:SELECT:authenticated']);
  const m = /CREATE POLICY kiosk_photo_consents_admin_select[^;]*;/.exec(sql);
  assert.ok(m);
  assert.match(flat(m[0]), /USING \(public\.is_app_admin\(\)\)/);
});

test('conservation : constante unique (30 jours après l\'expiration des photos) dans photo_consents_purge_at', { skip: PRIVATE_HISTORY }, () => {
  assert.equal(sql.match(/30 days/g)?.length, 1);
  const body = fnBody('photo_consents_purge_at');
  assert.match(body, /SELECT p_expires_at \+ interval '30 days';/);
  assert.match(body, /LANGUAGE sql\s+STABLE\s+SET search_path = public, pg_temp/);
  assert.doesNotMatch(body, /SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.photo_consents_purge_at\(timestamptz\) FROM PUBLIC, anon;/);
  assert.match(fnBody('kiosk_record_photo_consent'), /IF public\.photo_consents_purge_at\(v_expires_at\) < now\(\) THEN\s+RETURN p_consent_id;/);
  assert.match(sql, /public\.photo_consents_purge_at\(e\.expires_at\) < now\(\)\s+\$\$\s*\);/);
});

test('RPC kiosk : secret machine vérifié avant tout, comme kiosk_record_guest_response (LAB-219)', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('kiosk_record_photo_consent');
  assert.match(body, /SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  assert.match(body, /l\.is_active\s+AND l\.secret <> ''\s+AND l\.secret = p_secret/);
  assert.doesNotMatch(body, /secret IS NULL/);
  assert.match(body, /RAISE EXCEPTION 'kiosk_record_photo_consent : licence kiosk invalide ou inactive'/);
  assert.ok(body.indexOf('p_secret') < body.indexOf('FROM public.events'), 'licence vérifiée avant l\'événement');
  assert.match(body, /e\.access_code = UPPER\(TRIM\(p_code\)\)/);
  const grants = flat(sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION public.kiosk_record_photo_consent(')));
  assert.ok(grants.startsWith(`REVOKE ALL ON FUNCTION public.kiosk_record_photo_consent(${RPC_SIG}) FROM PUBLIC, authenticated;`));
  assert.match(grants, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.kiosk_record_photo_consent\\(${RPC_SIG}\\) TO anon, service_role;`));
});

test('RPC kiosk : idempotente sur l\'id de la borne, arrivée tardive ignorée sans erreur, entrées bornées', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('kiosk_record_photo_consent');
  assert.match(body, /ON CONFLICT \(id\) DO NOTHING;\s+RETURN p_consent_id;/);
  const late = body.indexOf('photo_consents_purge_at(');
  assert.ok(late > 0 && late < body.indexOf('INSERT INTO public.kiosk_photo_consents'), 'date vérifiée avant l\'insertion');
  assert.match(body, /p_session_id IS NULL/);
  assert.match(body, /p_consented_at > now\(\) \+ interval '5 minutes'/);
  assert.match(body, /USING ERRCODE = '22023'/);
  assert.match(body, /left\(coalesce\(p_consent_text, ''\), 1000\)/);
});

test('cron purge-kiosk-photo-consents : SQL pur, quotidien, rejouable', { skip: PRIVATE_HISTORY }, () => {
  const unschedule = sql.indexOf("cron.unschedule('purge-kiosk-photo-consents')");
  const schedule = sql.search(/cron\.schedule\(\s+'purge-kiosk-photo-consents',\s+'20 3 \* \* \*',/);
  assert.ok(unschedule > 0 && schedule > unschedule);
  assert.match(sql.slice(schedule), /DELETE FROM public\.kiosk_photo_consents c\s+USING public\.events e\s+WHERE e\.id = c\.event_id/);
  assert.doesNotMatch(sql, /net\.http_post|vault\.|cron_http_post/);
});

test('nettoyage : lignes rgpd_consent supprimées, droits et filtre LAB-217 d\'event_form_responses intacts', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DELETE FROM public\.event_form_responses WHERE answers->>'type' = 'rgpd_consent';/);
  assert.doesNotMatch(sql, /(GRANT|REVOKE|POLICY)[^;]*event_form_responses/);
  assert.match(getEvent, /answers->>type\.neq\.rgpd_consent/);
  assert.match(formResponses, /KIOSK_CONSENT_TYPE = 'rgpd_consent'/);
});

test('surveillance : impact métier de purge-kiosk-photo-consents dans l\'alerte cron', () => {
  assert.match(cronEmail, /'purge-kiosk-photo-consents': '[^']*consentements photo de la borne[^']*'/);
});

test('script de vérification dev : transaction annulée, rôles anon / inconnu / admin, pas de secret', { skip: PRIVATE_HISTORY }, () => {
  assert.match(check, /^BEGIN;$/m);
  assert.match(check, /^ROLLBACK;\s*$/m);
  assert.doesNotMatch(check, /^COMMIT;/m);
  for (const role of ['SET LOCAL ROLE anon;', 'SET LOCAL ROLE authenticated;']) assert.ok(check.includes(role), role);
  assert.match(check, /INSERT INTO public\.app_admins \(user_id\)/);
  assert.match(check, /'ks_' \|\| md5\(gen_random_uuid\(\)::text\)/);
  assert.match(check, /SELECT command INTO cmd FROM cron\.job WHERE jobname = 'purge-kiosk-photo-consents';\s+EXECUTE cmd;/);
  assert.match(check, /SELECT 'LAB-223 OK' AS resultat;/);
  assert.doesNotMatch(check, /eyJ[A-Za-z0-9_-]{10,}|sbp_[A-Za-z0-9]{10,}|\b[a-z]{20}\.supabase\.co/);
  assert.doesNotMatch(check, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i);
});

test('doc : table, RPC et cron décrits dans saas/CLAUDE.md et kiosk/CLAUDE.md', { skip: PRIVATE_HISTORY }, () => {
  for (const doc of [saasDoc, kioskDoc]) {
    assert.match(doc, /kiosk_photo_consents/);
    assert.match(doc, /kiosk_record_photo_consent/);
  }
  assert.match(saasDoc, /purge-kiosk-photo-consents/);
  assert.doesNotMatch(kioskDoc, /LogRgpdConsentAsync/);
});
