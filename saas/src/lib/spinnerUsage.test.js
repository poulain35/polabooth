// Roue de chargement : une seule, <Spinner /> de components/ui/spinner.jsx (LAB-395, LAB-406).
// Jamais la chaîne « animate-spin rounded-full border-2 … » ni une roue SVG recopiée ; l'icône
// Loader2 (ou RefreshCw) qui tourne dans un bouton reste permise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(srcDir, { recursive: true })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => /\.jsx$/.test(f) && f !== 'components/ui/spinner.jsx');

test('aucune roue de chargement recopiée hors de ui/spinner', () => {
  assert.ok(files.length > 50);
  const copies = [];
  for (const f of files) {
    const s = readFileSync(srcDir + f, 'utf8');
    for (const m of s.matchAll(/<(\w+)\s+className=\{?[`"][^`"]*\banimate-spin\b[^`"]*[`"]/g)) {
      const tag = m[1];
      if (tag === 'Loader2' || tag === 'RefreshCw') continue;
      copies.push(`${f} : <${tag} …animate-spin…>`);
    }
  }
  assert.deepEqual(copies, []);
});
