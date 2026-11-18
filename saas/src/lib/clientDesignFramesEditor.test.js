// Plusieurs cadres dans l'éditeur du client (LAB-313, lot C3 de docs/specs/choix-cadre-invite.md) :
// règles pures de src/lib/clientDesignFrames.js et branchement de lib/api/designs.js / EditorPage.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  canAddFrame, canDeleteFrame, clampFrameLabel, designKey, editorFrameChoice, frameDisplayName, frameDraft,
  frameFields, frameFormatChoices, frameLabelForRequest, frameStatusLabel, framesToSubmit, initialFrames,
  newFrame, nextFrameSlot, parseDesignKey, slotAfterDelete,
} from './clientDesignFrames.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');
const frame = (slot, status = 'draft', extra = {}) => ({ ...newFrame(slot, 'portrait'), saved: true, status, ...extra });

test('editorFrameChoice : actif seulement avec enabled === true et une liste frames', () => {
  assert.deepEqual(editorFrameChoice({ frame_choice: { enabled: true, max_frames: 3 }, frames: [] }), { enabled: true, max_frames: 3 });
  assert.deepEqual(editorFrameChoice({ frame_choice: { enabled: true }, frames: [] }), { enabled: true, max_frames: 2 });
  assert.deepEqual(editorFrameChoice({ frame_choice: { enabled: true, max_frames: 9 }, frames: [] }), { enabled: true, max_frames: 2 });
  // Choix coupé ou réponse d'avant LAB-312 : éditeur d'un seul design.
  assert.deepEqual(editorFrameChoice({ frame_choice: { enabled: false, max_frames: 3 }, frames: null }), { enabled: false, max_frames: 1 });
  assert.deepEqual(editorFrameChoice({ frame_choice: { enabled: 'true', max_frames: 3 }, frames: [] }), { enabled: false, max_frames: 1 });
  assert.deepEqual(editorFrameChoice({ frame_choice: { enabled: true, max_frames: 3 }, frames: null }), { enabled: false, max_frames: 1 });
  assert.deepEqual(editorFrameChoice({ event: {}, design: null }), { enabled: false, max_frames: 1 });
  assert.deepEqual(editorFrameChoice(undefined), { enabled: false, max_frames: 1 });
});

test('frameFields : rien sans slot (corps identiques à avant), slot et label sinon', () => {
  assert.deepEqual(frameFields({}), {});
  assert.deepEqual(frameFields({ slot: undefined, label: undefined }), {});
  assert.deepEqual(frameFields({ slot: null, label: 'X' }), {});
  assert.deepEqual(frameFields(), {});
  assert.deepEqual(frameFields({ slot: 1 }), { slot: 1 });
  assert.deepEqual(frameFields({ slot: 2, label: 'Mariage' }), { slot: 2, label: 'Mariage' });
  assert.deepEqual(frameFields({ slot: 3, label: null }), { slot: 3, label: null });
  // JSON.stringify : sans slot, le corps est octet pour octet celui d'avant LAB-313.
  const before = JSON.stringify({ code: 'ABC', canvas_json: {}, format: 'portrait', kind: 'print' });
  const after  = JSON.stringify({ code: 'ABC', canvas_json: {}, format: 'portrait', kind: 'print', ...frameFields({ slot: undefined, label: undefined }) });
  assert.equal(after, before);
});

test('designKey / parseDesignKey : une clé par cadre, home à part', () => {
  assert.equal(designKey('print'), 'print:1');
  assert.equal(designKey('print', 3), 'print:3');
  assert.equal(designKey('home', 2), 'home');
  assert.deepEqual(parseDesignKey('print:3'), { kind: 'print', slot: 3 });
  assert.deepEqual(parseDesignKey('home'), { kind: 'home', slot: 1 });
  assert.deepEqual(parseDesignKey('print:x'), { kind: 'print', slot: 1 });
  for (const slot of [1, 2, 3, 4]) assert.deepEqual(parseDesignKey(designKey('print', slot)), { kind: 'print', slot });
});

test('nom du cadre : 24 caractères au plus, emojis comptés pour un, null si vide', () => {
  assert.equal(clampFrameLabel('a'.repeat(30)), 'a'.repeat(24));
  assert.equal(clampFrameLabel('a'.repeat(24)), 'a'.repeat(24));
  assert.equal(Array.from(clampFrameLabel('🎉'.repeat(30))).length, 24);
  assert.equal(clampFrameLabel('Mariage '), 'Mariage ', 'espace gardé pendant la frappe');
  assert.equal(clampFrameLabel(null), '');
  assert.equal(frameLabelForRequest('  Champêtre  '), 'Champêtre');
  assert.equal(frameLabelForRequest('   '), null);
  assert.equal(frameLabelForRequest(''), null);
  assert.equal(frameLabelForRequest(undefined), null);
  assert.equal(frameLabelForRequest('b'.repeat(40)), 'b'.repeat(24));
  assert.equal(frameDisplayName({ slot: 2, label: '' }), 'Cadre 2');
  assert.equal(frameDisplayName({ slot: 2, label: '  ' }), 'Cadre 2');
  assert.equal(frameDisplayName({ slot: 2, label: 'Bande' }), 'Bande');
});

