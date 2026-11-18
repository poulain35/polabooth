// LAB-128 / LAB-276 : catalogues de l'application (modèles, décorations, polices, articles d'aide) et
// leurs buckets réservés à l'administrateur de l'application (is_app_admin), nettoyage des droits.
// Contrôles statiques des migrations, des scripts de vérification SQL et du front.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const TESTS = new URL('../../tests/', import.meta.url);
const SRC = new URL('../../../src/', import.meta.url);

const CLEANUP = '20261216000000_lab128_cleanup_grants.sql';
const CATALOGS = '20261216000001_lab128_catalogs_app_admin.sql';
const MIGRATIONS = [CLEANUP, CATALOGS];
const CHECKS = ['lab128_cleanup_check.sql', 'lab128_catalogs_check.sql'];
const ADMIN = '(SELECT public.is_app_admin())';

const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const migration = (f: string) => strip(readPrivateHistory(new URL(f, DIR)));
const all = () => readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SECRETS = [/eyJ[A-Za-z0-9_-]{10,}/, /sbp_[A-Za-z0-9]{10,}/, /\b[a-z]{20}\.supabase\.co/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /service_role_key|sk_live_/i];
const src = (f: string) => readFileSync(new URL(f, SRC), 'utf8');

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

test('nettoyage : policies inutiles retirées, plus de TRUNCATE ni REFERENCES ni TRIGGER, anon en lecture seule', { skip: PRIVATE_HISTORY }, () => {
  const sql = flat(migration(CLEANUP));
  assert.ok(sql.includes('DROP POLICY IF EXISTS "Admin write" ON public.templates;'));
  assert.ok(sql.includes('DROP POLICY IF EXISTS "anon_insert_support_messages" ON public.support_messages;'));
  assert.ok(sql.includes('REVOKE INSERT ON public.support_messages FROM anon;'));
  assert.match(sql, /REVOKE TRUNCATE, REFERENCES, TRIGGER ON public\.templates, public\.decorations, public\.custom_fonts, public\.support_articles, public\.kiosk_logs, public\.event_form_responses, public\.support_messages FROM anon, authenticated;/);
  assert.match(sql, /server_version_num'\)::int >= 170000 THEN EXECUTE 'REVOKE MAINTAIN/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.templates, public\.decorations, public\.custom_fonts, public\.support_articles FROM anon;/);
  // Aucun GRANT : la migration ne fait que retirer.
  assert.doesNotMatch(sql, /\bGRANT\b/);
});

test('borne : la policy anon_insert_kiosk_logs n\'est retirée que par LAB-280 (borne passée à la RPC)', { skip: PRIVATE_HISTORY }, () => {
  const LAB280 = '20261218000000_lab280_kiosk_logs_no_anon_insert.sql';
  for (const f of all()) {
    if (f !== LAB280) assert.doesNotMatch(migration(f), /DROP POLICY[^;]*anon_insert_kiosk_logs/, f);
  }
  // Le nettoyage LAB-276 laissait INSERT à anon sur kiosk_logs ; LAB-280 le retire avec la policy.
  const sql = migration(CLEANUP);
  assert.match(sql, /REVOKE SELECT, UPDATE, DELETE ON public\.kiosk_logs FROM anon;/);
  assert.doesNotMatch(sql, /REVOKE[^;]*\bINSERT\b[^;]*ON public\.kiosk_logs FROM anon/);
});

