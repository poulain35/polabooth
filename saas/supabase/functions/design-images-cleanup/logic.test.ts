// Tests de la logique pure du ménage des images des modèles (LAB-356) : chemins, ancienneté,
// références (texte JSON entier), décision, et déroulé complet sur un faux stockage.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance, aucun réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chunk, cleanupCutoff, DEFAULT_LIMITS, eligibleCandidates, isOldEnough, parseImagePath, parseReferencePage,
  planDeletion, REFERENCE_SOURCES, ReferenceIndex, runCleanup,
  type CandidateRow, type CleanupStore,
} from './logic.ts';

const NOW = new Date('2026-12-27T03:30:00Z');
const CUTOFF = cleanupCutoff(NOW);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const EVENT = '0b6c2d1e-3f4a-4b5c-8d9e-0123456789ab';
const sha = (c: string) => c.repeat(64);
const A = sha('a');
const B = sha('b');
const C = sha('c');
const D = sha('d');
const E = sha('e');
const url = (path: string) => `https://x.supabase.co/storage/v1/object/public/designs/${path}`;
const old = (name: string, d = 30): CandidateRow => ({ name, created_at: daysAgo(d), updated_at: daysAgo(d) });

test('chemins : seuls images/ et previews/ du bucket, nom = empreinte ; le reste est ignoré', () => {
  assert.deepEqual(parseImagePath(`${EVENT}/images/${A}.png`), { folder: 'event', eventId: EVENT, sha: A, ext: 'png' });
  assert.deepEqual(parseImagePath(`templates/images/${B}.jpg`), { folder: 'templates', eventId: null, sha: B, ext: 'jpg' });
  assert.deepEqual(parseImagePath(`templates/previews/${C}.webp`), { folder: 'previews', eventId: null, sha: C, ext: 'webp' });
  for (const name of [
    `${EVENT}/final.png`, // PNG final : jamais
    `${EVENT}/${A}.png`,
    `${EVENT}/images/${A}.gif`,
    `${EVENT}/images/${A.slice(1)}.png`,
    `${EVENT}/images/${A.toUpperCase()}.png`,
    `${EVENT}/images/sub/${A}.png`,
    `templates/other/${A}.png`,
    `templates/images/${A}.png.bak`,
    `../templates/images/${A}.png`,
    `x/${EVENT}/images/${A}.png`,
    null,
    42,
  ]) assert.equal(parseImagePath(name), null, String(name));
});

test('ancienneté : plus de 7 jours à la création ET à la dernière réécriture ; date illisible → gardée', () => {
  assert.equal(CUTOFF, '2026-12-20T03:30:00.000Z');
  assert.equal(isOldEnough({ name: '', created_at: daysAgo(8), updated_at: daysAgo(8) }, CUTOFF), true);
  assert.equal(isOldEnough({ name: '', created_at: daysAgo(8), updated_at: null }, CUTOFF), true);
  assert.equal(isOldEnough({ name: '', created_at: daysAgo(6), updated_at: daysAgo(6) }, CUTOFF), false);
  assert.equal(isOldEnough({ name: '', created_at: daysAgo(30), updated_at: daysAgo(1) }, CUTOFF), false, 'réécrite récemment');
  assert.equal(isOldEnough({ name: '', created_at: daysAgo(7), updated_at: daysAgo(7) }, CUTOFF), false, 'pile 7 jours');
  assert.equal(isOldEnough({ name: '', created_at: null, updated_at: daysAgo(30) }, CUTOFF), false);
  assert.equal(isOldEnough({ name: '', created_at: 'hier', updated_at: null }, CUTOFF), false);
  assert.equal(isOldEnough({ name: '', created_at: daysAgo(30), updated_at: 'n/a' }, CUTOFF), false);
});

test('références : empreinte exacte, en majuscules ou dans une suite plus longue', () => {
  const index = new ReferenceIndex();
  index.add([A, B.toUpperCase(), `0123${C}`, 'abc', 'zz'.repeat(40)]);
  assert.equal(index.has(A), true);
  assert.equal(index.has(B), true);
  assert.equal(index.has(C), true);
  assert.equal(index.has(D), false);
  assert.equal(index.size, 3);
});

test('réponse des références : validée, toute forme inattendue lève', () => {
  assert.deepEqual(parseReferencePage({ rows: 2, last_id: 'id-2', runs: [A] }), { rows: 2, lastId: 'id-2', runs: [A] });
  assert.deepEqual(parseReferencePage({ rows: 0, last_id: null, runs: [] }), { rows: 0, lastId: null, runs: [] });
  for (const bad of [null, 'x', {}, { rows: -1, runs: [] }, { rows: 1.5, last_id: 'a', runs: [] },
    { rows: 2, last_id: null, runs: [] }, { rows: 1, last_id: 'a', runs: null }, { rows: 1, last_id: 'a', runs: [1] },
    { rows: 1, last_id: 3, runs: [] }]) {
    assert.throws(() => parseReferencePage(bad), JSON.stringify(bad));
  }
});

