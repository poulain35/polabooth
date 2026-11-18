// Plusieurs cadres par événement (client_designs.slot et label, LAB-311, spec docs/specs/choix-cadre-invite.md).
// Migration 20261222000000_client_design_frames.sql ; vérification en base : supabase/tests/client_design_frames_check.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const MIGRATION = '20261222000000_client_design_frames.sql';
const strip = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const sql = strip(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'));
const esc = (s) => s.replace(/[().]/g, '\\$&');
const SIGNATURE = 'public.kiosk_get_approved_design(text, text, uuid)';

test('migration : présente, timestamp unique', () => {
  assert.ok(all.includes(MIGRATION));
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('migration : slot et label sur client_designs, un seul écran d\'accueil, UNIQUE (event_id, kind, slot)', () => {
  assert.match(sql, /ALTER TABLE public\.client_designs ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;/);
  assert.match(sql, /ALTER TABLE public\.client_designs ADD COLUMN IF NOT EXISTS label text;/);
  assert.match(sql, /ADD CONSTRAINT client_designs_slot_check CHECK \(slot BETWEEN 1 AND 4\);/);
  assert.match(sql, /ADD CONSTRAINT client_designs_home_slot_check CHECK \(kind = 'print' OR slot = 1\);/);
  assert.match(sql, /ADD CONSTRAINT client_designs_label_check CHECK \(label IS NULL OR char_length\(label\) <= 24\);/);
  for (const old of ['client_designs_event_id_key', 'client_designs_event_id_kind_key']) {
    assert.match(sql, new RegExp(`DROP CONSTRAINT IF EXISTS ${old};`));
  }
  assert.match(sql, /ADD CONSTRAINT client_designs_event_id_kind_slot_key UNIQUE \(event_id, kind, slot\);/);
  assert.doesNotMatch(sql, /UPDATE public\.client_designs/, 'aucune ligne existante modifiée hors défaut');
});

test('migration : idempotente (chaque contrainte ajoutée est d\'abord supprimée si elle existe)', () => {
  for (const [, table, name] of sql.matchAll(/ALTER TABLE public\.(\w+)\s+ADD CONSTRAINT (\w+)/g)) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} DROP CONSTRAINT IF EXISTS ${name};`), name);
  }
  assert.doesNotMatch(sql, /ADD COLUMN (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
});

test('migration : design_versions.slot et index par cadre', () => {
  assert.match(sql, /ALTER TABLE public\.design_versions ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;/);
  assert.match(sql, /ADD CONSTRAINT design_versions_slot_check CHECK \(slot BETWEEN 1 AND 4\);/);
  assert.match(sql, /DROP INDEX IF EXISTS public\.design_versions_event_kind_created;/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS design_versions_event_kind_slot_created\s+ON public\.design_versions \(event_id, kind, slot, created_at DESC\);/);
});

test('RPC borne : dernière définition, cadre au plus petit slot, frames sous condition stricte', () => {
  const defining = all.filter((f) => /CREATE OR REPLACE FUNCTION "?public"?\."?kiosk_get_approved_design"?/
    .test(readFileSync(join(MIGRATIONS, f), 'utf8')));
  // LAB-423 redéfinit la RPC pour comparer l'empreinte du secret : les règles valent pour la dernière définition.
  assert.ok(defining.includes(MIGRATION));
  assert.equal(defining.at(-1), '20270112000423_kiosk_secret_hash.sql');
  const latest = strip(readFileSync(join(MIGRATIONS, defining.at(-1)), 'utf8'));
  const start = latest.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_get_approved_design');
  const body = latest.slice(start, latest.indexOf('$$;', start));

  assert.match(body, /SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  assert.match(body, /AND d\.kind = 'print'\s+AND d\.status = 'approved'\s+AND e\.org_id = v_org\s+ORDER BY d\.slot\s+LIMIT 1;/);
  assert.match(body, /'label',\s+d\.label,/);
  assert.match(body, /e\.form_config #> '\{kiosk,frame_choice,enabled\}' = 'true'::jsonb/);
  assert.match(body, /'frames',\s+CASE WHEN v_frames THEN \(/);
  assert.match(body, /\) ORDER BY f\.slot\), '\[\]'::json\)/);
  assert.match(body, /AND f\.kind = 'print'\s+AND f\.status = 'approved'\s+AND f\.id <> d\.id/);
  for (const key of ['id', 'slot', 'label', 'format', 'canvas_json', 'final_png_url']) {
    assert.match(body, new RegExp(`'${key}',\\s+f\\.${key}`), key);
  }
});

test('RPC borne : droits inchangés (anon et service_role seulement)', () => {
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${esc(SIGNATURE)} FROM PUBLIC, anon, authenticated;`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${esc(SIGNATURE)} TO anon, service_role;`));
  assert.equal((sql.match(/GRANT /g) ?? []).length, 1);
});
