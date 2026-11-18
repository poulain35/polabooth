// Stock de matériel (LAB-358) : tables equipment_types / equipment_items et events.equipment_needs.
// Migration 20261229000000_equipment_stock.sql ; vérification en base : supabase/tests/lab358_*.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAAS = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = join(SAAS, 'supabase', 'migrations');
const MIGRATION = '20261229000000_equipment_stock.sql';
const strip = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const sql = strip(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'));
const TABLES = ['equipment_types', 'equipment_items'];

test('migration : présente, timestamp unique, aucune donnée existante modifiée', () => {
  assert.ok(all.includes(MIGRATION));
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE FROM|TRUNCATE|DROP TABLE|INSERT INTO)/m);
  // Seule modification d'une table existante : la colonne events.equipment_needs et son CHECK.
  const alters = sql.match(/ALTER TABLE public\.(\w+)/g) ?? [];
  for (const a of alters) assert.match(a, /public\.(events|equipment_types|equipment_items)$/, a);
  assert.match(sql, /ALTER TABLE public\.events ADD COLUMN IF NOT EXISTS equipment_needs jsonb;/);
  assert.match(sql, /CHECK \(equipment_needs IS NULL OR jsonb_typeof\(equipment_needs\) = 'object'\)/);
});

test('contraintes de la spec', () => {
  assert.match(sql, /CHECK \(key ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$' AND length\(key\) <= 40\)/);
  assert.match(sql, /CONSTRAINT equipment_types_org_id_key_key UNIQUE \(org_id, key\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS equipment_types_one_default_idx\s+ON public\.equipment_types \(org_id\)\s+WHERE is_default AND archived_at IS NULL;/);
  assert.match(sql, /type_id\s+uuid\s+NOT NULL REFERENCES public\.equipment_types \(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CHECK \(status IN \('in_service', 'retired'\)\)/);
  assert.match(sql, /CHECK \(unavailable_until IS NULL OR unavailable_from IS NOT NULL\)/);
  assert.match(sql, /CHECK \(unavailable_until IS NULL OR unavailable_until >= unavailable_from\)/);
  assert.match(sql, /USING ERRCODE = '23514'/);
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`org_id\\s+uuid\\s+NOT NULL DEFAULT public\\.current_owner_org_id\\(\\)\\s+REFERENCES public\\.organizations \\(id\\) ON DELETE CASCADE[\\s\\S]*?trg_${t}_updated_at`));
  }
});

test("RLS : propriétaire de l'organisation seulement, aucun droit pour anon", () => {
  const owner = String.raw`org_id IN \(SELECT o\.id FROM public\.organizations o WHERE o\.owner_id = auth\.uid\(\)\)`;
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`));
    for (const op of ['select', 'insert', 'update', 'delete']) {
      const clause = op === 'insert' ? 'WITH CHECK' : 'USING';
      assert.match(sql, new RegExp(`CREATE POLICY ${t}_owner_${op}\\s+ON public\\.${t} FOR ${op.toUpperCase()} TO authenticated\\s+${clause} \\(\\s+${owner}\\s+\\)`), `${t} ${op}`);
    }
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated;`));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${t} TO authenticated;`));
    assert.match(sql, new RegExp(`GRANT ALL ON public\\.${t} TO service_role;`));
    assert.doesNotMatch(sql, new RegExp(`GRANT [^;]*ON public\\.${t} TO [^;]*\\banon\\b`));
  }
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 8);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
});

test('borne et .pola inchangés : aucune RPC de la borne ni get_public_event touchée', () => {
  assert.doesNotMatch(sql, /kiosk_get_event|get_public_event|kiosk_get_approved_design|kiosk_get_screens/);
  const bundle = readFileSync(join(SAAS, 'src', 'lib', 'polaBundle.js'), 'utf8');
  assert.doesNotMatch(bundle, /equipment/);
});

// Module privé « planning » (LAB-421, décision A5) : tables de la fonctionnalité, migration publiée.
// Dans le dépôt public, le manifeste n'a plus d'entrée planning.
test('features.json : tables du planning, migration publiée', () => {
  const manifest = JSON.parse(readFileSync(join(SAAS, 'supabase', 'features.json'), 'utf8'));
  const planning = manifest.features.planning;
  for (const t of TABLES) assert.ok(!manifest.features.core.tables.includes(t), t);
  if (!planning) return;
  for (const t of TABLES) assert.ok(planning.tables.includes(t), t);
  assert.ok(planning.published_migrations.includes(MIGRATION));
  assert.ok(!planning.migrations.includes(MIGRATION));
});