test('décision : supprimable seulement si ancienne, bien rangée et citée nulle part', () => {
  const index = new ReferenceIndex();
  index.add([A, C]);
  const rows: CandidateRow[] = [
    old(`${EVENT}/images/${A}.png`), // citée → gardée
    old(`${EVENT}/images/${B}.png`), // non citée → supprimée
    old(`templates/previews/${C}.jpg`), // citée → gardée
    old(`templates/images/${D}.webp`), // non citée → supprimée
    { name: `templates/images/${E}.png`, created_at: daysAgo(30), updated_at: daysAgo(2) }, // trop récente
    old(`${EVENT}/final.png`), // hors dossiers → jamais
  ];
  assert.equal(eligibleCandidates(rows, CUTOFF).length, 4);
  assert.deepEqual(planDeletion(rows, index, CUTOFF), {
    deletable: [`${EVENT}/images/${B}.png`, `templates/images/${D}.webp`],
    used: 2,
  });
});

test('chunk : lots de taille fixe', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('liste blanche : mêmes tables dans logic.ts et dans la migration', () => {
  const sql = readFileSync(new URL('../../migrations/20261228000000_design_images_cleanup.sql', import.meta.url), 'utf8');
  const listed = /p_source = ANY \(ARRAY\[([^\]]*)\]/.exec(sql)?.[1] ?? '';
  const tables = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(tables, [...REFERENCE_SOURCES]);
  for (const t of ['client_designs', 'design_versions', 'templates', 'kiosk_screens']) assert.ok(REFERENCE_SOURCES.includes(t), t);
  assert.match(sql, /cron_http_post\('design-images-cleanup', 'design-images-cleanup'/);
  assert.match(sql, /\^\(\[0-9a-f-\]\{36\}\/images\|templates\/\(images\|previews\)\)\/\[0-9a-f\]\{64\}/);
});

// ── Déroulé complet sur un faux stockage ─────────────────────────────────────────────────────────

/**
 * Faux stockage : objets du bucket et lignes des tables (texte JSON entier). Les empreintes sont
 * extraites comme le fait design_image_references (suites de 64+ caractères hexadécimaux).
 */
function fakeStore(objects: CandidateRow[], tables: Record<string, string[]>, opts: {
  failCandidates?: boolean; failSource?: string; failRemove?: boolean; touchDuringScan?: string; badPage?: string;
} = {}) {
  const removed: string[] = [];
  let candidateCalls = 0;
  const store: CleanupStore = {
    async candidates(cutoff, limit, names) {
      candidateCalls++;
      if (opts.failCandidates) throw new Error('stockage indisponible');
      return objects
        .filter((o) => !removed.includes(o.name))
        .filter((o) => !names || names.includes(o.name))
        .filter((o) => o.created_at! < cutoff && (o.updated_at ?? o.created_at)! < cutoff)
        .slice(0, limit)
        .map((o) => ({ ...o })); // copies, comme une vraie réponse
    },
    async references(source, after, limit) {
      if (opts.failSource === source) throw new Error(`${source} : lecture impossible`);
      if (opts.badPage === source) return { rows: 'beaucoup' };
      if (opts.touchDuringScan && source === 'templates') {
        const o = objects.find((x) => x.name === opts.touchDuringScan)!;
        o.updated_at = NOW.toISOString(); // renvoyée pendant le parcours (upsert)
      }
      const rows = (tables[source] ?? []).map((body, i) => ({ id: `id-${String(i).padStart(4, '0')}`, body }));
      const page = rows.filter((r) => after === null || r.id > after).slice(0, limit);
      const runs = [...new Set(page.flatMap((r) => (r.body.match(/[0-9a-fA-F]{64,}/g) ?? []).map((s) => s.toLowerCase())))];
      return { rows: page.length, last_id: page.at(-1)?.id ?? null, runs };
    },
    async remove(paths) {
      if (opts.failRemove) throw new Error('suppression refusée');
      removed.push(...paths);
    },
  };
  return { store, removed, calls: () => candidateCalls };
}

const LIMITS = { ...DEFAULT_LIMITS, pageRows: 2 };

function scenario() {
  const objects = [
    old(`${EVENT}/images/${A}.png`), // dans canvas_json d'un design (groupe imbriqué)
    old(`${EVENT}/images/${B}.png`), // seulement dans une version de l'historique
    old(`templates/images/${C}.jpg`), // dans un motif (pattern) d'un modèle de la bibliothèque
    old(`templates/previews/${D}.jpg`), // aperçu d'un modèle (preview_url)
    old(`${EVENT}/images/${E}.png`), // retirée de partout il y a plus de 7 jours → supprimée
    old(`${EVENT}/images/${sha('f')}.webp`, 3), // retirée mais trop récente → gardée
    old(`${EVENT}/final-print.png`), // PNG final → jamais
  ];
  const design = JSON.stringify({
    objects: [{ type: 'group', objects: [{ type: 'image', src: url(`${EVENT}/images/${A}.png`) }] }],
    backgroundImage: null,
  });
  const tables = {
    client_designs: [JSON.stringify({ id: 'd1', kind: 'print', slot: 1, canvas_json: design })],
    design_versions: [
      JSON.stringify({ id: 'v1', canvas_json: { objects: [] } }),
      JSON.stringify({ id: 'v2', canvas_json: { objects: [{ clipPath: { src: `${EVENT}/images/${B}.png` } }] } }),
      JSON.stringify({ id: 'v3', canvas_json: { objects: [] } }),
    ],
    templates: [JSON.stringify({
      id: 't1',
      preview_url: url(`templates/previews/${D}.jpg`),
      canvas_json: { objects: [{ fill: { type: 'pattern', source: url(`templates/images/${C}.jpg`) } }] },
    })],
    kiosk_screens: [],
    events: [JSON.stringify({ id: 'e1', form_config: { kiosk: {} } })],
  };
  return { objects, tables };
}

test('passage complet : images citées (design, historique, modèle, aperçu) gardées, image orpheline supprimée', async () => {
  const { objects, tables } = scenario();
  const { store, removed } = fakeStore(objects, tables);
  const summary = await runCleanup(store, NOW, LIMITS);
  assert.deepEqual(removed, [`${EVENT}/images/${E}.png`]);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.used, 4);
  assert.equal(summary.candidates, 5);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.scanned.design_versions, 3, 'toutes les pages lues');
  assert.equal(summary.scanned.decorations, 0);

  // Second passage : plus rien à supprimer.
  const again = await runCleanup(store, NOW, LIMITS);
  assert.equal(again.deleted, 0);
  assert.deepEqual(removed, [`${EVENT}/images/${E}.png`]);
});

