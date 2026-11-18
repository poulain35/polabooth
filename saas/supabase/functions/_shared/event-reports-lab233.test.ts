// LAB-233 (spec LAB-209, SUPA-2) : rapports d'événement figés. Contrôles statiques de la
// migration, du script de vérification dev et du front.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261201000000_event_reports.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const sql = strip(readPrivateHistory(new URL(MIGRATION, DIR)));
const one = flat(sql);
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const src = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
const check = readPrivateHistory(new URL('../../tests/lab233_event_reports_check.sql', import.meta.url));

/** Corps d'une fonction créée par la migration (entre AS $$ et $$;). */
function body(name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(i >= 0, name);
  const start = sql.indexOf('AS $$', i);
  return sql.slice(i, sql.indexOf('$$;', start + 5));
}

test('migration : horodatage réservé unique, SQL sans accent, rechargement du schéma', { skip: PRIVATE_HISTORY }, () => {
  const stamps = all.map((f) => f.slice(0, 14));
  assert.equal(stamps.filter((s) => s === '20261201000000').length, 1);
  assert.equal(new Set(stamps).size, stamps.length, 'horodatages uniques');
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/);
  // Indépendante de LAB-229 (photos.media_type pas encore livré).
  assert.doesNotMatch(sql, /media_type/);
});

