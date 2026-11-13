// Manifeste supabase/features.json (open core, lot L3) : complet pour les fonctions, sans doublon pour
// les tables, et chaque fonction d'une fonctionnalité non-socle porte sa garde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { FEATURES } from './features.ts';

interface Entry { functions: string[]; tables: string[]; crons: string[]; migrations?: string[] }
interface Manifest { features: Record<string, Entry>; always_on: { functions: string[]; crons: string[] } }

const FUNCTIONS_DIR = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(fileURLToPath(new URL('../../features.json', import.meta.url)), 'utf8')) as Manifest;
const entries = Object.entries(MANIFEST.features);
// Dépôt public (export open core) : ni _shared/modules/ ni fonctionnalités privées dans le manifeste.
const PRIVATE_INSTALLED = existsSync(join(FUNCTIONS_DIR, '_shared', 'modules'));
const expectedFeatures = FEATURES.filter((f) => PRIVATE_INSTALLED || f.visibility !== 'private');

const folders = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared').map((d) => d.name).sort();

const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/--[^\n]*/g, ''));
const namesOf = (re: RegExp) => new Set(migrations.flatMap((sql) => [...sql.matchAll(re)].map((m) => m[1].toLowerCase())));
// Tables : « public.x » ou, dans la migration de base du dépôt public (pg_dump), « "public"."x" ».
const created = namesOf(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/gi);
const dropped = namesOf(/drop\s+table\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/gi);
const scheduled = namesOf(/cron\.schedule\(\s*'([\w-]+)'/gi);

const dupes = (list: string[]) => list.filter((x, i) => list.indexOf(x) !== i);

test('manifeste : une entrée par fonctionnalité du catalogue, dans le même ordre', () => {
  assert.deepEqual(entries.map(([id]) => id), expectedFeatures.map((f) => f.id));
});

test('fonctions : chaque dossier (hors _shared) apparaît exactement une fois', () => {
  const listed = entries.flatMap(([, e]) => e.functions);
  assert.deepEqual(dupes(listed), []);
  assert.deepEqual([...listed].sort(), folders);
});

test('tables : chaque table créée par les migrations apparaît au plus une fois, aucune table inventée', () => {
  const listed = entries.flatMap(([, e]) => e.tables);
  assert.deepEqual(dupes(listed), []);
  for (const t of listed) assert.ok(created.has(t) && !dropped.has(t), `${t} : absente des migrations`);
  const orphans = [...created].filter((t) => !dropped.has(t) && !listed.includes(t)).sort();
  if (orphans.length) console.log(`tables sans fonctionnalité : ${orphans.join(', ')}`);
});

test('tâches planifiées : jobs pg_cron réels, fonction de la même fonctionnalité ou purge toujours active', () => {
  for (const [id, e] of entries) {
    for (const job of e.crons) {
      assert.ok(scheduled.has(job), `${job} : jamais planifié`);
      assert.ok(e.functions.includes(job) || MANIFEST.always_on.crons.includes(job), `${id} / ${job}`);
    }
  }
  assert.deepEqual(MANIFEST.always_on.crons.filter((j) => !entries.some(([, e]) => e.crons.includes(j))), []);
});

const guardOf = (feature: string) => new RegExp(
  `(requireFeature|requireInstanceFeature|cronFeatureGate)\\([^;]*'${feature}'|isFeatureEnabled\\([^)]*'${feature}'\\)`,
);
const sources = (fn: string) => readdirSync(join(FUNCTIONS_DIR, fn))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => readFileSync(join(FUNCTIONS_DIR, fn, f), 'utf8')).join('\n');

