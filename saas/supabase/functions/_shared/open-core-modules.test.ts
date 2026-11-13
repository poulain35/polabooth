// Open core, lot L3b : le code serveur partagé des fonctionnalités privées est rangé dans
// _shared/modules/<id>/. Aucune fonction d'une fonctionnalité ouverte ne doit l'atteindre, même
// indirectement : la version ouverte du dépôt se construit sans ce dossier.
// Les modules privés peuvent s'importer entre eux (ex. booking → invoicing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { FEATURES } from './features.ts';

interface Manifest { features: Record<string, { functions: string[] }> }

const FUNCTIONS_DIR = fileURLToPath(new URL('..', import.meta.url));
const MODULES_DIR = join(FUNCTIONS_DIR, '_shared', 'modules');
const MANIFEST = JSON.parse(readFileSync(fileURLToPath(new URL('../../features.json', import.meta.url)), 'utf8')) as Manifest;

const rel = (path: string) => relative(FUNCTIONS_DIR, path).split(sep).join('/');
const isModule = (path: string) => rel(path).startsWith('_shared/modules/');

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\1/g;

/** Imports relatifs d'un fichier (statiques, dynamiques, `export … from`), résolus en chemins absolus. */
function importsOf(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(IMPORT)].map((m) => resolve(dirname(path), m[2]));
}

/** Premier chemin d'imports qui mène de `entry` à un fichier de _shared/modules/, ou null. */
function pathToModule(entry: string): string[] | null {
  const seen = new Set<string>();
  const queue: string[][] = [[entry]];
  while (queue.length) {
    const chain = queue.shift()!;
    const file = chain.at(-1)!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) {
      if (isModule(next)) return [...chain, next].map(rel);
      if (existsSync(next) && !seen.has(next)) queue.push([...chain, next]);
    }
  }
  return null;
}

const entryFiles = (fn: string) => readdirSync(join(FUNCTIONS_DIR, fn))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => join(FUNCTIONS_DIR, fn, f));

const openFeatures = FEATURES.filter((f) => f.visibility === 'open').map((f) => f.id);
const privateFeatures = FEATURES.filter((f) => f.visibility === 'private').map((f) => f.id);
// Dépôt public (export open core) : pas de _shared/modules/, seules les règles d'import s'appliquent.
const NO_MODULES = !existsSync(MODULES_DIR) && '_shared/modules/ absent (dépôt public)';

test('modules privés : un dossier par fonctionnalité privée, rien d\'autre', { skip: NO_MODULES }, () => {
  const dirs = readdirSync(MODULES_DIR).filter((d) => statSync(join(MODULES_DIR, d)).isDirectory());
  assert.ok(dirs.length > 0);
  for (const d of dirs) assert.ok(privateFeatures.includes(d), `_shared/modules/${d} : pas une fonctionnalité privée`);
  assert.deepEqual(readdirSync(MODULES_DIR).filter((d) => !dirs.includes(d)), [], 'aucun fichier à la racine de modules/');
});

test('fonctions ouvertes : aucun import (même indirect) de _shared/modules/', () => {
  const offenders: string[] = [];
  for (const id of openFeatures) {
    for (const fn of MANIFEST.features[id]?.functions ?? []) {
      for (const entry of entryFiles(fn)) {
        const chain = pathToModule(entry);
        if (chain) offenders.push(`${id} / ${chain.join(' → ')}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('code partagé ouvert (_shared hors modules, hors tests) : aucun import de _shared/modules/', () => {
  const shared = join(FUNCTIONS_DIR, '_shared');
  const offenders = readdirSync(shared)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => pathToModule(join(shared, f)))
    .filter((chain): chain is string[] => chain !== null)
    .map((chain) => chain.join(' → '));
  assert.deepEqual(offenders, []);
});

test('le parcours détecte bien un import indirect (garde-fou du test)', { skip: NO_MODULES }, () => {
  const gcal = join(FUNCTIONS_DIR, 'booking-gcal-sync', 'index.ts');
  assert.deepEqual(pathToModule(gcal)?.at(-1), '_shared/modules/booking/gcal-booking.ts');
});
