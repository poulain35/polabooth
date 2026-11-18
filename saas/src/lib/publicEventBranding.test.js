// LAB-301 — get_public_event renvoie l'habillage de l'événement (form_config.branding), filtré.
// Contrôle statique de la migration ; le contrôle en base est supabase/tests/lab301_public_event_branding_check.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../../supabase/migrations/', import.meta.url);
const FILE = '20261221000000_event_branding_public.sql';
const strip = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const SQL = strip(readFileSync(new URL(FILE, DIR), 'utf8'));
const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.get_public_event(');
const BODY = SQL.slice(start, SQL.indexOf('$$;', start) + 3);
const FLAT = BODY.replace(/\s+/g, ' ');

test('get_public_event : mêmes garanties qu\'avant (definer, search_path, garde, filtres, droits)', () => {
  assert.ok(start >= 0);
  assert.match(BODY, /CREATE OR REPLACE FUNCTION public\.get_public_event\(p_code TEXT\)\s+RETURNS JSON\s+LANGUAGE plpgsql\s+VOLATILE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  assert.match(BODY, /v_bucket\s+TEXT := public\.rpc_code_guard\(\);/);
  assert.match(FLAT, /WHERE e\.access_code = UPPER\(TRIM\(p_code\)\) AND e\.status IN \('active', 'submitted'\) LIMIT 1;/);
  assert.match(FLAT, /IF NOT FOUND THEN PERFORM public\.rpc_code_failed\(v_bucket\); RETURN NULL; END IF;/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.get_public_event\(TEXT\) FROM PUBLIC;\s+GRANT EXECUTE ON FUNCTION public\.get_public_event\(TEXT\) TO anon, authenticated, service_role;/);
  assert.doesNotMatch(SQL, /DROP FUNCTION|ALTER TABLE|CREATE TABLE|GRANT [^;]*\bON\b (?!FUNCTION public\.get_public_event)/);
});

test('get_public_event : champs historiques inchangés, branding en dernier', () => {
  const keys = [...FLAT.matchAll(/RETURN json_build_object\((.*?)\);/g)].at(-1)[1]
    .split(',').map((s) => s.trim().match(/^'(\w+)'/)?.[1]).filter(Boolean);
  assert.deepEqual(keys, ['id', 'name', 'company', 'gallery', 'booking_banner', 'event_type', 'branding']);
  assert.match(FLAT, /COALESCE\(NULLIF\(o\.contact_company, ''\), NULLIF\(o\.name, ''\), ''\) AS company/);
  assert.match(FLAT, /COALESCE\(e\.form_config -> 'gallery', '\{\}'::jsonb\) AS gallery/);
  assert.match(FLAT, /\(o\.business_profile -> 'gallery_booking_banner'\) IS DISTINCT FROM 'false'::jsonb AS booking_banner/);
});

test('get_public_event : form_config jamais renvoyé brut, seules trois clés de branding lues et filtrées', () => {
  assert.deepEqual([...new Set(FLAT.match(/e\.form_config -> '\w+'/g))].sort(),
    ["e.form_config -> 'branding'", "e.form_config -> 'gallery'"]);
  assert.doesNotMatch(FLAT, /e\.form_config\s*(?:AS|,|\))|->>\s*'kiosk'|row_to_json|to_jsonb?\(|\be\.\*|\bo\.\*/);
  assert.deepEqual([...new Set(FLAT.match(/v_event\.branding -(?:>>?) '\w+'/g).map((m) => m.match(/'(\w+)'/)[1]))].sort(),
    ['color', 'gallery_text', 'logo_url']);
  assert.match(FLAT, /IF jsonb_typeof\(v_event\.branding\) = 'object' THEN/);
  assert.match(FLAT, /\(v_event\.branding ->> 'color'\) ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/);
  assert.match(FLAT, /starts_with\(v_event\.branding ->> 'logo_url', 'https:\/\/'\)/);
  assert.match(FLAT, /left\(v_event\.branding ->> 'gallery_text', 300\)/);
  for (const k of ['color', 'logo_url', 'gallery_text']) {
    assert.match(FLAT, new RegExp(`jsonb_typeof\\(v_event\\.branding -> '${k}'\\) = 'string'`), `${k} : chaîne seulement`);
  }
});

test('get_public_event : leads (module privé) lu seulement s\'il existe, par requête dynamique', () => {
  // La base open core n'a pas la table leads : une référence statique casserait la galerie.
  assert.equal(FLAT.match(/leads/g).length, 2, 'leads nommé seulement dans le test d\'existence et la requête dynamique');
  assert.match(FLAT, /IF to_regclass\(format\('%I\.%I', 'public', 'leads'\)\) IS NOT NULL THEN EXECUTE format\('SELECT l\.event_type FROM %I\.%I l WHERE l\.converted_event_id = \$1 ' \|\| 'ORDER BY l\.created_at DESC NULLS LAST LIMIT 1', 'public', 'leads'\) INTO v_event_type USING v_event\.id; END IF;/);
});

test('migration : dernière définition de get_public_event, horodatage unique', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const definers = files.filter((f) => readFileSync(new URL(f, DIR), 'utf8').includes('FUNCTION public.get_public_event('));
  assert.equal(definers.at(-1), FILE);
  assert.equal(files.filter((f) => f.startsWith(FILE.slice(0, 14))).length, 1);
});
