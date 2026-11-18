// LAB-289 : get-event dit si l'onglet « Mon écran d'accueil » s'affiche et renvoie l'écran
// enregistré, sans exposer form_config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('get-event : form_config lu pour décider de l\'onglet, retiré de l\'événement renvoyé', () => {
  // Colonnes lues par eventByCode (LAB-392) : id et org_id ajoutés par le helper.
  assert.match(src, /columns: \['name', 'client_name', 'allowed_formats', 'status', 'start_date', 'end_date', 'form_config'\]/);
  assert.match(src, /const \{ form_config, org_id: orgId, \.\.\.event \} = found\.event;/);
  assert.match(src, /const homeEditor = homeEditorEnabled\(form_config\);/);
  const response = src.slice(src.lastIndexOf('return corsResponse(200'));
  assert.doesNotMatch(response, /form_config/);
  assert.doesNotMatch(response, /\brow\b/);
});

test('get-event : écran d\'accueil (kind home) lu seulement si l\'onglet est ouvert', () => {
  assert.match(src, /homeEditor\s+\? await db\s+\.from\('client_designs'\)\s+\.select\('id, canvas_json, format, status, final_png_url'\)\s+\.eq\('event_id', event\.id\)\s+\.eq\('kind', 'home'\)/);
  assert.match(src, /home_editor:\s+homeEditor,/);
  assert.match(src, /home_design:\s+homeDesign \?\? null,/);
  // Le modèle photo reste le design principal (cadre 1, LAB-312 : voir frames-lab312.test.ts).
  assert.match(src, /\.select\('id, slot, label, format, canvas_json, status'\)\s+\.eq\('event_id', event\.id\)\s+\.eq\('kind', 'print'\)/);
});
