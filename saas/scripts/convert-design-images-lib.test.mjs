// LAB-348 : conversion des images intégrées des modèles existants (parties pures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRow, convertCanvasJson, emptyStats, formatBytes, jsonBytes, parseArgs, reportLines, scopeForRow, TABLES,
} from './convert-design-images-lib.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const svg = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';

const design = {
  bg: '#fff',
  objects: [
    { type: 'rect', isPhotoZone: true },
    { type: 'image', src: png },
    { type: 'group', objects: [{ type: 'image', src: jpg }, { type: 'image', src: png }] },
    { type: 'image', src: svg },
  ],
};

const fakeStore = (urls) => async (src) => urls[src] ?? null;

test('arguments : essai à blanc par défaut, --apply, --table, --page', () => {
  assert.deepEqual(parseArgs([]), { apply: false, tables: [...TABLES], page: 5, help: false });
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.deepEqual(parseArgs(['--table', 'templates']).tables, ['templates']);
  assert.equal(parseArgs(['--page', '20']).page, 20);
  assert.ok(parseArgs(['--table', 'events']).error);
  assert.ok(parseArgs(['--page', '0']).error);
  assert.ok(parseArgs(['--force']).error);
});

test('dossier : celui de l’événement, ou le dossier commun des modèles', () => {
  assert.deepEqual(scopeForRow('templates', { id: 't' }), { kind: 'templates' });
  assert.deepEqual(scopeForRow('client_designs', { event_id: 'e' }), { kind: 'event', eventId: 'e' });
  assert.throws(() => scopeForRow('design_versions', { id: 'v' }));
});

test('conversion : images rangées dans les groupes, même forme (objet ou chaîne), plus léger', async () => {
  const store = fakeStore({ [png]: 'https://s/p.png', [jpg]: 'https://s/j.jpg' });

  const asObject = await convertCanvasJson(design, store);
  assert.equal(asObject.changed, true);
  assert.equal(asObject.stored, 2);
  assert.equal(asObject.failed, 1, 'SVG non rangé');
  assert.equal(typeof asObject.value, 'object');
  assert.equal(asObject.value.objects[1].src, 'https://s/p.png');
  assert.equal(asObject.value.objects[1].crossOrigin, 'anonymous');
  assert.equal(asObject.value.objects[2].objects[0].src, 'https://s/j.jpg');
  assert.equal(asObject.value.objects[2].objects[1].src, 'https://s/p.png');
  assert.equal(asObject.value.objects[3].src, svg, 'repli : laissé intégré');
  assert.equal(design.objects[1].src, png, 'pas de mutation');

  const asString = await convertCanvasJson(JSON.stringify(design), store);
  assert.equal(typeof asString.value, 'string');
  assert.equal(JSON.parse(asString.value).objects[1].src, 'https://s/p.png');
  assert.equal(asString.before, jsonBytes(design));
  assert.ok(asString.after < asString.before);
});

test('idempotent : une ligne déjà convertie ou sans image est laissée telle quelle', async () => {
  let calls = 0;
  const store = async () => { calls++; return 'https://s/x.png'; };
  const converted = await convertCanvasJson(design, store);
  calls = 0;
  const again = await convertCanvasJson(
    { ...converted.value, objects: converted.value.objects.filter((o) => o.src !== svg) }, store);
  assert.equal(again.changed, false);
  assert.equal(calls, 0);
  for (const value of [null, undefined, '{pas du json', { objects: [{ type: 'rect' }] }]) {
    const r = await convertCanvasJson(value, store);
    assert.equal(r.changed, false);
    assert.equal(r.value, value);
  }
  // Aucun envoi réussi : rien à écrire, l'échec est compté.
  const none = await convertCanvasJson(design, async () => null);
  assert.equal(none.changed, false);
  assert.equal(none.failed, 3);
});

test('rapport : lignes, images, tailles avant/après, conflits', async () => {
  const stats = emptyStats();
  const r = await convertCanvasJson(design, fakeStore({ [png]: 'https://s/p.png', [jpg]: 'https://s/j.jpg' }));
  addRow(stats, r);
  addRow(stats, await convertCanvasJson({ objects: [] }, fakeStore({})));
  addRow(stats, r, false);
  assert.equal(stats.rows, 3);
  assert.equal(stats.withImages, 2);
  assert.equal(stats.converted, 1);
  assert.equal(stats.conflicts, 1);
  assert.equal(stats.failedImages, 2);
  assert.equal(stats.after, r.after + jsonBytes({ objects: [] }) + r.before);

  const dry = reportLines({ templates: stats, client_designs: emptyStats() }, { apply: false });
  assert.match(dry[0], /Essai à blanc/);
  assert.match(dry[1], /templates : 3 ligne\(s\) lue\(s\), 2 avec des images intégrées, 1 à convertir/);
  assert.match(dry[1], /relancer le script/);
  assert.match(dry.at(-1), /^- Total : 3 ligne/);
  assert.match(reportLines({ templates: stats }, { apply: true })[1], /1 converties/);

  assert.equal(formatBytes(512), '512 o');
  assert.equal(formatBytes(1536), '1,5 Ko');
  assert.equal(formatBytes(26 * 1024 * 1024), '26 Mo');
});