test('event_reports : colonnes, jeton aléatoire, RLS, aucun droit anon, UPDATE limité', { skip: PRIVATE_HISTORY }, () => {
  const start = one.indexOf('CREATE TABLE IF NOT EXISTS public.event_reports');
  const def = one.slice(start, one.indexOf(');', one.indexOf('CHECK (cardinality', start)) + 2);
  assert.match(def, /event_id UUID NOT NULL UNIQUE REFERENCES public\.events\(id\) ON DELETE CASCADE/);
  assert.match(def, /token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid\(\)/);
  assert.match(def, /status TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'sent', 'revoked'\)\)/);
  assert.match(def, /metrics JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(def, /CHECK \(cardinality\(selected_photo_ids\) <= 6\)/);
  for (const c of ['frozen_at', 'sent_at', 'expires_at']) assert.match(one, new RegExp(`${c} TIMESTAMPTZ`), c);
  assert.match(sql, /ALTER TABLE public\.event_reports ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.event_reports FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT ON public\.event_reports TO authenticated;/);
  assert.match(sql, /GRANT UPDATE \(selected_photo_ids, status\) ON public\.event_reports TO authenticated;/);
  assert.doesNotMatch(one, /GRANT [^;]* ON public\.event_reports TO [^;]*anon/);
  assert.doesNotMatch(one, /GRANT [^;]*(INSERT|DELETE)[^;]* ON public\.event_reports TO authenticated/);
  assert.doesNotMatch(one, /CREATE POLICY [^;]* ON public\.event_reports FOR (INSERT|DELETE|ALL)/);
  assert.match(one, /CREATE POLICY event_reports_owner_select ON public\.event_reports FOR SELECT TO authenticated USING \( EXISTS \(/);
  assert.match(one, /CREATE POLICY event_reports_owner_update ON public\.event_reports FOR UPDATE TO authenticated USING \( EXISTS \(/);
  assert.match(one, /o\.owner_id = auth\.uid\(\)/);
  // Le propriétaire ne fait que révoquer : un gel passe par build_event_report.
  const g = flat(body('event_reports_guard_update'));
  assert.match(g, /current_user IN \('authenticated', 'anon'\)/);
  assert.match(g, /NOT \(OLD\.status = 'sent' AND NEW\.status = 'revoked'\)/);
  assert.match(one, /CREATE TRIGGER event_reports_guard_update BEFORE UPDATE ON public\.event_reports/);
});

test('réglage business_profile.event_report.default_for : trois valeurs, professionnel par défaut', { skip: PRIVATE_HISTORY }, () => {
  assert.match(one, /business_profile #>> '\{event_report,default_for\}' IN \('professionnel', 'tous', 'aucun'\)/);
  const b = flat(body('event_report_default_for'));
  assert.match(b, /IN \('tous', 'aucun'\)/);
  assert.match(b, /ELSE 'professionnel'/);
  const build = flat(body('build_event_report'));
  assert.match(build, /v_default_for = 'tous' OR \(v_default_for = 'professionnel' AND v_client_type IS NOT DISTINCT FROM 'professionnel'\)/);
});

test('fonctions internes : jamais appelables par l\'API', { skip: PRIVATE_HISTORY }, () => {
  for (const sig of ['event_report_default_for(JSONB)', 'event_report_metrics(UUID, JSONB)', 'event_report_kiosks(UUID)', 'event_report_payload(UUID)', 'event_reports_guard_update()']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`), sig);
    assert.doesNotMatch(one, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')}`), sig);
  }
  for (const fn of ['event_report_metrics', 'event_report_kiosks', 'event_report_payload']) {
    assert.doesNotMatch(body(fn), /SECURITY DEFINER/, fn);
  }
});

test('chiffres : sources LAB-227, nombres seulement, reprise après la purge', { skip: PRIVATE_HISTORY }, () => {
  const m = flat(body('event_report_metrics'));
  assert.match(m, /p\.source = 'kiosk'/);
  assert.match(m, /substring\(p\.storage_path FROM '\^photos\/\[\^\/\]\+\/\(\[0-9A-Fa-f-\]\{36\}\)\/'\)/);
  assert.match(m, /min\(p\.captured_at\)/);
  assert.match(m, /AT TIME ZONE 'Europe\/Paris'/);
  assert.match(m, /sum\(l\.copies\)/);
  assert.match(m, /count\(DISTINCT a\.photo_id\) FILTER \(WHERE a\.kind = 'qr_open'\)/);
  assert.match(m, /count\(\*\) FILTER \(WHERE a\.kind = 'kiosk_email'\)/);
  assert.match(m, /sum\(g\.count\) FILTER \(WHERE g\.type = 'view'\)/);
  assert.match(m, /g\.type IN \('download', 'download_all', 'download_selection'\)/);
  assert.match(m, /bool_or\(t\.duration_seconds IS NULL\) THEN NULL/);
  assert.match(m, /count\(\*\) FILTER \(WHERE r\.marketing_consent\)/);
  // Aucune colonne personnelle lue dans les réponses au questionnaire.
  assert.doesNotMatch(m, /r\.(email|phone|answers|consent_text|questions_snapshot)/);
  // Sources purgées : chiffres du rapport figé repris.
  assert.match(m, /v_media_gone := v_event\.media_purged_at IS NOT NULL OR COALESCE\(v_event\.expires_at \+ INTERVAL '30 days' <= now\(\), false\)/);
  assert.match(m, /public\.guest_responses_purge_at\(v_event\.end_date, v_event\.start_date, v_event\.created_at\) <= now\(\)/);
  assert.match(m, /IF v_media_gone AND v_prev \? 'sessions' THEN/);
  assert.match(m, /IF v_media_gone AND v_prev \? 'audio' THEN/);
  assert.match(m, /IF v_guest_gone AND v_prev \? 'questionnaire' THEN/);
  const build = flat(body('build_event_report'));
  assert.match(build, /CASE WHEN v_report\.frozen_at IS NOT NULL THEN v_report\.metrics END/);
});

test('build_event_report : propriétaire seulement, erreurs, blocages, gel à 12 mois', { skip: PRIVATE_HISTORY }, () => {
  const b = flat(body('build_event_report'));
  assert.match(b, /^CREATE OR REPLACE FUNCTION public\.build_event_report\(p_event_id UUID, p_freeze BOOLEAN DEFAULT false\) RETURNS JSONB/);
  assert.match(b, /SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(b, /v_uid UUID := auth\.uid\(\)/);
  assert.match(b, /AND v_uid IS NOT NULL AND o\.owner_id = v_uid/);
  assert.match(b, /RAISE EXCEPTION 'build_event_report : evenement introuvable' USING ERRCODE = '42501';/);
  assert.match(b, /RAISE EXCEPTION 'build_event_report : rien a presenter pour cet evenement' USING ERRCODE = '22023';/);
  assert.match(b, /RAISE EXCEPTION 'build_event_report : envoi bloque \(%\)', array_to_string\(v_blockers, ', '\) USING ERRCODE = 'P0001';/);
  for (const code of ['kiosk_pending', 'kiosk_unknown', 'kiosk_not_seen', 'kiosk_unidentified', 'no_client_email']) {
    assert.ok(b.includes(`array_append(v_blockers, '${code}')`), code);
  }
  assert.ok(b.indexOf('evenement introuvable') < b.indexOf('INSERT INTO public.event_reports'), 'contrôle du propriétaire avant toute écriture');
  assert.match(b, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(b, /FOR UPDATE/);
  assert.match(b, /expires_at = now\(\) \+ INTERVAL '12 months'/);
  assert.match(b, /token = CASE WHEN r\.status = 'revoked' THEN gen_random_uuid\(\) ELSE r\.token END/);
  assert.match(b, /ELSIF v_report\.status = 'draft' THEN/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.build_event_report\(UUID, BOOLEAN\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.build_event_report\(UUID, BOOLEAN\) TO authenticated;/);
  assert.doesNotMatch(one, /GRANT EXECUTE ON FUNCTION public\.build_event_report\([^)]*\) TO [^;]*anon/);
});

test('get_event_report : garde anti-énumération, jeton contrôlé, envoyé et non expiré', { skip: PRIVATE_HISTORY }, () => {
  const b = flat(body('get_event_report'));
  assert.match(b, /^CREATE OR REPLACE FUNCTION public\.get_event_report\(p_token TEXT\) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(b, /v_bucket TEXT := public\.rpc_code_guard\(\);/);
  assert.match(b, /PERFORM public\.rpc_code_failed\(v_bucket\);/);
  assert.match(b, /~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'/);
  assert.match(b, /r\.status = 'sent' AND r\.frozen_at IS NOT NULL AND r\.expires_at > now\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_event_report\(TEXT\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_event_report\(TEXT\) TO anon, authenticated;/);
});

test('contenu public : champs autorisés seulement, aucune donnée d\'invite ni du client', { skip: PRIVATE_HISTORY }, () => {
  const p = flat(body('event_report_payload'));
  const keys = [...p.matchAll(/'([a-z_]+)',\s+(?=[a-zA-Z(])/g)].map((k) => k[1]).filter((k) => !['id', 'url', 'thumbnail_url'].includes(k));
  assert.deepEqual(keys, ['name', 'start_date', 'end_date', 'company', 'frozen_at', 'expires_at', 'metrics', 'photos',
    'gallery_online', 'audio_online', 'access_code', 'review_url', 'client_type', 'event_type']);
  assert.doesNotMatch(p, /client_email|client_name|client_phone|kiosk_guest_responses|machine_id|token/);
  assert.match(p, /p\.status = 'approved'/);
  assert.match(p, /p\.event_id = r\.event_id/);
  assert.match(p, /WITH ORDINALITY/);
  assert.match(p, /'\^https:\/\/\[\^\[:space:\]\]\+\$'/);
});

test('front : appels RPC sans calcul côté navigateur, aucune notion LAB-227 / LAB-232', () => {
  const lib = src('lib/api/eventReports.js');
  const allApi = readdirSync(new URL('../../../src/lib/api/', import.meta.url)).map((f) => src(`lib/api/${f}`)).join('\n');
  assert.match(lib, /supabase\.rpc\('build_event_report', \{ p_event_id: eventId \}\)/);
  assert.match(lib, /supabase\.rpc\('get_event_report', \{ p_token: token \}\)/);
  assert.match(lib, /\.update\(\{ selected_photo_ids: photoIds \}\)/);
  assert.match(lib, /\.update\(\{ status: 'revoked' \}\)/);
  assert.doesNotMatch(allApi, /\.from\('event_reports'\)\s*\.insert/);
  assert.doesNotMatch(allApi, /p_freeze/, 'le gel passe par l\'envoi (LAB-238)');
});

test('script de vérification dev : transaction annulée, trois critères contrôlés', { skip: PRIVATE_HISTORY }, () => {
  assert.match(check, /^BEGIN;$/m);
  assert.match(check, /ROLLBACK;\s*$/);
  assert.doesNotMatch(strip(check), /\bCOMMIT\b/i);
  assert.match(check, /SELECT 'LAB-233 OK' AS result;/);
  assert.match(check, /jeton inconnu ou mal formé accepté/);
  assert.match(check, /rapport révoqué encore lisible/);
  assert.match(check, /rapport expiré encore lisible/);
  assert.match(check, /donnée personnelle ou interne dans get_event_report/);
  assert.match(check, /chiffres changés après la purge/);
  assert.match(check, /nouveau gel après la purge a changé les chiffres/);
  assert.doesNotMatch(check, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i, 'aucun identifiant réel');
});

test('saas/CLAUDE.md documente LAB-233', { skip: PRIVATE_HISTORY }, () => {
  const doc = readFileSync(new URL('../../../CLAUDE.md', import.meta.url), 'utf8');
  assert.match(doc, /LAB-233/);
  assert.match(doc, /event_reports/);
  assert.match(doc, /build_event_report/);
  assert.match(doc, /get_event_report/);
  assert.match(doc, /default_for/);
});
