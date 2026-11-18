// LAB-312 : autosave-design écrit le cadre `slot` (1 par défaut), refuse un cadre au-delà de
// max_frames et supprime un cadre ajouté non validé (`delete: true`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('autosave-design : slot validé (1 par défaut), écran d\'accueil en slot 1 seulement', () => {
  assert.match(src, /const slot = parseDesignSlot\(body\.slot\);\s+if \(slot === null \|\| !slotAllowedForKind\(kind, slot\)\) return corsResponse\(400, \{ error: 'slot invalide' \}\);/);
});

test('autosave-design : cadre au-delà de max_frames (ou > 1 si le choix est coupé) → 403', () => {
  assert.match(src, /if \(!clientCanWriteSlot\(kind, slot, event\.form_config\)\) return corsResponse\(403, \{ error: FRAME_LIMIT_ERROR \}\);/);
  // Le contrôle passe avant toute écriture.
  assert.ok(src.indexOf('clientCanWriteSlot(kind, slot') < src.indexOf('.upsert('));
});

test('autosave-design : upsert par (event_id, kind, slot), nom du cadre écrit seulement s\'il est envoyé', () => {
  assert.match(src, /\{ event_id: event\.id, kind, slot, canvas_json, format, status: 'draft', \.\.\.\(label === undefined \? \{\} : \{ label \}\) \}/);
  assert.match(src, /const label = kind === 'print' \? parseFrameLabel\(body\.label\) : undefined;/);
});

test('autosave-design : suppression d\'un cadre ajouté, jamais du cadre 1 ni d\'un cadre validé', () => {
  assert.match(src, /const remove = body\.delete === true;/);
  assert.match(src, /if \(remove && !clientCanDeleteFrame\(kind, slot, undefined\)\) return corsResponse\(400, \{ error: FIRST_FRAME_ERROR \}\);/);
  // Après les contrôles de l'événement (archivé, expiré, fonctionnalité), avant l'écriture.
  const del = src.indexOf('if (remove) return await deleteFrame(db, event.id, slot);');
  assert.ok(del > src.indexOf("requireFeature(db, event.org_id, 'client_design')"));
  assert.ok(del < src.indexOf('.upsert('));
  const fn = src.slice(src.indexOf('async function deleteFrame'));
  assert.match(fn, /\.from\('client_designs'\)\s+\.delete\(\)\s+\.eq\('event_id', eventId\)\s+\.eq\('kind', 'print'\)\s+\.eq\('slot', slot\)\s+\.neq\('status', 'approved'\)/);
  assert.match(fn, /corsResponse\(409, \{ error: FRAME_LOCKED_ERROR \}\)/);
  assert.match(fn, /\.from\('design_versions'\)\s+\.delete\(\)\s+\.eq\('event_id', eventId\)\s+\.eq\('kind', 'print'\)\s+\.eq\('slot', slot\);/);
});

// LAB-323 : un seul envoi du brouillon, la version de l'historique est créée ici.
test('autosave-design : with_version enregistre la version après le brouillon, avec le même contenu', () => {
  const upsert = src.indexOf('.upsert(');
  const flag = src.indexOf("if (body.with_version !== true) return corsResponse(200, { design_id: design.id });");
  assert.ok(flag > upsert, 'la version suit le brouillon enregistré');
  const tail = src.slice(flag, src.indexOf('async function deleteFrame'));
  assert.match(tail, /\.from\('design_versions'\)\s+\.insert\(\{ event_id: event\.id, kind, slot, canvas_json, format, label: null \}\)/);
  // Version en échec : le brouillon reste enregistré, réponse 200 avec version null.
  assert.match(tail, /return corsResponse\(200, \{ design_id: design\.id, version: version \?\? null \}\);/);
});