test('frameFormatChoices : formats de l\'événement seulement, formats d\'impression, sans doublon', () => {
  assert.deepEqual(frameFormatChoices(['stripV', 'portrait']), ['stripV', 'portrait']);
  assert.deepEqual(frameFormatChoices(['portrait', 'home', 'kiosk_home', 'portrait']), ['portrait']);
  assert.deepEqual(frameFormatChoices(null), ['portrait', 'landscape', 'stripV', 'stripH']);
  assert.deepEqual(frameFormatChoices([]), ['portrait', 'landscape', 'stripV', 'stripH']);
});

test('max_frames : pas de 4e cadre avec 3 cadres ouverts, premier numéro libre sinon', () => {
  const three = [frame(1), frame(2), frame(3)];
  assert.equal(nextFrameSlot(three, 3), null);
  assert.equal(canAddFrame(three, 3), false);
  assert.equal(canAddFrame(three, 4), true);
  assert.equal(nextFrameSlot(three, 4), 4);
  assert.equal(nextFrameSlot([frame(1), frame(3)], 3), 2, 'trou après une suppression');
  assert.equal(nextFrameSlot([frame(1)], 2), 2);
  assert.equal(nextFrameSlot([frame(1), frame(2)], 2), null);
  assert.equal(nextFrameSlot([frame(1)], 1), null, 'choix coupé : un seul cadre');
  assert.equal(nextFrameSlot([frame(1)], 9), 2);
  assert.equal(nextFrameSlot([frame(1), frame(2), frame(3), frame(4)], 9), null, 'jamais plus de 4');
  // Admin qui baisse max_frames sous le nombre de cadres : rien à ajouter.
  assert.equal(canAddFrame([frame(1), frame(2), frame(3)], 2), false);
});

test('initialFrames : triés, cadre 1 vide ajouté au besoin, numéros hors 1 à 4 ignorés', () => {
  const list = initialFrames([
    { id: 'b', slot: 3, label: 'Bande', format: 'stripV', status: 'submitted', canvas_json: {} },
    { id: 'a', slot: 1, label: null, format: 'portrait', status: 'approved' },
    { id: 'z', slot: 7, format: 'portrait', status: 'draft' },
  ]);
  assert.deepEqual(list, [
    { slot: 1, id: 'a', label: '', format: 'portrait', status: 'approved', saved: true },
    { slot: 3, id: 'b', label: 'Bande', format: 'stripV', status: 'submitted', saved: true },
  ]);
  assert.deepEqual(initialFrames([]), [newFrame(1, null)]);
  assert.deepEqual(initialFrames(null), [newFrame(1, null)]);
  assert.deepEqual(initialFrames([{ id: 'c', slot: 2, format: 'portrait', status: 'draft' }]).map((f) => f.slot), [1, 2]);
});

test('frameDraft : canvas_json et format du cadre', () => {
  const formats = { portrait: { id: 'portrait' } };
  assert.deepEqual(frameDraft({ canvas_json: { a: 1 }, format: 'portrait' }, formats), { key: 0, json: { a: 1 }, format: { id: 'portrait' } });
  assert.deepEqual(frameDraft({ canvas_json: null, format: 'inconnu' }, formats), { key: 0, json: null, format: null });
});

test('suppression : ni le cadre 1, ni un cadre validé ; retour au cadre précédent', () => {
  assert.equal(canDeleteFrame(frame(1)), false);
  assert.equal(canDeleteFrame(frame(2, 'approved')), false);
  assert.equal(canDeleteFrame(frame(2, 'rejected')), true);
  assert.equal(canDeleteFrame(frame(3, 'submitted')), true);
  assert.equal(canDeleteFrame({ ...newFrame(2, 'portrait') }), true, 'cadre pas encore enregistré');
  assert.equal(canDeleteFrame(null), false);
  assert.equal(slotAfterDelete([frame(1), frame(2), frame(4)], 4), 2);
  assert.equal(slotAfterDelete([frame(1), frame(3)], 3), 1);
});

test('« Envoyer mes cadres » : tous les cadres non validés et ouverts, dans l\'ordre', () => {
  const list = [frame(3, null), frame(1, 'draft'), frame(2, 'approved'), frame(4, 'rejected')];
  assert.deepEqual(framesToSubmit(list, 4), [1, 3, 4]);
  assert.deepEqual(framesToSubmit(list, 3), [1, 3], 'cadre au-delà de max_frames : jamais envoyé (403)');
  assert.deepEqual(framesToSubmit([frame(1, 'submitted'), frame(2, 'submitted')], 2), [1, 2], 'renvoi possible');
  assert.deepEqual(framesToSubmit([frame(1, 'approved')], 2), []);
  assert.equal(frameStatusLabel('approved'), 'Validé');
  assert.equal(frameStatusLabel('submitted'), 'Envoyé');
  assert.equal(frameStatusLabel('rejected'), 'À corriger');
  assert.equal(frameStatusLabel('draft'), null);
  assert.equal(frameStatusLabel(null), null);
});