test('catalogues : chaque écriture (tables et buckets) réservée à is_app_admin(), lectures conservées', { skip: PRIVATE_HISTORY }, () => {
  const sql = migration(CATALOGS);
  const policies = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON (\S+)\s+FOR (\w+) TO (\w+)([\s\S]*?);/g)]
    .map((m) => ({ name: m[1], table: m[2], cmd: m[3], role: m[4], body: flat(m[5]) }));
  assert.equal(policies.length, 25); // tables : 4 + 4 + 3 + 4 ; buckets : 3 × 3 + lecture des polices
  for (const p of policies) {
    assert.equal(p.role, 'authenticated', p.name);
    if (p.cmd === 'SELECT' && !p.name.includes('app_admin')) continue;
    assert.ok(p.body.includes(ADMIN), `${p.name} : is_app_admin`);
    assert.doesNotMatch(p.body, /\bOR\b/, `${p.name} : aucune branche qui rouvre l'accès`);
    if (p.cmd === 'UPDATE') assert.equal(p.body.split(ADMIN).length - 1, 2, `${p.name} : USING et WITH CHECK`);
  }
  const writes = (table: string) => policies.filter((p) => p.table === table && p.cmd !== 'SELECT').map((p) => p.cmd).sort();
  for (const t of ['public.templates', 'public.decorations', 'public.custom_fonts', 'public.support_articles']) {
    assert.deepEqual(writes(t), ['DELETE', 'INSERT', 'UPDATE'], t);
  }
  for (const bucket of ['template-backgrounds', 'decorations', 'fonts']) {
    const ps = policies.filter((p) => p.table === 'storage.objects' && p.body.includes(`bucket_id = '${bucket}'`) && p.cmd !== 'SELECT');
    assert.deepEqual(ps.map((p) => p.cmd).sort(), ['DELETE', 'INSERT', 'UPDATE'], bucket);
  }
  // Lecture : décorations pour tout connecté, articles publiés pour tous, fichiers de polices lisibles
  // par le connecté (sans elle, la suppression d'un fichier par l'admin ne trouve aucune ligne).
  assert.match(flat(sql), /"decorations_authenticated_select" ON public\.decorations FOR SELECT TO authenticated USING \(true\);/);
  assert.match(flat(sql), /"support_articles_authenticated_select" ON public\.support_articles FOR SELECT TO authenticated USING \(is_published OR \(SELECT public\.is_app_admin\(\)\)\);/);
  assert.match(flat(sql), /"storage_fonts_authenticated_select" ON storage\.objects FOR SELECT TO authenticated USING \(bucket_id = 'fonts'\);/);
  // Anciennes policies d'écriture ouvertes à tout connecté retirées.
  for (const name of ['Authenticated users can manage templates', 'Admin full access on decorations', 'custom_fonts_org_owner_insert',
    'admin_full_access_support_articles', 'Authenticated users can upload backgrounds', 'decorations_admin_insert', 'fonts_upload', 'fonts_delete']) {
    assert.ok(sql.includes(`DROP POLICY IF EXISTS "${name}"`), name);
  }
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

test('front : menu « Bibliothèque » et routes des catalogues réservés à l\'administrateur de l\'application', () => {
  // LAB-335 : l'ancien groupe « Création » devient l'entrée « Bibliothèque » (modèles, décorations, polices).
  const layout = src('pages/admin/AdminLayout.jsx');
  assert.match(layout, /const LIBRARY_ITEM = 'templates';/);
  assert.match(layout, /const \{ isAdmin: isAppAdmin \} = useAppAdmin\(\);/);
  assert.match(layout, /item\.to !== LIBRARY_ITEM \|\| isAppAdmin/);

  const app = src('App.jsx');
  for (const [path, page] of [['templates/new', 'AdminTemplateEditor'], ['templates/:id/edit', 'AdminTemplateEditor']]) {
    assert.match(app, new RegExp(`\\{ path: '${path}',\\s+element: A\\(<${page} />\\) \\}`), path);
  }
  // Listes des catalogues : enfants de la mise en page Bibliothèque, gardée par A().
  const at = app.indexOf('element: A(<AdminLibrary />)');
  assert.ok(at >= 0, 'mise en page Bibliothèque gardée');
  const library = app.slice(at);
  const children = library.slice(0, library.indexOf(']'));
  for (const [path, page] of [['templates', 'AdminTemplates'], ['decorations', 'AdminDecorations'], ['fonts', 'AdminFonts']]) {
    assert.match(children, new RegExp(`\\{ path: '${path}',\\s+element: L\\(<${page} />\\) \\}`), path);
  }
  const guard = app.slice(app.indexOf('function RequireAppAdmin'), app.indexOf('function A('));
  assert.match(guard, /if \(loading\) return <PageSpinner \/>;/);
  assert.match(guard, /if \(isAdmin\) return children;/);
  assert.match(guard, /<Navigate to="\/admin" replace \/>/);

  const detail = src('pages/admin/event/CreationTab.jsx');
  assert.match(detail, /const \{ isAdmin: canPromote \} = useAppAdmin\(\);/);
  assert.match(detail, /\{canPromote && design\.canvas_json && !showPromote && \(/);
  assert.match(detail, /\{canPromote && showPromote && <PromoteToTemplateForm/);

  assert.doesNotMatch(src('components/StickerPanel.jsx'), /Admin → Décorations/);
});

test('front : statut admin lu par la RPC is_app_admin, refus par défaut', () => {
  const hook = src('hooks/useAppAdmin.js');
  assert.match(hook, /createAppAdminStore\(\{ getUserId: getCurrentUserId, checkAdmin: isAppAdmin \}\)/);
  const lib = src('lib/api/auth.js');
  assert.match(lib, /export async function isAppAdmin\(\) \{\s+const \{ data, error \} = await supabase\.rpc\('is_app_admin'\);/);
  assert.match(lib, /export async function getCurrentUserId\(\)/);
});
