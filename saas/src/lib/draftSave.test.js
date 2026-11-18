// LAB-323 : sauvegarde fiable des gros brouillons de l'éditeur /e/:code (contrats statiques).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const lib = readFileSync(new URL('./api/designs.js', import.meta.url), 'utf8');
const helper = readFileSync(new URL('./functionCall.js', import.meta.url), 'utf8');
const apiDir = new URL('./api/', import.meta.url);
const allApi = readdirSync(apiDir).map((f) => readFileSync(new URL(f, apiDir), 'utf8')).join('\n');
const page = readFileSync(new URL('../pages/EditorPage.jsx', import.meta.url), 'utf8');
const fn = (name) => {
  const start = lib.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return lib.slice(start, lib.indexOf('\nexport ', start + 1));
};

test('autosaveDesign : délai maximal, nouvel essai et file unique', () => {
  const body = fn('autosaveDesign');
  assert.match(body, /_saveQueue\.enqueue\(key, /);
  assert.match(body, /sendWithRetry\(\(signal\) => _postJson\('autosave-design', body, signal\)/);
  assert.match(body, /timeoutMs: saveTimeoutMs\(body\.length\)/);
  // fetch reçoit le signal d'annulation : _postJson le passe à callFunction (LAB-420), qui le transmet.
  assert.match(lib, /callFunction\(path, \{ body, signal, fallback: 'Erreur sauvegarde' \}\)/);
  assert.match(helper, /fetchImpl\(`\$\{baseUrl\}\/\$\{path\}`, \{ method, headers, body: payload, signal \}\)/, 'fetch reçoit le signal d\'annulation');
  // Brouillon sérialisé une fois, réutilisé pour chaque essai et pour la comparaison.
  assert.equal(body.match(/JSON\.stringify\(\{\s*code, canvas_json: canvasJson/g)?.length, 1);
  assert.match(body, /with_version: true/);
});

test('autosaveDesign : second envoi seulement si la fonction ne renvoie pas de version', () => {
  const body = fn('autosaveDesign');
  assert.match(body, /if \(withVersion && result\.version === undefined\)/);
  assert.match(body, /_postJson\('design-versions', versionBody, signal\)/);
});

test('autosaveDesign : plus d\'attente artificielle avant l\'envoi', () => {
  assert.doesNotMatch(allApi, /AUTOSAVE_DEBOUNCE_MS/);
});

test('EditorPage : échec affiché sans alert, état « modifié » gardé si le contenu a changé pendant l\'envoi', () => {
  assert.doesNotMatch(page, /alert\(`Erreur lors de la sauvegarde/);
  assert.match(page, /setSaveNotice\(\{ tone: 'error', message: userErrorMessage\(err, /);
  assert.match(page, /onRetry: \(\) => setSaveNotice\(\{ tone: 'warning', message: SAVE_RETRY_MESSAGE \}\)/);
  assert.match(page, /if \(unchanged\(savedKey\)\) \{\s+editor\?\.markClean\(\);/);
});