test('en cas de doute, on garde : erreur de stockage ou de base, réponse illisible → rien supprimé', async () => {
  for (const opts of [{ failCandidates: true }, { failSource: 'design_versions' }, { failSource: 'decorations' }, { badPage: 'kiosk_screens' }]) {
    const { objects, tables } = scenario();
    const { store, removed } = fakeStore(objects, tables, opts);
    await assert.rejects(runCleanup(store, NOW, LIMITS), JSON.stringify(opts));
    assert.deepEqual(removed, [], JSON.stringify(opts));
  }
});

test('parcours trop long ou pagination bloquée → rien supprimé', async () => {
  const { objects, tables } = scenario();
  let t = 0;
  const slow = fakeStore(objects, tables);
  await assert.rejects(runCleanup(slow.store, NOW, { ...LIMITS, scanBudgetMs: 10 }, () => (t += 6)), /trop long/);
  assert.deepEqual(slow.removed, []);

  const stuck = fakeStore(objects, tables);
  stuck.store.references = async () => ({ rows: 1, last_id: 'id-0000', runs: [] });
  await assert.rejects(runCleanup(stuck.store, NOW, LIMITS), /pagination bloquée/);
  assert.deepEqual(stuck.removed, []);
});

test('image renvoyée pendant le parcours (date de réécriture récente) : gardée', async () => {
  const { objects, tables } = scenario();
  const { store, removed, calls } = fakeStore(objects, tables, { touchDuringScan: `${EVENT}/images/${E}.png` });
  const summary = await runCleanup(store, NOW, LIMITS);
  assert.deepEqual(removed, []);
  assert.equal(summary.deleted, 0);
  assert.equal(calls(), 2, 'nouvelle vérification avant la suppression');
});

test('rien de candidat : aucune table parcourue ; échec de suppression : noté, 500', async () => {
  const empty = fakeStore([old(`${EVENT}/final.png`)], {});
  let scanned = false;
  const references = empty.store.references;
  empty.store.references = async (...args) => { scanned = true; return references(...args); };
  const s = await runCleanup(empty.store, NOW, LIMITS);
  assert.equal(s.candidates, 0);
  assert.equal(scanned, false);

  const { objects, tables } = scenario();
  const failing = fakeStore(objects, tables, { failRemove: true });
  const summary = await runCleanup(failing.store, NOW, LIMITS);
  assert.equal(summary.deleted, 0);
  assert.match(summary.errors[0], /suppression refusée/);
});
