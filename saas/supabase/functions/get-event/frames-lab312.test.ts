// LAB-312 : get-event renvoie les cadres du modèle photo et frame_choice, sans changer la réponse
// d'un événement à un seul cadre (design = cadre 1, mêmes colonnes qu'avant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('get-event : cadres print triés par slot, cadre 1 seul si le choix est coupé', () => {
  assert.match(src, /const frameChoice = frameChoiceConfig\(form_config\);/);
  assert.match(src, /\.eq\('kind', 'print'\)\s+\.lte\('slot', frameChoice\.enabled \? MAX_FRAME_SLOTS : 1\)\s+\.order\('slot', \{ ascending: true \}\);/);
  assert.doesNotMatch(src, /\.eq\('kind', 'print'\)[^;]*\.maybeSingle\(\)/, 'plus de lecture à une ligne du modèle photo');
});

test('get-event : design = cadre 1 avec les colonnes d\'avant (id, canvas_json, format, status)', () => {
  assert.match(src, /find\(\(f: \{ slot: number \}\) => f\.slot === 1\)/);
  assert.match(src, /\? \{ id: first\.id, canvas_json: first\.canvas_json, format: first\.format, status: first\.status \}\s+: null;/);
});

test('get-event : frame_choice toujours renvoyé, frames seulement si le choix est actif', () => {
  const response = src.slice(src.lastIndexOf('return corsResponse(200'));
  assert.match(response, /frame_choice:\s+frameChoice,/);
  assert.match(response, /frames:\s+frameChoice\.enabled \? frames \?\? \[\] : null,/);
  assert.doesNotMatch(response, /form_config/);
});
