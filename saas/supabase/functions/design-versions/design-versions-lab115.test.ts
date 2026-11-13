// LAB-115 : design_versions n'est plus lisible ni modifiable avec la clé anon. L'éditeur /e/:code
// passe par l'edge function design-versions (code d'accès exigé, débit limité).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261106001500_design_versions_drop_anon.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const read = (f: string) => strip(readFileSync(new URL(f, DIR), 'utf8'));
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const OWNER = /event_id IN \(\s*SELECT e\.id FROM public\.events e\s+JOIN public\.organizations o ON o\.id = e\.org_id\s+WHERE o\.owner_id = auth\.uid\(\)\s*\)/;

test('migration : présente, après LAB-112, timestamp unique', { skip: PRIVATE_HISTORY }, () => {
  assert.ok(all.includes(MIGRATION));
  assert.ok(MIGRATION > '20261103000002_events_drop_anon_read.sql');
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('migration : policies publiques supprimées, plus aucun droit anon', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(MIGRATION);
  assert.match(sql, /DROP POLICY IF EXISTS "design_versions_public_read" ON public\.design_versions;/);
  assert.match(sql, /DROP POLICY IF EXISTS "design_versions_public_insert" ON public\.design_versions;/);
  assert.match(sql, /REVOKE ALL ON public\.design_versions FROM anon;/);
  assert.doesNotMatch(sql, /TO (public|anon)\b/i);
  assert.doesNotMatch(sql, /GRANT[^;]*\banon\b/i);
});

test('migration : admin connecté limité aux événements de son organisation, lecture et ajout seulement', { skip: PRIVATE_HISTORY }, () => {
  const sql = read(MIGRATION);
  assert.match(sql, /REVOKE ALL ON public\.design_versions FROM authenticated;/);
  assert.match(sql, /GRANT SELECT, INSERT ON public\.design_versions TO authenticated;/);
  const select = sql.slice(sql.indexOf('CREATE POLICY "design_versions_owner_select"'));
  assert.match(select, /^CREATE POLICY "design_versions_owner_select"\s+ON public\.design_versions FOR SELECT TO authenticated\s+USING \(/);
  assert.match(select.slice(0, select.indexOf(';')), OWNER);
  const insert = sql.slice(sql.indexOf('CREATE POLICY "design_versions_owner_insert"'));
  assert.match(insert, /^CREATE POLICY "design_versions_owner_insert"\s+ON public\.design_versions FOR INSERT TO authenticated\s+WITH CHECK \(/);
  assert.match(insert.slice(0, insert.indexOf(';')), OWNER);
  assert.doesNotMatch(sql, /FOR (UPDATE|DELETE|ALL)\b/);
});

test('aucune migration postérieure ne rouvre design_versions à anon / public', () => {
  for (const f of all.filter((x) => x > MIGRATION)) {
    const sql = read(f);
    if (!/design_versions/.test(sql)) continue;
    assert.doesNotMatch(sql, /GRANT[^;]*ON (TABLE )?(public\.)?design_versions[^;]*\b(anon|PUBLIC)\b/i, f);
    assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON (public\.)?design_versions(?![^;]*TO (authenticated|service_role))[^;]*;/i, f);
  }
});

test('edge function : code d\'accès exigé, publicGuard avec échecs de code, événement archivé ou expiré refusé', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /publicGuard\('design-versions'/);
  assert.match(src, /LIMITS\.designVersionsCode, request\.code\], \[LIMITS\.designVersionsIp, guard\.ip\]/);
  assert.match(src, /\{ codeFailures: true \}/);
  assert.match(src, /await guard\.codeFailed\(\)/);
  assert.match(src, /\.eq\('access_code', request\.code\)/);
  assert.match(src, /event\.status === 'archived'/);
  assert.match(src, /templateLinkExpired\(event\.end_date\)/);
  // L'événement vient du code, jamais d'un event_id fourni par le client.
  assert.doesNotMatch(src, /body\.event_id|event_id:/);
  assert.match(src, /runVersionRequest\(db, event\.id, request\)/);
});

test('config.toml : design-versions appelée sans JWT (clé anon seule, comme autosave-design)', () => {
  const toml = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\.design-versions\]\s*\nverify_jwt = false/);
});

test('kiosk : aucune lecture de design_versions', () => {
  const root = fileURLToPath(new URL('../../../../kiosk/', import.meta.url));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['bin', 'obj', '.vs', 'native', 'node_modules'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(cs|xaml|json)$/.test(name) && readFileSync(p, 'utf8').includes('design_versions')) hits.push(p);
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
