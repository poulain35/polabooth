// LAB-215 : suppression de kiosk_releases.is_target (version cible du parc, inutile depuis LAB-200 :
// mise à jour sur demande depuis le SaaS). Contrôles statiques de la migration et du code : plus
// rien ne lit la colonne hors des migrations historiques.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { IN_PUBLIC_REPO, PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261127000000_kiosk_releases_drop_is_target.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const raw = readPrivateHistory(new URL(MIGRATION, DIR));
const sql = strip(raw);
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const filesUnder = (dir: string, exts: RegExp): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !/[\\/](node_modules|bin|obj)[\\/]/.test(p));

test('migration : postérieure à 20261126000000, timestamp unique dans le dossier', { skip: PRIVATE_HISTORY }, () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(all.indexOf(MIGRATION) > all.indexOf('20261126000000_kiosk_photo_consent.sql'));
  assert.equal(all.filter((f) => f.startsWith('20261127000000')).length, 1);
});

test('migration : index puis colonne supprimés, idempotente, rien d\'autre', { skip: PRIVATE_HISTORY }, () => {
  const statements = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(statements, [
    'DROP INDEX IF EXISTS public.uniq_kiosk_release_target',
    'ALTER TABLE public.kiosk_releases DROP COLUMN IF EXISTS is_target',
  ]);
  assert.match(raw, /^-- LAB-215 /);
});

test('migrations : seules les historiques et celle-ci citent is_target', { skip: PRIVATE_HISTORY }, () => {
  const citing = readdirSync(DIR).filter((f) => f.endsWith('.sql'))
    .filter((f) => /is_target/i.test(readFileSync(new URL(f, DIR), 'utf8'))).sort();
  assert.deepEqual(citing, [
    '20260606000001_kiosk_releases.sql',
    '20261103000002_events_drop_anon_read.sql',
    '20261122000000_kiosk_update_request.sql',
    MIGRATION,
  ]);
  for (const f of citing.filter((f) => f !== MIGRATION && f !== '20260606000001_kiosk_releases.sql')) {
    assert.doesNotMatch(strip(readFileSync(new URL(f, DIR), 'utf8')), /is_target/i, `${f} : hors commentaire`);
  }
});

test('code et docs : plus aucune lecture ni mention de is_target (SaaS, edge functions, kiosk)', () => {
  const files = [
    ...filesUnder(join(ROOT, 'saas', 'src'), /\.(jsx?|tsx?)$/),
    ...filesUnder(join(ROOT, 'saas', 'supabase', 'functions'), /\.tsx?$/),
    ...filesUnder(join(ROOT, 'kiosk'), /\.(cs|xaml|json|ps1|md)$/),
    ...['saas/CLAUDE.md', 'CLAUDE.md'].map((p) => join(ROOT, p)),
    // Documentation privée, absente du dépôt public.
    ...(IN_PUBLIC_REPO ? [] : ['docs/securite-lab-112.md', 'docs/securite-lab-114.md',
      'docs/mise-en-prod-reservation.md'].map((p) => join(ROOT, p))),
  ].filter((p) => p !== SELF);
  assert.ok(files.length > 50, 'arborescence trouvée');
  const hits = files.filter((p) => /is_target|\bIsTarget\b/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(hits, []);
});
