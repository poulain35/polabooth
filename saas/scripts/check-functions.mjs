#!/usr/bin/env node
/**
 * Vérification de type des edge functions (LAB-100) : `deno check` sur chaque
 * supabase/functions/<nom>/index.ts (et, par le graphe d'imports, _shared/ et les modules voisins).
 *
 *   npm run check:functions [-- <nom> ...]
 *
 * Deno vient de `npx deno` (aucune installation globale requise).
 * `--node-modules-dir=none` : sans cela, Deno détecte saas/package.json et exige que les imports
 * `npm:` (@aws-sdk/*) soient dans saas/node_modules, qui ne contient que les dépendances du front.
 * Les paquets npm sont alors résolus depuis le cache global de Deno, comme au déploiement.
 * `--no-lock` : pas de deno.lock parasite écrit dans saas/.
 */

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');

const wanted = process.argv.slice(2);
const names = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FUNCTIONS, d.name, 'index.ts')))
  .map((d) => d.name)
  .filter((n) => !wanted.length || wanted.includes(n))
  .sort();

const unknown = wanted.filter((n) => !names.includes(n));
if (unknown.length) {
  console.error(`Fonction(s) introuvable(s) : ${unknown.join(', ')}`);
  process.exit(2);
}

console.log(`deno check : ${names.length} fonction(s)`);
const result = spawnSync(
  'npx',
  ['--yes', 'deno', 'check', '--node-modules-dir=none', '--no-lock', ...names.map((n) => `${n}/index.ts`)],
  { cwd: FUNCTIONS, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
