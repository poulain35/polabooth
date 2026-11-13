import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVersionRequest } from '../../supabase/functions/design-versions/logic.ts';

const src = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
const body = (fn) => {
  const start = src.indexOf(`export async function ${fn}(`);
  assert.ok(start >= 0, `${fn} introuvable`);
  const end = src.indexOf('\nexport ', start + 1);
  return src.slice(start, end === -1 ? undefined : end);
};

// LAB-115 : plus aucun accès direct à la table, la clé anon n'y a plus droit.
test('supabase.js : l\'historique des versions passe par l\'edge function, pas par from(\'design_versions\')', () => {
  assert.doesNotMatch(src, /from\(['"]design_versions['"]\)/);
  for (const fn of ['saveDesignVersion', 'listDesignVersions', 'getDesignVersion']) {
    assert.match(body(fn), /callDesignVersionFunction\(\{\s*code, action: '(save|list|get)'/, `${fn} doit passer par le code d'accès`);
  }
  assert.match(src, /\$\{FUNCTIONS_URL\}\/design-versions`/);
});

// Contrat front ↔ edge function : les corps envoyés par supabase.js sont acceptés par le parseur.
test('corps envoyés par le front acceptés par design-versions', () => {
  const versionId = '0b4f6c2e-8a1d-4e5f-9c3b-2d7e6f1a0b9c';
  assert.match(body('getDesignVersion'), /version_id: versionId/);
  assert.match(body('saveDesignVersion'), /canvas_json: canvasJson, format, label:/);
  for (const payload of [
    { code: 'a3k9x2', action: 'list' },
    { code: 'a3k9x2', action: 'get', version_id: versionId },
    { code: 'a3k9x2', action: 'save', canvas_json: { objects: [] }, format: 'portrait', label: null },
  ]) {
    assert.equal(parseVersionRequest(payload).ok, true, JSON.stringify(payload));
  }
});

test('EditorPage : l\'historique est indexé par le code d\'accès, plus par l\'id d\'événement', () => {
  const page = readFileSync(new URL('../pages/EditorPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /listDesignVersions\(code\)/);
  assert.match(page, /getDesignVersion\(code, v\.id\)/);
  assert.match(page, /saveDesignVersion\(\{ code, canvasJson/);
  assert.match(page, /<HistoryPanel\s+code=\{code\}/);
  assert.doesNotMatch(page, /eventId/);
});
