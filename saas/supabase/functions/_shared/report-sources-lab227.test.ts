// LAB-227 (spec LAB-209, SUPA-1) : sources fiables du rapport d'événement. Contrôles statiques de
// la migration, du script de vérification dev et du front.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261128000000_report_reliable_sources.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const raw = readPrivateHistory(new URL(MIGRATION, DIR));
const sql = strip(raw);
const one = flat(sql);
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const later = () => all.filter((m) => m > MIGRATION).map((m) => [m, strip(readFileSync(new URL(m, DIR), 'utf8'))] as const);
const src = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
const check = readPrivateHistory(new URL('../../tests/lab227_report_sources_check.sql', import.meta.url));

/** Corps d'une fonction créée par la migration (entre AS $$ et $$;). */
function body(name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(i >= 0, name);
  const start = sql.indexOf('AS $$', i);
  return sql.slice(i, sql.indexOf('$$;', start + 5));
}

test('migration : horodatage unique, après la dernière connue, SQL sans accent', { skip: PRIVATE_HISTORY }, () => {
  const stamps = all.map((f) => f.slice(0, 14));
  assert.equal(stamps.filter((s) => s === '20261128000000').length, 1);
  assert.equal(new Set(stamps).size, stamps.length, 'horodatages uniques');
  const before = all.filter((f) => f < MIGRATION);
  assert.ok(before.at(-1)!.startsWith('20261127000000'), before.at(-1));
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/);
});

