// Page « Écrans de la borne » (LAB-317) : garde de sortie, contrôles en direct, relecture après
// une publication échouée, nettoyage des images importées, .pola d'une autre org. Tests statiques
// (le branchement React et Supabase n'a pas de banc de test) ; la logique pure est testée ailleurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const page = read('../pages/admin/AdminKioskScreens.jsx');
// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');
const editor = readEditor();
const api = read('./api/kioskScreens.js');
const pola = read('./api/pola.js');

const fnBody = (src, signature) => {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end);
};

test('garde : menu, retour et fermeture de l’onglet demandent confirmation si le contenu a changé', () => {
  assert.match(page, /useBlocker\(\(\{ currentLocation, nextLocation \}\) =>\s*currentLocation\.pathname !== nextLocation\.pathname && isDirtyNow\(\)\)/);
  assert.match(page, /addEventListener\('beforeunload', handler\)/);
  assert.match(page, /if \(!isDirtyNow\(\)\) return;/);
  assert.match(page, /<UnsavedChangesModal\s+onSave=\{saveAndLeave\}/);
  assert.match(page, /if \(await saveDraft\(\)\) blocker\.proceed/);
  // Point de départ repris au chargement et après chaque enregistrement ou publication.
  assert.equal((page.match(/rememberSaved\(cur\.state/g) ?? []).length, 3);
  assert.match(read('../pages/EditorPage.jsx'), /import UnsavedChangesModal from '\.\.\/components\/UnsavedChangesModal'/);
});

test('contrôles relancés à chaque modification, annulation ou rétablissement', () => {
  assert.match(page, /onChange=\{onChange\}/);
  assert.match(page, /checksTimerRef\.current = setTimeout\(\(\) => \{\s*const state = editorState\(\);\s*if \(state\) runChecks\(state\);/);
  for (const fn of ['function saveHistorySnapshot', 'const undo = useCallback', 'const redo = useCallback']) {
    const start = editor.indexOf(fn);
    assert.ok(start >= 0, fn);
    assert.ok(editor.slice(start, start + 900).includes('onChangeRef.current?.()'), `${fn} prévient la page`);
  }
});

test('Vérifier et Publier restent visibles : les toasts de l’éditeur partent en bas', () => {
  const editorView = page.slice(page.indexOf('function ScreenEditorView'));
  const calls = editorView.match(/toast\.(success|error)\(/g) ?? [];
  const placed = editorView.match(/toast\.(success|error)\([\s\S]*?EDITOR_TOAST/g) ?? [];
  assert.ok(calls.length >= 5);
  assert.equal(placed.length, calls.length);
  assert.match(page, /const EDITOR_TOAST = \{ position: 'bottom-center' \}/);
});

test('publication échouée : la ligne est relue (numéro réservé perdu)', () => {
  assert.match(page, /toast\.error\(userErrorMessage\(err, 'Publication impossible\.'\), EDITOR_TOAST\);\s*await reloadRow\(\);/);
  assert.match(page, /setRow\(kind, await getKioskScreen\(c\.orgId, kind\)\)/);
  assert.match(api, /export async function getKioskScreen\(orgId, kind\)/);
});

test('échec réseau : message en français, jamais « Failed to fetch » brut (LAB-317)', () => {
  assert.match(page, /import \{ userErrorMessage \} from '\.\.\/\.\.\/lib\/networkError'/);
  assert.doesNotMatch(page, /err\.message/);
  assert.equal((page.match(/userErrorMessage\(err, '/g) ?? []).length, 4);
});

test('images importées inutiles supprimées à l’enregistrement (donc aussi à la publication)', () => {
  const save = fnBody(api, 'export async function saveKioskScreenDraft');
  assert.match(save, /await cleanupScreenAssets\(orgId, draft, keepAssets\);/);
  const cleanup = fnBody(api, 'async function cleanupScreenAssets');
  assert.match(cleanup, /search: 'screen-asset-'/);
  assert.match(cleanup, /select\('draft_json, published'\)\.eq\('org_id', orgId\)/);
  assert.match(cleanup, /referencedScreenFiles\(rows\)/);
  assert.match(fnBody(api, 'export async function publishKioskScreen'), /saveKioskScreenDraft\(orgId, kind, state, \{ previewDataUrl, keepAssets \}\)/);
  assert.equal((page.match(/keepAssets: \[\.\.\.sessionAssetsRef\.current\]/g) ?? []).length, 2);
});

test('.pola : écrans et questionnaire suivent l’org de l’événement, pas celle de l’utilisateur', () => {
  const exportFn = fnBody(pola, 'export async function exportPolaFile');
  assert.match(exportFn, /polaScreenImages\(event\.org_id\)/);
  assert.match(exportFn, /from\('organizations'\)\.select\('features'\)\.eq\('id', event\.org_id\)/);
  assert.doesNotMatch(exportFn, /getOrgFeatures\(/);
});
