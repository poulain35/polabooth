import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseVersionRequest } from '../../supabase/functions/design-versions/logic.ts';

const src = readFileSync(new URL('./api/designs.js', import.meta.url), 'utf8');
const apiDir = new URL('./api/', import.meta.url);
const allApi = readdirSync(apiDir).map((f) => readFileSync(new URL(f, apiDir), 'utf8')).join('\n');
// Page de l'éditeur découpée (LAB-404) : EditorPage.jsx puis ses morceaux dans pages/editor/.
const editorPageParts = () => readdirSync(new URL('../pages/editor/', import.meta.url))
  .filter((f) => /\.jsx?$/.test(f)).sort().map((f) => `../pages/editor/${f}`);
const body = (fn) => {
  const start = src.indexOf(`export async function ${fn}(`);
  assert.ok(start >= 0, `${fn} introuvable`);
  const end = src.indexOf('\nexport ', start + 1);
  return src.slice(start, end === -1 ? undefined : end);
};

// LAB-115 : plus aucun accès direct à la table, la clé anon n'y a plus droit.
test('api/designs.js : l\'historique des versions passe par l\'edge function, pas par from(\'design_versions\')', () => {
  assert.doesNotMatch(allApi, /from\(['"]design_versions['"]\)/);
  for (const fn of ['saveDesignVersion', 'listDesignVersions', 'getDesignVersion']) {
    assert.match(body(fn), /callDesignVersionFunction\(\{\s*code, kind, action: '(save|list|get)'/, `${fn} doit passer par le code d'accès (et le kind, LAB-289)`);
  }
  assert.match(src, /function callDesignVersionFunction\(payload\) \{\s+return callFunction\('design-versions', \{ json: payload, /);
});

// Contrat front ↔ edge function : les corps envoyés par api/designs.js sont acceptés par le parseur.
test('corps envoyés par le front acceptés par design-versions', () => {
  const versionId = '0b4f6c2e-8a1d-4e5f-9c3b-2d7e6f1a0b9c';
  assert.match(body('getDesignVersion'), /version_id: versionId/);
  assert.match(body('saveDesignVersion'), /canvas_json: canvasJson, format, label:/);
  for (const payload of [
    { code: 'a3k9x2', action: 'list' },
    { code: 'a3k9x2', action: 'get', version_id: versionId },
    { code: 'a3k9x2', action: 'save', canvas_json: { objects: [] }, format: 'portrait', label: null },
    // LAB-289 : écran d'accueil.
    { code: 'a3k9x2', action: 'list', kind: 'home' },
    { code: 'a3k9x2', action: 'save', canvas_json: { objects: [] }, format: 'home', label: null, kind: 'home' },
  ]) {
    assert.equal(parseVersionRequest(payload).ok, true, JSON.stringify(payload));
  }
});

test('EditorPage : l\'historique est indexé par le code d\'accès, plus par l\'id d\'événement', () => {
  // Historique : pages/editor/HistoryPanel.jsx, lu avec la page.
  const page = ['../pages/EditorPage.jsx', ...editorPageParts()]
    .map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')).join('\n');
  // LAB-289 : un historique par design (kind print ou home).
  assert.match(page, /listDesignVersions\(code, kind, slot\)/);
  assert.match(page, /getDesignVersion\(code, v\.id, kind, slot\)/);
  // LAB-323 : la version part avec le brouillon (autosave-design with_version), un seul envoi.
  assert.match(page, /autosaveDesign\(\{\s*code, canvasJson, format: formatId, kind, slot, label, withVersion: true/);
  assert.doesNotMatch(page, /saveDesignVersion/);
  assert.match(page, /<HistoryPanel\s+code=\{code\}/);
  assert.doesNotMatch(page, /eventId/);
});
