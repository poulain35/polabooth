// LAB-112 : la clé anon ne lit plus la table events (codes d'accès, coordonnées clients).
// Lectures par code via RPC SECURITY DEFINER, policy events_anon_read supprimée en dernière étape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const RPC = '20261103000000_events_public_rpc.sql';
const TRANSITION = '20261103000001_events_anon_column_restriction.sql';
const FINAL = '20261103000002_events_drop_anon_read.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const read = (f: string) => strip(readFileSync(new URL(f, DIR), 'utf8'));
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const fnBody = (sql: string, name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

const SENSITIVE = ['client_name', 'client_email', 'total_amount', 'deposit_amount', 'balance_amount',
  'invoice_url', 'delivery_attachment_url', 'delivery_links', 'pennylane_quote_id', 'gcal_event_id'];

test('ordre : RPC, puis transition, puis suppression, après les dernières migrations existantes', { skip: PRIVATE_HISTORY }, () => {
  const i = [RPC, TRANSITION, FINAL].map((f) => all.indexOf(f));
  assert.ok(i.every((x) => x >= 0), 'migrations LAB-112 présentes');
  assert.deepEqual([...i].sort((a, b) => a - b), i);
  assert.ok(RPC > '20261102000000_pennylane_mock.sql');
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('RPC : SECURITY DEFINER, search_path fixé, filtrées par code et statut, sans données personnelles', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(RPC);
  for (const name of ['get_public_event', 'kiosk_get_event']) {
    const body = fnBody(sql, name);
    assert.match(body, /SECURITY DEFINER/, `${name} SECURITY DEFINER`);
    assert.match(body, /SET search_path = public, pg_temp/, `${name} search_path`);
    assert.match(body, /WHERE e\.access_code = UPPER\(TRIM\(p_code\)\)/, `${name} exige le code`);
    assert.match(body, /e\.status IN \('active', 'submitted'\)/, `${name} exclut les archivés`);
    assert.match(body, /LIMIT 1/);
    for (const col of SENSITIVE) assert.doesNotMatch(body, new RegExp(`\\b${col}\\b`), `${name} n'expose pas ${col}`);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(TEXT\\) FROM PUBLIC;`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(TEXT\\) TO anon, authenticated, service_role;`));
  }
  // La galerie publique n'a pas besoin du code (elle le connaît déjà) ni de la config kiosk.
  const pub = fnBody(sql, 'get_public_event');
  assert.doesNotMatch(pub, /access_code'/);
  assert.doesNotMatch(pub, /'kiosk'/);
  // Le kiosk ne reçoit que form_config.kiosk, pas tout le form_config.
  assert.match(fnBody(sql, 'kiosk_get_event'), /'form_config', json_build_object\('kiosk', e\.form_config -> 'kiosk'\)/);
  // Pas de lecture par id : les id d'événement sont visibles par anon (table photos).
  assert.doesNotMatch(sql, /p_event_id/);
});

test('transition : colonnes anon = celles lues par les kiosks ≤ 1.0.14 (+ colonnes de la policy)', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(TRANSITION);
  assert.match(sql, /REVOKE ALL ON public\.events FROM anon;/);
  const grant = sql.match(/GRANT SELECT \(([^)]+)\) ON public\.events TO anon;/);
  assert.ok(grant, 'GRANT par colonnes');
  const cols = grant[1].split(',').map((c) => c.trim()).sort();
  assert.deepEqual(cols, ['access_code', 'end_date', 'form_config', 'id', 'name', 'org_id', 'status']);
  // Policy recréée (même nom, pour que l'étape 3 la supprime) avec une fenêtre sur end_date.
  assert.match(sql, /DROP POLICY IF EXISTS "events_anon_read" ON public\.events;/);
  assert.match(sql, /CREATE POLICY "events_anon_read"\s+ON public\.events FOR SELECT TO anon/);
  assert.match(sql, /end_date IS NULL OR end_date > NOW\(\) - INTERVAL '7 days'/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.search_events\(TEXT, INTEGER\) FROM PUBLIC, anon;/);
});

test('finale : policy supprimée et plus aucun droit anon sur events', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(FINAL);
  assert.match(sql, /DROP POLICY IF EXISTS "events_anon_read" ON public\.events;/);
  assert.match(sql, /REVOKE ALL ON public\.events FROM anon;/);
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT/);
});

test('finale : garde-fou contre un db push prématuré (bornes actives < 1.0.15)', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(FINAL);
  const guard = sql.indexOf('RAISE EXCEPTION');
  assert.ok(guard > 0 && guard < sql.indexOf('DROP POLICY'), 'le contrôle précède la suppression');
  assert.match(sql, /FROM public\.kiosk_licenses\s+WHERE is_active\s+AND last_seen_at > NOW\(\) - INTERVAL '30 days'/);
  // Version absente ou illisible = considérée comme obsolète.
  assert.match(sql, /COALESCE\(\(regexp_match\(app_version, '\^\(\\d\+\)\\\.\(\\d\+\)\\\.\(\\d\+\)'\)\)::INT\[\] < ARRAY\[1, 0, 15\], TRUE\)/);
});

test('aucune migration postérieure ne rouvre events à anon', () => {
  const offenders: string[] = [];
  for (const f of all.filter((x) => x > FINAL)) {
    const s = read(f);
    for (const m of s.matchAll(/CREATE POLICY[^;]*?ON public\.events\b[^;]*;/g)) {
      const toAnon = /\bTO\s+[^;]*\banon\b/i.test(m[0]);
      // Sans TO (ou TO public), la policy vaut aussi pour anon : tolérée seulement si liée à auth.uid().
      const toPublic = !/\bTO\b/i.test(m[0]) || /\bTO\s+public\b/i.test(m[0]);
      if (toAnon || (toPublic && !/auth\.uid\(\)/.test(m[0]))) offenders.push(`${f} : ${m[0].split('\n')[0]}`);
    }
    if (/GRANT[^;]*ON (TABLE )?public\.events\b[^;]*TO[^;]*\b(anon|public)\b/i.test(s)) offenders.push(`${f} : GRANT`);
  }
  assert.deepEqual(offenders, []);
});

test('kiosk : plus de lecture REST directe de events, passage par kiosk_get_event', () => {
  const svc = new URL('../../../../kiosk/PolaKiosk/Services/SupabaseService.cs', import.meta.url);
  if (!existsSync(svc)) return; // saas/ isolé du monorepo
  const src = readFileSync(svc, 'utf8');
  assert.doesNotMatch(src, /rest\/v1\/events/);
  assert.match(src, /PostRpcAsync\("kiosk_get_event"/);
});
