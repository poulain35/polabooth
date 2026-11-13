// LAB-114 : la clé anon ne lit ni n'écrit plus directement la table photos.
// Lecture par code via get_public_photos, écriture kiosk via kiosk_record_photo (SECURITY DEFINER),
// policies anon supprimées en dernière étape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const RPC = '20261105000000_photos_public_rpc.sql';
const TRANSITION = '20261105000001_photos_anon_transition.sql';
const FINAL = '20261105000002_photos_drop_anon.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const read = (f: string) => strip(readFileSync(new URL(f, DIR), 'utf8'));
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const fnBody = (sql: string, name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('ordre : RPC, puis transition, puis suppression, après la finale LAB-112', { skip: PRIVATE_HISTORY }, () => {
  const i = [RPC, TRANSITION, FINAL].map((f) => all.indexOf(f));
  assert.ok(i.every((x) => x >= 0), 'migrations LAB-114 présentes');
  assert.deepEqual([...i].sort((a, b) => a - b), i);
  assert.ok(RPC > '20261103000002_events_drop_anon_read.sql');
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('get_public_photos : SECURITY DEFINER, exige le code, événement actif, photos approuvées uniquement', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(RPC);
  const body = fnBody(sql, 'get_public_photos');
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = public, pg_temp/);
  assert.match(body, /STABLE/);
  assert.match(body, /WHERE e\.access_code = UPPER\(TRIM\(p_code\)\)/);
  assert.match(body, /e\.status IN \('active', 'submitted'\)/);
  assert.match(body, /p\.status = 'approved'/);
  assert.match(body, /LIMIT p_limit/);
  // Colonnes renvoyées : seulement celles affichées par la galerie.
  const cols = body.match(/RETURNS TABLE \(([^)]*)\)/);
  assert.ok(cols, 'RETURNS TABLE');
  assert.deepEqual(
    cols[1].split(',').map((c) => c.trim().split(/\s+/)[0]),
    ['id', 'photo_url', 'thumbnail_url', 'storage_path', 'share_url', 'source', 'width', 'height', 'created_at'],
  );
  const selectList = body.slice(body.indexOf('SELECT '), body.indexOf('FROM public.events'));
  for (const col of ['event_id', 'status', 'uploader_name', 'local_path', 'album_name', '\\*']) {
    assert.doesNotMatch(selectList, new RegExp(`\\bp\\.${col}`), `n'expose pas ${col}`);
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_public_photos\(TEXT, INTEGER\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_public_photos\(TEXT, INTEGER\) TO anon, authenticated, service_role;/);
});

test('kiosk_record_photo : licence, couple (événement, code) actif, URL du dossier de l\'événement', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(RPC);
  const body = fnBody(sql, 'kiosk_record_photo');
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = public, pg_temp/);
  // Licence : même règle que kiosk_check_license.
  assert.match(body, /FROM public\.kiosk_licenses\s+WHERE machine_id = p_machine_id\s+AND is_active\s+AND \(secret IS NULL OR secret = p_secret\)/);
  assert.match(body, /e\.id = p_event_id\s+AND e\.access_code = UPPER\(TRIM\(p_code\)\)\s+AND e\.status IN \('active', 'submitted'\)/);
  assert.match(body, /p_photo_url !~ \('\^https:\/\/\[\^\/\?#\]\+\/storage\/v1\/object\/public\/photos\/' \|\| p_event_id::TEXT/);
  assert.match(body, /p_photo_url LIKE '%\.\.%'/);
  // source et status fixés côté serveur.
  assert.match(body, /VALUES \(p_event_id, p_photo_url, 'kiosk', 'approved'\)/);
  // Chaque contrôle lève une exception avant l'INSERT.
  const insert = body.indexOf('INSERT INTO public.photos');
  assert.equal((body.slice(0, insert).match(/RAISE EXCEPTION/g) ?? []).length, 3);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT\) TO anon, service_role;/);
});

test('RPC (étape 1) : purement additive, aucune policy ni droit sur la table photos', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(RPC);
  assert.doesNotMatch(sql, /POLICY/);
  assert.doesNotMatch(sql, /(GRANT|REVOKE)[^;]*ON (TABLE )?public\.photos\b/);
});