test('migration : anciennes signatures supprimées avec leurs types exacts, une seule création par RPC', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT, TEXT\);/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.kiosk_heartbeat\(text, text, text, text, text\);/);
  for (const fn of ['kiosk_record_photo', 'kiosk_heartbeat', 'kiosk_record_print', 'track_gallery_event']) {
    assert.equal((sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`, 'g')) ?? []).length, 1, fn);
  }
  // DROP avant CREATE (sinon CREATE OR REPLACE ajouterait une surcharge).
  assert.ok(sql.indexOf('DROP FUNCTION IF EXISTS public.kiosk_record_photo(') < sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_record_photo('));
  assert.ok(sql.indexOf('DROP FUNCTION IF EXISTS public.kiosk_heartbeat(') < sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_heartbeat('));
  for (const fn of ['kiosk_record_photo', 'kiosk_heartbeat', 'kiosk_record_print', 'track_gallery_event']) {
    const b = body(fn);
    assert.match(b, /SECURITY DEFINER/, fn);
    assert.match(b, /SET search_path = public, pg_temp/, fn);
  }
});

test('captured_at : colonne, paramètre DEFAULT NULL, bornes, droits inchangés', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ALTER TABLE public\.photos ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;/);
  const b = flat(body('kiosk_record_photo'));
  assert.match(b, /p_secret TEXT, p_captured_at TIMESTAMPTZ DEFAULT NULL\) RETURNS UUID/);
  assert.match(b, /p_captured_at >= COALESCE\(e\.start_date, e\.created_at\) - INTERVAL '1 day'/);
  assert.match(b, /p_captured_at <= now\(\) \+ INTERVAL '1 hour'/);
  assert.match(b, /INSERT INTO public\.photos \(event_id, photo_url, storage_path, source, status, captured_at\)/);
  assert.match(b, /ON CONFLICT \(storage_path\) WHERE storage_path IS NOT NULL DO NOTHING/);
  // Contrôles hérités de 20261121000000.
  for (const m of ['licence kiosk invalide ou inactive', 'evenement introuvable ou cloture', 'chemin de photo invalide', 'URL de photo invalide', 'chemin de photo deja utilise']) {
    assert.ok(b.includes(m), m);
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ\) TO anon, service_role;/);
});

test('kiosk_record_print : signature exacte (contrat LAB-230), idempotente, codes d\'erreur LAB-223', { skip: PRIVATE_HISTORY }, () => {
  const b = flat(body('kiosk_record_print'));
  assert.match(b, /^CREATE OR REPLACE FUNCTION public\.kiosk_record_print\( p_code TEXT, p_event_id UUID, p_id UUID, p_session_id UUID, p_copies INT, p_printed_at TIMESTAMPTZ, p_machine_id TEXT, p_secret TEXT\) RETURNS BOOLEAN/);
  assert.doesNotMatch(b, /DEFAULT/);
  assert.match(b, /ON CONFLICT \(id\) DO NOTHING;/);
  assert.match(b, /RETURN true;/);
  assert.match(b, /COALESCE\(p_printed_at, now\(\)\)/);
  assert.doesNotMatch(b, /composite_url/, 'aucune URL écrite pour la borne');
  assert.doesNotMatch(b, /status/, 'tout statut accepté (file offline)');
  // Identification (P0001 par défaut) : licence, puis code d'accès.
  assert.match(b, /RAISE EXCEPTION 'kiosk_record_print : licence kiosk invalide ou inactive';/);
  assert.match(b, /RAISE EXCEPTION 'kiosk_record_print : code d''acces invalide';/);
  // Refus définitifs : 22023.
  for (const m of ['impression invalide', 'evenement introuvable', "id d''impression deja utilise"]) {
    assert.ok(b.includes(`RAISE EXCEPTION 'kiosk_record_print : ${m}' USING ERRCODE = '22023';`), m);
  }
  assert.match(b, /p_copies < 1 OR p_copies > 20/);
  assert.ok(b.indexOf('licence kiosk') < b.indexOf('impression invalide'), 'licence vérifiée en premier');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.kiosk_record_print\(TEXT, UUID, UUID, UUID, INT, TIMESTAMPTZ, TEXT, TEXT\) FROM PUBLIC, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_record_print\(TEXT, UUID, UUID, UUID, INT, TIMESTAMPTZ, TEXT, TEXT\) TO anon;/);
});

test('kiosk_heartbeat : p_pending_uploads DEFAULT NULL, jamais de 0 inventé, droits inchangés', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pending_uploads\s+INT,/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pending_uploads_at TIMESTAMPTZ;/);
  const b = flat(body('kiosk_heartbeat'));
  assert.match(b, /p_printer_name text, p_pending_uploads int DEFAULT NULL\) RETURNS void/);
  assert.match(b, /pending_uploads = CASE WHEN p_pending_uploads IS NULL THEN NULL ELSE GREATEST\(p_pending_uploads, 0\) END/);
  assert.match(b, /AND secret <> '' AND secret = p_secret/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.kiosk_heartbeat\(text, text, text, text, text, int\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_heartbeat\(text, text, text, text, text, int\) TO anon;/);
});

test('print_logs et gallery_analytics : plus aucun INSERT direct (policies et droits)', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DROP POLICY IF EXISTS "anon_insert_print_logs" ON public\.print_logs;/);
  assert.match(sql, /DROP POLICY IF EXISTS "anon_insert_gallery_analytics" ON public\.gallery_analytics;/);
  assert.match(sql, /DROP POLICY IF EXISTS gallery_analytics_owner_insert ON public\.gallery_analytics;/);
  assert.match(sql, /REVOKE INSERT ON public\.print_logs FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /REVOKE INSERT ON public\.gallery_analytics FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(one, /CREATE POLICY [^;]* FOR (INSERT|ALL)/);
  assert.doesNotMatch(one, /GRANT [^;]*INSERT[^;]* ON public\.(print_logs|gallery_analytics)/);
  // Aucune migration plus récente ne les rouvre.
  for (const [f, s] of later()) {
    assert.doesNotMatch(flat(s), /GRANT [^;]*INSERT[^;]* ON public\.(print_logs|gallery_analytics) TO (anon|authenticated)/, f);
  }
});

test('event_activity : aucune donnée personnelle, lecture propriétaire seule, écriture service_role', { skip: PRIVATE_HISTORY }, () => {
  const def = one.slice(one.indexOf('CREATE TABLE IF NOT EXISTS public.event_activity'), one.indexOf(');', one.indexOf('CREATE TABLE IF NOT EXISTS public.event_activity')));
  const cols = def.slice(def.indexOf('(') + 1).split(',').map((c) => c.trim().split(' ')[0]).filter((c) => /^[a-z_]+$/.test(c));
  assert.deepEqual(cols, ['id', 'event_id', 'kind', 'photo_id', 'created_at'], 'ni adresse, ni IP, ni identifiant d\'invité');
  assert.match(def, /kind TEXT NOT NULL CHECK \(kind IN \('kiosk_email', 'qr_open'\)\)/);
  assert.match(def, /event_id UUID NOT NULL REFERENCES public\.events\(id\) ON DELETE CASCADE/);
  assert.match(sql, /ALTER TABLE public\.event_activity ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.event_activity FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT ON public\.event_activity TO authenticated;/);
  assert.match(sql, /GRANT ALL ON public\.event_activity TO service_role;/);
  assert.match(one, /CREATE POLICY event_activity_owner_select ON public\.event_activity FOR SELECT TO authenticated USING \( EXISTS \(/);
  assert.match(one, /o\.owner_id = auth\.uid\(\)/);
  // Pas d'écriture LAB-232 ici.
  assert.doesNotMatch(one, /INSERT INTO public\.event_activity/);
});

test('track_gallery_event : contrôles avant le code, garde anti-énumération, bornes, droits', { skip: PRIVATE_HISTORY }, () => {
  const b = flat(body('track_gallery_event'));
  assert.match(b, /^CREATE OR REPLACE FUNCTION public\.track_gallery_event\(p_code TEXT, p_type TEXT, p_count INT\) RETURNS void/);
  assert.match(b, /p_type NOT IN \('view', 'download', 'download_all', 'download_selection', 'share'\)/);
  assert.match(b, /USING ERRCODE = '22023'/);
  assert.ok(b.indexOf("ERRCODE = '22023'") < b.indexOf('rpc_code_guard()'), 'erreur de format avant la recherche du code');
  assert.match(b, /v_bucket := public\.rpc_code_guard\(\);/);
  assert.match(b, /PERFORM public\.rpc_code_failed\(v_bucket\);/);
  assert.match(b, /e\.access_code = UPPER\(TRIM\(p_code\)\) AND e\.status IN \('active', 'submitted'\)/);
  assert.match(b, /p\.status = 'approved'/);
  assert.match(b, /INSERT INTO public\.gallery_analytics \(event_id, type, count\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.track_gallery_event\(TEXT, TEXT, INT\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.track_gallery_event\(TEXT, TEXT, INT\) TO anon, authenticated;/);
});

test('front : galerie par la RPC, plus d\'INSERT direct ; aucune notion LAB-232', () => {
  const lib = src('lib/api/photos.js');
  const allApi = readdirSync(new URL('../../../src/lib/api/', import.meta.url)).map((f) => src(`lib/api/${f}`)).join('\n');
  assert.doesNotMatch(allApi, /\.from\('gallery_analytics'\)\s*\.insert/);
  assert.doesNotMatch(allApi, /\.from\('print_logs'\)\s*\.insert/);
  assert.match(lib, /supabase\.rpc\('track_gallery_event', \{ p_code: code, p_type: type, p_count: count \}\)/);
  assert.doesNotMatch(allApi, /\bp_via\b|event_activity/);
  const gallery = src('pages/PhotoGallery.jsx');
  const calls = [...gallery.matchAll(/trackGalleryEvent\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 4, calls.join(','));
  for (const c of calls) assert.equal(c, 'code', `trackGalleryEvent(${c}, …)`);
});

test('script de vérification dev : transaction annulée, contrôles des critères', { skip: PRIVATE_HISTORY }, () => {
  assert.match(check, /^BEGIN;$/m);
  assert.match(check, /ROLLBACK;\s*$/);
  assert.doesNotMatch(strip(check), /\bCOMMIT\b/i);
  assert.match(check, /SELECT 'LAB-227 OK' AS result;/);
  assert.match(check, /INSERT anon accepté sur print_logs/);
  assert.match(check, /INSERT anon accepté sur gallery_analytics/);
  assert.match(check, /impression comptée % fois/);
  assert.match(check, /interval '21 hours 10 minutes'/);
  assert.match(check, /pending_uploads inventé/);
  assert.doesNotMatch(check, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i, 'aucun identifiant réel');
});

test('saas/CLAUDE.md documente LAB-227', { skip: PRIVATE_HISTORY }, () => {
  const doc = readFileSync(new URL('../../../CLAUDE.md', import.meta.url), 'utf8');
  assert.match(doc, /LAB-227/);
  assert.match(doc, /kiosk_record_print/);
  assert.match(doc, /track_gallery_event/);
  assert.match(doc, /event_activity/);
  assert.match(doc, /captured_at/);
  assert.match(doc, /pending_uploads/);
});
