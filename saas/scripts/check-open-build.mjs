// Open core (L2b) : vérifie qu'une construction sans modules privés (VITE_PRIVATE_MODULES=none)
// ne contient aucun code des modules de src/modules/<id>/.
// Usage : VITE_PRIVATE_MODULES=none npm run build && node scripts/check-open-build.mjs
//
// Marqueurs : les edge functions appelées par le code des modules (functions.invoke('x'),
// `${FUNCTIONS_URL}/x`) et que le code ouvert n'appelle pas. Aucun ne doit apparaître dans dist/.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(root, 'src');
const DIST = join(root, 'dist', 'assets');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const isCode = (p) => /\.(js|jsx)$/.test(p) && !/\.test\.js$/.test(p);
const calls = (text) => new Set([
  ...[...text.matchAll(/functions\.invoke\(\s*['"`]([\w-]+)['"`]/g)].map((m) => m[1]),
  ...[...text.matchAll(/FUNCTIONS_URL\}\/([\w-]+)/g)].map((m) => m[1]),
]);

const modulesDir = join(SRC, 'modules');
const privateCalls = new Set();
const openCalls = new Set();
for (const p of walk(SRC).filter(isCode)) {
  const target = p.startsWith(modulesDir) ? privateCalls : openCalls;
  for (const c of calls(readFileSync(p, 'utf8'))) target.add(c);
}
const markers = [...privateCalls].filter((c) => !openCalls.has(c)).sort();
// Dépôt public (export open core) : src/modules/ ne contient que index.js et brand.js, aucun module.
const hasModules = existsSync(modulesDir)
  && readdirSync(modulesDir).some((n) => statSync(join(modulesDir, n)).isDirectory());

if (!existsSync(DIST)) {
  console.error('dist/assets absent : lancer d\'abord VITE_PRIVATE_MODULES=none npm run build');
  process.exit(1);
}
if (!hasModules) {
  console.log('Aucun module privé dans src/modules/ : vérification des marqueurs sans objet.');
} else if (markers.length < 5) {
  console.error(`Trop peu de marqueurs privés trouvés (${markers.length}) : le script ne lit plus le bon code.`);
  process.exit(1);
}

const leaks = [];
for (const p of walk(DIST).filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(p, 'utf8');
  for (const m of markers) if (text.includes(`"${m}"`) || text.includes(`'${m}'`) || text.includes(`/${m}`)) leaks.push(`${m} dans ${p}`);
}
if (leaks.length) {
  console.error('Code de module privé présent dans la construction ouverte :\n  ' + leaks.join('\n  '));
  process.exit(1);
}
// Open core (L7) : aucune marque dans les fichiers texte de la construction ouverte (code, styles,
// pages, manifeste). Les images de public/ sont des fichiers binaires, hors de cette vérification.
const BRAND = /bo[iî]te\s*[àa]\s*pola|ch[aâ]teaugiron/i;
const TEXT = /\.(js|css|html|webmanifest|json|svg|txt|md|xml)$/i;
const DIST_ROOT = join(root, 'dist');
const branded = walk(DIST_ROOT).filter((p) => TEXT.test(p) && BRAND.test(readFileSync(p, 'utf8')));
if (branded.length) {
  console.error('Marque présente dans la construction ouverte :\n  ' + branded.join('\n  '));
  process.exit(1);
}
console.log(hasModules
  ? `Construction ouverte propre : ${markers.length} marqueurs privés absents (${markers.join(', ')}), aucune marque.`
  : 'Construction ouverte propre : aucune marque.');
