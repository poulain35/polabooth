// LAB-356 : aperçus des modèles rangés dans le stockage (parties pures du script).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addResult, emptyStats, parseArgs, previewNeedsStorage, reportLines, USAGE } from './convert-template-previews-lib.mjs';

test('arguments : essai à blanc par défaut, --apply, --page, erreurs', () => {
  assert.deepEqual(parseArgs([]), { apply: false, page: 20, help: false });
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.equal(parseArgs(['--page', '5']).page, 5);
  assert.equal(parseArgs(['-h']).help, true);
  assert.match(parseArgs(['--page', '0']).error, /--page/);
  assert.match(parseArgs(['--page', 'abc']).error, /--page/);
  assert.match(parseArgs(['--force']).error, /Option inconnue/);
  assert.match(USAGE, /--apply/);
});

test('aperçu à ranger : data URL ou adresse Replicate ; https stable, vide ou null gardés', () => {
  assert.equal(previewNeedsStorage('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(previewNeedsStorage('https://replicate.delivery/abc/out.png'), true);
  assert.equal(previewNeedsStorage('https://x.supabase.co/storage/v1/object/public/designs/templates/previews/a.jpg'), false);
  assert.equal(previewNeedsStorage(null), false);
  assert.equal(previewNeedsStorage(''), false);
});

test('compteurs et rapport : essai à blanc, puis seconde passe sans rien à faire', () => {
  const s = emptyStats();
  for (const o of ['skipped', 'converted', 'converted', 'failed', 'conflict']) addResult(s, o);
  assert.deepEqual(s, { rows: 5, toConvert: 4, converted: 2, conflicts: 1, failed: 1 });
  const dry = reportLines(s, { apply: false });
  assert.match(dry[0], /Essai à blanc/);
  assert.match(dry[1], /4 aperçu\(s\) à ranger, 2 rangeable/);
  assert.match(dry[1], /1 impossible/);
  assert.match(dry[1], /relancer/);
  assert.throws(() => addResult(emptyStats(), 'bizarre'));

  const second = emptyStats();
  addResult(second, 'skipped');
  const lines = reportLines(second, { apply: true });
  assert.match(lines[0], /Conversion appliquée/);
  assert.match(lines.at(-1), /Rien à faire/);
});