test('transition : plus de lecture listable, insert kiosk ≤ 1.0.14 restreint, admin limité au propriétaire', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(TRANSITION);
  assert.match(sql, /REVOKE ALL ON public\.photos FROM anon;/);
  // RETURNING des kiosks ≤ 1.0.14 : SELECT table + policy qui ne voit que la transaction courante.
  assert.match(sql, /GRANT SELECT ON public\.photos TO anon;/);
  const ins = sql.match(/GRANT INSERT \(([^)]+)\) ON public\.photos TO anon;/);
  assert.ok(ins, 'INSERT par colonnes');
  assert.deepEqual(ins[1].split(',').map((c) => c.trim()).sort(), ['event_id', 'photo_url', 'source']);
  assert.match(sql, /DROP POLICY IF EXISTS "public_read_photos" ON public\.photos;/);
  assert.match(sql, /CREATE POLICY "photos_anon_kiosk_returning"\s+ON public\.photos FOR SELECT TO anon\s+USING \(source = 'kiosk' AND created_at >= NOW\(\)\);/);
  assert.match(sql, /CREATE POLICY "anon_insert_photos"\s+ON public\.photos FOR INSERT TO anon/);
  assert.match(sql, /photo_url ~ \('\^https:\/\/\[\^\/\?#\]\+\/storage\/v1\/object\/public\/photos\/' \|\| event_id::TEXT/);
  // Admin : les deux noms de policy « tout authenticated » (dev / prod) sont supprimés.
  assert.match(sql, /DROP POLICY IF EXISTS "admin_full_access_photos" ON public\.photos;/);
  assert.match(sql, /DROP POLICY IF EXISTS "Admin full access on photos" ON public\.photos;/);
  assert.match(sql, /CREATE POLICY "photos_org_owner_all"\s+ON public\.photos FOR ALL TO authenticated/);
  assert.equal((sql.match(/WHERE o\.owner_id = \(SELECT auth\.uid\(\)\)/g) ?? []).length, 2, 'USING et WITH CHECK');
  const guard = sql.indexOf('o.owner_id IS NULL');
  assert.ok(guard > 0 && guard < sql.indexOf('DROP POLICY IF EXISTS "admin_full_access_photos"'), 'garde-fou owner_id avant la restriction admin');
  // Aucune policy anon ne lit events (lecture anon d'events retirée par LAB-112).
  for (const m of sql.matchAll(/CREATE POLICY[^;]*TO anon[^;]*;/g)) assert.doesNotMatch(m[0], /public\.events/);
});

test('finale : garde-fou parc ≥ 1.0.15 avant la suppression', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(FINAL);
  const guard = sql.indexOf('RAISE EXCEPTION');
  assert.ok(guard > 0 && guard < sql.indexOf('DROP POLICY'), 'le contrôle précède la suppression');
  assert.match(sql, /FROM public\.kiosk_licenses\s+WHERE is_active\s+AND last_seen_at > NOW\(\) - INTERVAL '30 days'/);
  assert.match(sql, /COALESCE\(\(regexp_match\(app_version, '\^\(\\d\+\)\\\.\(\\d\+\)\\\.\(\\d\+\)'\)\)::INT\[\] < ARRAY\[1, 0, 15\], TRUE\)/);
});

test('finale : policies anon supprimées et plus aucun droit anon sur photos', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(FINAL);
  for (const p of ['public_read_photos', 'photos_anon_kiosk_returning', 'anon_insert_photos']) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "${p}" ON public\\.photos;`));
  }
  assert.match(sql, /REVOKE ALL ON public\.photos FROM anon;/);
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT/);
});

test('aucune migration postérieure ne rouvre photos à anon', () => {
  const offenders: string[] = [];
  for (const f of all.filter((x) => x > FINAL)) {
    const s = read(f);
    for (const m of s.matchAll(/CREATE POLICY[^;]*?ON public\.photos\b[^;]*;/g)) {
      const toAnon = /\bTO\s+[^;]*\banon\b/i.test(m[0]);
      const toPublic = !/\bTO\b/i.test(m[0]) || /\bTO\s+public\b/i.test(m[0]);
      if (toAnon || (toPublic && !/auth\.uid\(\)/.test(m[0]))) offenders.push(`${f} : ${m[0].split('\n')[0]}`);
    }
    if (/GRANT[^;]*ON (TABLE )?public\.photos\b[^;]*TO[^;]*\b(anon|public)\b/i.test(s)) offenders.push(`${f} : GRANT`);
  }
  assert.deepEqual(offenders, []);
});

test('get-photos : ne renvoie que les photos approuvées (modération)', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /\.from\('photos'\)[\s\S]*?\.eq\('status', 'approved'\)/);
});

test('kiosk : plus d\'écriture REST directe de photos, passage par kiosk_record_photo', () => {
  const svc = new URL('../../../../kiosk/PolaKiosk/Services/SupabaseService.cs', import.meta.url);
  if (!existsSync(svc)) return; // saas/ isolé du monorepo
  const src = readFileSync(svc, 'utf8');
  assert.doesNotMatch(src, /rest\/v1\/photos/);
  assert.match(src, /PostRpcAsync\("kiosk_record_photo"/);
  for (const arg of ['p_code', 'p_event_id', 'p_photo_url', 'p_machine_id', 'p_secret']) {
    assert.match(src, new RegExp(`\\b${arg}\\b`), `argument ${arg}`);
  }
});