test('api/designs.js : les 5 fonctions de design transmettent slot (et label) par frameFields', () => {
  const src = read('./api/designs.js');
  const body = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  // LAB-323 : corps sérialisé une fois dans autosaveDesign (with_version en plus), une file par cadre.
  assert.match(src, /export function autosaveDesign\(\{ code, canvasJson, format, kind = 'print', slot, label, withVersion = false, onRetry \}\)/);
  assert.match(body('autosaveDesign'), /JSON\.stringify\(\{\s+code, canvas_json: canvasJson, format, kind, \.\.\.frameFields\(\{ slot, label \}\),/);
  assert.match(body('autosaveDesign'), /const key = `\$\{code\}\|\$\{kind\}\|\$\{slot \?\? 1\}`;/, 'une file par cadre');
  assert.match(body('saveDesignVersion'), /\.\.\.frameFields\(\{ slot \}\)/);
  assert.match(src, /export async function listDesignVersions\(code, kind = 'print', slot\)/);
  assert.match(body('listDesignVersions'), /action: 'list', \.\.\.frameFields\(\{ slot \}\)/);
  assert.match(src, /export async function getDesignVersion\(code, versionId, kind = 'print', slot\)/);
  assert.match(body('getDesignVersion'), /version_id: versionId, \.\.\.frameFields\(\{ slot \}\)/);
  assert.match(src, /export async function submitDesign\(\{ code, canvasJson, format, pngBase64, kind = 'print', slot, label, notify = true \}\)/);
  assert.match(body('submitDesign'), /\.\.\.frameFields\(\{ slot, label \}\),\s+\.\.\.\(notify === false \? \{ notify: false \} : \{\}\),/,
    'LAB-322 : notify envoyé seulement quand il vaut false (corps inchangé sinon)');
  // Suppression d'un cadre : autosave-design { delete: true }, pas de nouvelle fonction.
  assert.match(body('deleteDesignFrame'), /requestFunction\('autosave-design', \{ json: \{ code, kind: 'print', slot, delete: true \} \}\)/);
});

test('EditorPage : slot envoyé seulement quand le choix du cadre est ouvert', () => {
  const page = read('../pages/EditorPage.jsx');
  assert.match(page, /const choice = editorFrameChoice\(response\);/);
  assert.match(page, /const slot = frameMode && kind === 'print' \? keySlot : undefined;/);
  assert.match(page, /const label = slot === undefined \? undefined : frameLabelForRequest\(/);
  assert.match(page, /await autosaveDesign\(\{\s+code, canvasJson, format: formatId, kind, slot, label, withVersion: true,/);
  assert.match(page, /slot=\{activeFrame \? slot : undefined\}/, 'historique du cadre affiché');
  // Envoi groupé : un submit-design par cadre, slot = n, nom du cadre.
  assert.match(page, /kind: 'print', slot, label: frameLabelForRequest\(labels\[slot\]\),/);
  assert.match(page, /framesToSubmit\(frames, frameChoice\.max_frames\)/);
  // LAB-322 : un seul email à l'admin, demandé par le dernier cadre de la file (reprise comprise).
  assert.match(page, /for \(const \[index, slot\] of queue\.entries\(\)\)/);
  assert.match(page, /notify: index === queue\.length - 1,/);
  assert.match(page, /submitLabel=\{activeFrame \? 'Envoyer mes cadres' : null\}/);
  assert.match(page, /onSubmitRequest=\{activeFrame \? /);
  // Ajout : jamais au-delà de max_frames, formats de l'événement.
  assert.match(page, /canAdd=\{canAddFrame\(frames, frameChoice\.max_frames\)\}/);
  assert.match(page, /allowedFormats=\{frameFormatChoices\(event\?\.allowed_formats\)\}/);
});

test('Editor : bouton d\'envoi délégué à la page et export exposé (LAB-313)', () => {
  const editor = readEditor();
  assert.match(editor, /onClick=\{\(\) => \(onSubmitRequest \? onSubmitRequest\(\) : setShowSubmitConfirm\(true\)\)\}/);
  assert.match(editor, /exportPng: \(\) => \(fabricRef\.current \? exportAsHighResPNG\(fabricRef\.current, currentFormat\) : null\)/);
  // Libellé du bouton : règle dans editorMobile.js (LAB-351), testée dans editorMobile.test.js.
  assert.match(editor, /submitButtonLabels\(\{ isSubmitting, submitLabel, homeMode \}\)/);
  assert.match(read('./editorMobile.js'), /submitLabel \?\? \(homeMode \? 'Envoyer mon écran' : 'Valider mon design'\)/);
  // Carte d'accueil : pas répétée sur les cadres 2 à 4.
  assert.match(editor, /isClientMode && welcome && !initialCanvasJson/);
  assert.match(read('../pages/EditorPage.jsx'), /welcome=\{!activeFrame \|\| slot === 1\}/);
});
