// Mode sombre de l'admin (LAB-340) : aucune couleur neutre en dur dans les écrans de l'admin.
// Les neutres passent par les tokens du thème (bg-card, bg-muted, text-foreground, text-muted-foreground,
// border-border…), sinon ils restent clairs en mode sombre. Les couleurs d'état gardent leur variante dark:.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAAS = fileURLToPath(new URL('../../', import.meta.url));

// Écrans de l'admin. Les dossiers des modules privés manquent dans la version ouverte : ignorés.
const ROOTS = [
  'src/pages/admin',
  'src/components/admin',
  'src/modules/booking/pages/admin',
  'src/modules/booking/pages/BookingDecision.jsx',
  'src/modules/booking/dashboard.jsx',
  'src/modules/booking/components/LeadStatusBadge.jsx',
  'src/modules/invoicing',
  'src/modules/audio_guestbook/AudioSection.jsx',
  'src/modules/audio_guestbook/pages/admin',
  'src/modules/prospects/pages/admin',
];

// Pages qui restent en clair : preuve d'acceptation imprimée (page autonome, hors admin).
const EXCLUDED = new Set(['src/modules/booking/pages/admin/AcceptanceProof.jsx']);

// Couleurs fixes voulues, avec leur nombre exact de lignes : un ajout fait échouer le test.
const FIXED = {
  // Bloc « Configuration SQL » : bloc de code sombre dans les deux modes.
  'src/pages/admin/AdminFonts.jsx': 5,
};

const NEUTRAL = /\b(?:bg|text|border|divide|ring|outline|placeholder|from|via|to|fill|stroke)-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b|\bbg-white(?![\w/-])/;

function listFiles(path) {
  const abs = join(SAAS, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [path];
  return readdirSync(abs).flatMap((name) => listFiles(`${path}/${name}`));
}

const files = [...new Set(ROOTS.flatMap(listFiles))]
  .filter((f) => /\.(jsx|js)$/.test(f) && !f.endsWith('.test.js') && !EXCLUDED.has(f));

function neutralLines(file) {
  return readFileSync(join(SAAS, file), 'utf8')
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    // Un îlot clair (.light-island) garde ses couleurs : la variante dark: n'y s'applique pas.
    .filter(({ line }) => NEUTRAL.test(line) && !line.includes('light-island'));
}

test('écrans de l’admin trouvés', () => {
  assert.ok(files.some((f) => f === 'src/pages/admin/AdminLayout.jsx'));
  assert.ok(files.length > 40, `${files.length} fichiers seulement`);
});

test('aucune couleur neutre en dur dans l’admin (tokens du thème, LAB-340)', () => {
  const offenders = [];
  for (const file of files) {
    const lines = neutralLines(file);
    const allowed = FIXED[file] ?? 0;
    if (lines.length > allowed) {
      offenders.push(`${relative(SAAS, join(SAAS, file))} (${lines.length} au lieu de ${allowed}) :\n`
        + lines.slice(0, 5).map(({ n, line }) => `  ${n}: ${line.slice(0, 140)}`).join('\n'));
    }
  }
  assert.deepEqual(offenders, [], 'Remplacer par bg-card, bg-muted, text-foreground, text-muted-foreground, border-border… :\n'
    + offenders.join('\n'));
});

test('liste des couleurs fixes à jour', () => {
  for (const [file, count] of Object.entries(FIXED)) {
    if (!existsSync(join(SAAS, file))) continue;
    assert.equal(neutralLines(file).length, count, `${file} : ajuster FIXED`);
  }
});

test('le motif repère les neutres et laisse passer les tokens', () => {
  for (const bad of ['bg-white', 'text-gray-500', 'border-slate-200', 'hover:bg-gray-50', 'divide-zinc-100']) {
    assert.ok(NEUTRAL.test(`className="${bad}"`), bad);
  }
  for (const ok of ['bg-white/20', 'bg-card', 'text-muted-foreground', 'text-white', 'bg-amber-50 dark:bg-amber-950/40']) {
    assert.ok(!NEUTRAL.test(`className="${ok}"`), ok);
  }
});