test('gardes : chaque fonction non-socle vérifie sa fonctionnalité (sauf exceptions documentées)', () => {
  if (PRIVATE_INSTALLED) {
    const bookingHttp = readFileSync(join(FUNCTIONS_DIR, '_shared', 'modules', 'booking', 'booking-http.ts'), 'utf8');
    assert.match(bookingHttp, guardOf('booking'), 'handlePublic / servePublic');
  }
  for (const [id, e] of entries) {
    if (FEATURES.find((f) => f.id === id)!.core) continue;
    for (const fn of e.functions) {
      if (MANIFEST.always_on.functions.includes(fn)) continue;
      const src = sources(fn);
      const viaPublic = id === 'booking' && /\b(servePublic|handlePublic)\(/.test(src);
      assert.ok(viaPublic || guardOf(id).test(src), `${fn} : garde '${id}' absente`);
    }
  }
});

test('socle : aucune garde de fonctionnalité dans les fonctions du socle', () => {
  for (const [id, e] of entries) {
    if (!FEATURES.find((f) => f.id === id)!.core) continue;
    for (const fn of e.functions) assert.doesNotMatch(sources(fn), /requireFeature\(|requireInstanceFeature\(|cronFeatureGate\(/, fn);
  }
});

// ── Migrations privées postérieures à la base du dépôt public (open core, étape 3) ─────────────────
// La migration de base (<horodatage>_base.sql) remplace, dans le dépôt public, toutes les migrations
// antérieures, sans les objets privés. Elle est dans open-core/migrations/ ici, dans supabase/migrations/
// une fois exportée. Toute migration postérieure qui crée ou modifie un objet privé est déclarée dans le
// champ `migrations` de sa fonctionnalité privée, pour que l'export l'écarte.
// Heuristique (sans analyseur SQL) : une migration est privée si, hors commentaires, elle nomme en
// position de table (public.x, ou x après FROM, JOIN, INTO, UPDATE, TABLE, REFERENCES, ON) une table
// d'une fonctionnalité privée absente de la base, ou planifie une tâche pg_cron privée absente de la
// base. Les colonnes privées des tables ouvertes et les fonctions SQL privées ne sont pas détectées :
// la règle « une migration ne mélange jamais ouvert et privé » reste à tenir à la main.
const ROOT_BASE_DIR = fileURLToPath(new URL('../../../../open-core/migrations', import.meta.url));
const findBase = (dir: string) => {
  try { return readdirSync(dir).filter((f) => /^\d{14}_base\.sql$/.test(f)); } catch { return []; }
};
const rootBases = findBase(ROOT_BASE_DIR);
const publicBases = findBase(MIGRATIONS_DIR);
const inPublicRepo = rootBases.length === 0 && publicBases.length > 0;
const baseFile = inPublicRepo ? join(MIGRATIONS_DIR, publicBases[0]) : join(ROOT_BASE_DIR, rootBases[0] ?? '');
const baseName = inPublicRepo ? publicBases[0] : rootBases[0];
const skipBase = baseName ? false : 'pas de migration de base (open-core/migrations/<horodatage>_base.sql)';

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const privateIds = FEATURES.filter((f) => f.visibility === 'private').map((f) => f.id);
const migrationNames = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

test('migrations privées : une seule base, champ réservé aux fonctionnalités privées, noms réels et postérieurs à la base', { skip: skipBase }, () => {
  assert.equal(inPublicRepo ? publicBases.length : rootBases.length, 1, 'une seule migration de base');
  const declared: string[] = [];
  for (const [id, e] of entries) {
    if (!privateIds.includes(id)) {
      assert.equal(e.migrations, undefined, `${id} : fonctionnalité ouverte, pas de champ migrations`);
      continue;
    }
    assert.ok(Array.isArray(e.migrations), `${id} : champ migrations attendu (liste, éventuellement vide)`);
    declared.push(...e.migrations!);
  }
  assert.deepEqual(dupes(declared), []);
  for (const name of declared) {
    assert.ok(name > baseName!, `${name} : antérieure à la base ${baseName}, déjà couverte par elle`);
    // Dans le dépôt public, les migrations privées sont absentes par construction.
    if (!inPublicRepo) assert.ok(migrationNames.includes(name), `${name} : absente de supabase/migrations/`);
  }
});

test('migrations privées : toute migration postérieure à la base qui touche une table ou une tâche privée est déclarée', { skip: skipBase }, () => {
  const base = stripComments(readFileSync(baseFile, 'utf8'));
  const inBase = (re: RegExp) => new Set([...base.matchAll(re)].map((m) => m[1].toLowerCase()));
  const baseTables = inBase(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/gi);
  const baseCrons = inBase(/cron\.schedule\(\s*'([\w-]+)'/gi);
  const privateEntries = entries.filter(([id]) => privateIds.includes(id)).map(([, e]) => e);
  const tables = privateEntries.flatMap((e) => e.tables).filter((t) => !baseTables.has(t));
  const crons = privateEntries.flatMap((e) => e.crons).filter((j) => !baseCrons.has(j));
  const tableRef = tables.length
    ? new RegExp(String.raw`(?:\bpublic"?\.|\b(?:from|join|into|update|table|references|on)\s+)"?(?:${tables.join('|')})"?\b`, 'i')
    : null;
  const cronRef = crons.length ? new RegExp(String.raw`cron\.(?:un)?schedule\(\s*'(?:${crons.join('|')})'`, 'i') : null;
  const declared = new Set(privateEntries.flatMap((e) => e.migrations ?? []));
  const missing = migrationNames.filter((name) => name > baseName! && !declared.has(name)).filter((name) => {
    const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    return tableRef?.test(sql) || cronRef?.test(sql);
  });
  assert.deepEqual(missing, [], 'à déclarer dans le champ migrations de leur fonctionnalité privée (features.json)');
});
