// Écrans de la borne composés par l'admin (LAB-295) : table kiosk_screens et RPC kiosk_get_screens.
// Migration 20261220000000_kiosk_screens.sql ; vérification en base : supabase/tests/lab295_*.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAAS = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = join(SAAS, 'supabase', 'migrations');
const MIGRATION = '20261220000000_kiosk_screens.sql';
const strip = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f) => readFileSync(join(MIGRATIONS, f), 'utf8');
const sql = strip(read(MIGRATION));
const SIGNATURE = 'public.kiosk_get_screens(uuid, text, text)';
const esc = (s) => s.replace(/[().]/g, '\\$&');

const fnBody = (src, name) => {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, name);
  return src.slice(start, src.indexOf('$$;', start) + 3);
};
const licenseCheck = (body) => body.slice(body.indexOf('SELECT l.id, l.org_id'), body.indexOf('END IF;') + 7);

test('migration : présente, timestamp unique, aucune donnée existante modifiée', () => {
  assert.ok(all.includes(MIGRATION));
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE public\.(?!kiosk_screens\b))/m);
});

test('table : un écran par organisation et par sorte, publié séparé du brouillon', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.kiosk_screens \(/);
  assert.match(sql, /org_id\s+uuid\s+NOT NULL DEFAULT public\.current_owner_org_id\(\)\s+REFERENCES public\.organizations \(id\) ON DELETE CASCADE/);
  assert.match(sql, /kind\s+text\s+NOT NULL CONSTRAINT kiosk_screens_kind_check CHECK \(kind IN \('home', 'result'\)\)/);
  assert.match(sql, /CONSTRAINT kiosk_screens_org_id_kind_key UNIQUE \(org_id, kind\)/);
  for (const col of [/draft_json\s+jsonb,/, /draft_updated_at\s+timestamptz,/, /published\s+jsonb,/,
    /published_version int\s+NOT NULL DEFAULT 0,/, /published_at\s+timestamptz,/]) assert.match(sql, col);
});

test('RLS : propriétaire de l\'organisation seulement, aucun droit pour anon', () => {
  assert.match(sql, /ALTER TABLE public\.kiosk_screens ENABLE ROW LEVEL SECURITY;/);
  const owner = String.raw`org_id IN \(SELECT o\.id FROM public\.organizations o WHERE o\.owner_id = auth\.uid\(\)\)`;
  for (const op of ['select', 'insert', 'update', 'delete']) {
    const clause = op === 'insert' ? 'WITH CHECK' : 'USING';
    assert.match(sql, new RegExp(`CREATE POLICY kiosk_screens_owner_${op}\\s+ON public\\.kiosk_screens FOR ${op.toUpperCase()} TO authenticated\\s+${clause} \\(\\s+${owner}\\s+\\)`), op);
  }
  assert.match(sql, /FOR UPDATE TO authenticated[\s\S]*?WITH CHECK \(\s+org_id IN/);
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 4);
  assert.match(sql, /REVOKE ALL ON public\.kiosk_screens FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.kiosk_screens TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT [^;]*ON public\.kiosk_screens TO [^;]*\banon\b/);
});

test('RPC borne : licence vérifiée exactement comme kiosk_get_approved_design', () => {
  const defining = all.filter((f) => /CREATE OR REPLACE FUNCTION "?public"?\."?kiosk_get_approved_design"?/.test(read(f)));
  const approved = fnBody(strip(read(defining.at(-1))), 'kiosk_get_approved_design');
  const screens = fnBody(sql, 'kiosk_get_screens');
  assert.equal(licenseCheck(screens).replace('kiosk_get_screens', 'X'), licenseCheck(approved).replace('kiosk_get_approved_design', 'X'));
  assert.match(screens, /USING ERRCODE = '42501'/);
  assert.match(screens, /RETURNS jsonb\s+LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/);
});

test('RPC borne : écrans publiés de l\'organisation de l\'événement, jamais le brouillon', () => {
  const screens = fnBody(sql, 'kiosk_get_screens');
  assert.match(screens, /FUNCTION public\.kiosk_get_screens\(p_event_id uuid, p_machine_id text, p_secret text\)/);
  assert.match(screens, /EXISTS \(SELECT 1 FROM public\.events e WHERE e\.id = p_event_id AND e\.org_id = v_org\)/);
  assert.match(screens, /SELECT s\.published INTO v_home\s+FROM public\.kiosk_screens s\s+WHERE s\.org_id = v_org AND s\.kind = 'home';/);
  assert.match(screens, /SELECT s\.published INTO v_result\s+FROM public\.kiosk_screens s\s+WHERE s\.org_id = v_org AND s\.kind = 'result';/);
  assert.match(screens, /RETURN jsonb_build_object\('home', v_home, 'result', v_result\);/);
  assert.doesNotMatch(screens, /draft/);
});

test('RPC borne : droits anon et service_role seulement', () => {
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${esc(SIGNATURE)} FROM PUBLIC, anon, authenticated;`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${esc(SIGNATURE)} TO anon, service_role;`));
  assert.equal((sql.match(/GRANT EXECUTE/g) ?? []).length, 1);
});

test('manifeste : kiosk_screens dans le socle ouvert', () => {
  const manifest = JSON.parse(readFileSync(join(SAAS, 'supabase', 'features.json'), 'utf8'));
  assert.ok(manifest.features.core.tables.includes('kiosk_screens'));
});
