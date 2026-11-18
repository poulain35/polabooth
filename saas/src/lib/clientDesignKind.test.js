// Deux designs par événement (client_designs.kind : 'print' = modèle photo, 'home' = écran d'accueil).
// Migration 20261219000000_client_home_design.sql ; vérification en base : supabase/tests/lab288_*.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAAS = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = join(SAAS, 'supabase', 'migrations');
const MIGRATION = '20261219000000_client_home_design.sql';
const strip = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const sql = strip(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'));
const SIGNATURE = 'public.kiosk_get_approved_design(text, text, uuid)';

test('migration : présente, timestamp unique', () => {
  assert.ok(all.includes(MIGRATION));
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('migration : kind sur client_designs et design_versions, un design par (événement, kind)', () => {
  for (const table of ['client_designs', 'design_versions']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'print';`));
    assert.match(sql, new RegExp(`ADD CONSTRAINT ${table}_kind_check CHECK \\(kind IN \\('print', 'home'\\)\\);`));
  }
  assert.match(sql, /DROP CONSTRAINT IF EXISTS client_designs_event_id_key;/);
  assert.match(sql, /ADD CONSTRAINT client_designs_event_id_kind_key UNIQUE \(event_id, kind\);/);
  assert.doesNotMatch(sql, /UPDATE public\.client_designs/, 'aucune ligne existante modifiée hors défaut');
});

// Redéfinie ensuite (cadres, LAB-311) : les règles de home_design valent pour la dernière définition.
test('RPC borne : dernière définition, modèle photo filtré, home_design sous conditions strictes', () => {
  const defining = all.filter((f) => /CREATE OR REPLACE FUNCTION "?public"?\."?kiosk_get_approved_design"?/
    .test(readFileSync(join(MIGRATIONS, f), 'utf8')));
  assert.ok(defining.includes(MIGRATION));

  const latest = strip(readFileSync(join(MIGRATIONS, defining.at(-1)), 'utf8'));
  const body = latest.slice(latest.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_get_approved_design'));
  assert.match(body, /SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  assert.match(body, /AND d\.kind = 'print'\s+AND d\.status = 'approved'/);
  assert.match(body, /'home_design',\s+\(\s+SELECT json_build_object\('id', h\.id, 'final_png_url', h\.final_png_url\)/);
  assert.match(body, /AND h\.kind = 'home'\s+AND h\.status = 'approved'/);
  assert.match(body, /v_home -> 'personalized' = 'true'::jsonb/);
  assert.match(body, /v_home -> 'client_design' = 'true'::jsonb/);
});

test('RPC borne : droits inchangés (anon et service_role seulement)', () => {
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${SIGNATURE.replace(/[().]/g, '\\$&')} FROM PUBLIC, anon, authenticated;`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${SIGNATURE.replace(/[().]/g, '\\$&')} TO anon, service_role;`));
  assert.equal((sql.match(/GRANT /g) ?? []).length, 1);
});

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(js|jsx|ts)$/.test(name) && !/\.test\.(js|ts)$/.test(name)) out.push(p);
  }
  return out;
}

/** Chaque requête sur client_designs du code : du `.from(` jusqu'à la fin de l'expression. */
function designQueries() {
  const queries = [];
  for (const file of [...sourceFiles(join(SAAS, 'src')), ...sourceFiles(join(SAAS, 'supabase', 'functions'))]) {
    const src = readFileSync(file, 'utf8');
    // LAB-289 : kind venu de la requête, mais validé (print ou home) par parseDesignKind.
    const validatedKind = /\bparseDesignKind\(|\bparseVersionRequest\(/.test(src);
    for (const m of src.matchAll(/\.from\(\s*['"]client_designs['"]\s*\)/g)) {
      const rest = src.slice(m.index + m[0].length);
      const end = rest.search(/;|\.from\(/);
      queries.push({ file: file.slice(SAAS.length), validatedKind, query: rest.slice(0, end < 0 ? undefined : end) });
    }
  }
  return queries;
}

// LAB-290 : l'admin lit aussi les deux kinds à valider (.in('kind', …)).
const LITERAL_KIND = /\.eq\(\s*'kind',\s*'(print|home)'\s*\)|kind:\s*'(print|home)'|\.in\(\s*'kind',/;
const VALIDATED_KIND = /\.eq\(\s*'kind',\s*(request\.)?kind\s*\)|[{,]\s*kind\s*,/;

test('code : chaque lecture ou écriture de client_designs vise un kind (ou un design par son id)', () => {
  const queries = designQueries();
  assert.ok(queries.length >= 10, `requêtes trouvées : ${queries.length}`);
  for (const { file, validatedKind, query } of queries) {
    const ok = LITERAL_KIND.test(query) || /\.eq\(\s*'id',/.test(query)
      || (validatedKind && VALIDATED_KIND.test(query));
    assert.ok(ok, `${file} : ${query.trim()}`);
  }
});

// LAB-311 : la contrainte unique est devenue (event_id, kind, slot).
test('code : les upsert de client_designs se font sur (event_id, kind, slot)', () => {
  const upserts = designQueries().filter(({ query }) => query.includes('.upsert('));
  assert.ok(upserts.length >= 2);
  for (const { file, validatedKind, query } of upserts) {
    assert.match(query, /onConflict:\s*'event_id,kind,slot'/, file);
    assert.ok(LITERAL_KIND.test(query) || (validatedKind && VALIDATED_KIND.test(query)), file);
  }
});
