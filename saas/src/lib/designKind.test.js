// LAB-289 : format « écran d'accueil » et règles du design par kind (modèle photo / écran d'accueil).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FORMATS, FORMAT_LIST, HOME_FORMAT, formatById, isHomeFormat } from '../utils/formats.js';
import {
  DESIGN_KINDS, HOME_FORMAT_ID, HOME_LOCKED_MESSAGE, PRINT_LOCKED_MESSAGE, PRINT_FORMATS, clientCanWriteDesign,
  designLockedMessage, designTabView, formatAllowedForKind, homeEditorEnabled, parseDesignKind,
} from './designKind.js';

test('HOME_FORMAT : 960×540 affiché, export exactement 1920×1080 (×2), sans fond perdu ni zone photo', () => {
  assert.equal(HOME_FORMAT.id, HOME_FORMAT_ID);
  assert.equal(HOME_FORMAT.canvasWidth, 960);
  assert.equal(HOME_FORMAT.canvasHeight, 540);
  assert.equal(HOME_FORMAT.exportWidth, 1920);
  assert.equal(HOME_FORMAT.exportHeight, 1080);
  // exportAsHighResPNG multiplie par exportWidth / canvasWidth : même facteur sur les deux axes.
  const scale = HOME_FORMAT.exportWidth / HOME_FORMAT.canvasWidth;
  assert.equal(scale, 2);
  assert.equal(HOME_FORMAT.canvasHeight * scale, 1080);
  assert.equal(HOME_FORMAT.bleedMm, 0);
  assert.deepEqual(HOME_FORMAT.photoZones, []);
  assert.equal(HOME_FORMAT.printable, false);
});

test('HOME_FORMAT : zone de sécurité 16:10 = 96 px export de chaque côté (48 px canvas)', () => {
  assert.equal(HOME_FORMAT.safeZoneInsetX, 48);
  const scale = HOME_FORMAT.exportWidth / HOME_FORMAT.canvasWidth;
  const visibleExportWidth = HOME_FORMAT.exportWidth - 2 * HOME_FORMAT.safeZoneInsetX * scale;
  assert.equal(visibleExportWidth / HOME_FORMAT.exportHeight, 16 / 10);
});

test('HOME_FORMAT : pastille et bande du bas alignées sur la borne (bas à 76 px, 103 px de haut, export)', () => {
  const scale = HOME_FORMAT.exportWidth / HOME_FORMAT.canvasWidth;
  assert.equal(HOME_FORMAT.pillBottomInset * scale, 76);
  assert.equal(HOME_FORMAT.pillHeight * scale, 103);
  assert.equal(HOME_FORMAT.reservedBottom * scale, 200);
  assert.ok(HOME_FORMAT.reservedBottom > HOME_FORMAT.pillBottomInset + HOME_FORMAT.pillHeight, 'marge au-dessus de la pastille');
});

test("FORMATS reste la liste des formats d'impression : home n'y figure pas", () => {
  assert.deepEqual(Object.keys(FORMATS), PRINT_FORMATS);
  assert.ok(!FORMAT_LIST.some((f) => f.id === 'home'));
  assert.equal(FORMATS.home, undefined);
});

test('formatById / isHomeFormat', () => {
  assert.equal(formatById('home'), HOME_FORMAT);
  assert.equal(formatById('portrait'), FORMATS.portrait);
  assert.equal(formatById('carre'), null);
  assert.equal(formatById(undefined), null);
  assert.equal(isHomeFormat(HOME_FORMAT), true);
  assert.equal(isHomeFormat(FORMATS.landscape), false);
  assert.equal(isHomeFormat(null), false);
});

test('parseDesignKind : print par défaut, print/home acceptés, le reste refusé', () => {
  assert.deepEqual(DESIGN_KINDS, ['print', 'home']);
  assert.equal(parseDesignKind(undefined), 'print');
  assert.equal(parseDesignKind(null), 'print');
  assert.equal(parseDesignKind('print'), 'print');
  assert.equal(parseDesignKind('home'), 'home');
  for (const v of ['', 'HOME', 'Print', 'banner', 0, 1, true, {}, []]) {
    assert.equal(parseDesignKind(v), null, JSON.stringify(v));
  }
});

test('formatAllowedForKind : impression pour print, home seul pour home', () => {
  for (const f of PRINT_FORMATS) {
    assert.equal(formatAllowedForKind('print', f), true);
    assert.equal(formatAllowedForKind('home', f), false);
  }
  assert.equal(formatAllowedForKind('home', 'home'), true);
  assert.equal(formatAllowedForKind('print', 'home'), false);
  assert.equal(formatAllowedForKind('print', 'carre'), false);
  assert.equal(formatAllowedForKind('home', undefined), false);
});

test('homeEditorEnabled : personalized ET client_design, booléens stricts', () => {
  const fc = (home) => ({ kiosk: { home } });
  assert.equal(homeEditorEnabled(fc({ personalized: true, client_design: true })), true);
  assert.equal(homeEditorEnabled(fc({ personalized: false, client_design: true })), false);
  assert.equal(homeEditorEnabled(fc({ personalized: true, client_design: false })), false);
  assert.equal(homeEditorEnabled(fc({ personalized: true })), false);
  assert.equal(homeEditorEnabled(fc({ personalized: 'true', client_design: 'true' })), false);
  assert.equal(homeEditorEnabled({ kiosk: {} }), false);
  assert.equal(homeEditorEnabled(null), false);
  assert.equal(homeEditorEnabled(undefined), false);
});

test('clientCanWriteDesign : un écran ou un cadre validé est en lecture seule (LAB-294)', () => {
  for (const kind of ['home', 'print']) {
    assert.equal(clientCanWriteDesign(kind, 'approved'), false, kind);
    for (const s of [undefined, null, 'draft', 'submitted', 'rejected']) {
      assert.equal(clientCanWriteDesign(kind, s), true, `${kind} ${s}`);
    }
  }
});

test("designTabView : écran d'accueil validé → aperçu seul, même pour un admin", () => {
  assert.equal(designTabView({ kind: 'home', designStatus: 'approved', eventStatus: 'active', isAdmin: false }), 'locked');
  assert.equal(designTabView({ kind: 'home', designStatus: 'approved', eventStatus: 'active', isAdmin: true }), 'locked');
});

test("designTabView : écran d'accueil envoyé → attente, sans dépendre de l'événement", () => {
  assert.equal(designTabView({ kind: 'home', designStatus: 'submitted', eventStatus: 'active', isAdmin: false }), 'pending');
  assert.equal(designTabView({ kind: 'home', designStatus: 'submitted', eventStatus: 'active', isAdmin: true }), 'editor');
  // Modèle photo envoyé (événement submitted) : l'écran d'accueil reste modifiable.
  assert.equal(designTabView({ kind: 'home', designStatus: 'draft', eventStatus: 'submitted', isAdmin: false }), 'editor');
  assert.equal(designTabView({ kind: 'home', designStatus: 'rejected', eventStatus: 'active', isAdmin: false }), 'editor');
  assert.equal(designTabView({ kind: 'home', designStatus: undefined, eventStatus: 'active', isAdmin: false }), 'editor');
});

test('designTabView : modèle photo piloté par events.status, cadre validé en lecture seule', () => {
  assert.equal(designTabView({ kind: 'print', designStatus: 'submitted', eventStatus: 'submitted', isAdmin: false }), 'pending');
  assert.equal(designTabView({ kind: 'print', designStatus: 'submitted', eventStatus: 'submitted', isAdmin: true }), 'editor');
  // LAB-294 : validé → aperçu seul, même pour un admin (l'événement reste « submitted » après validation).
  for (const isAdmin of [false, true]) {
    assert.equal(designTabView({ kind: 'print', designStatus: 'approved', eventStatus: 'submitted', isAdmin }), 'locked');
    assert.equal(designTabView({ kind: 'print', designStatus: 'approved', eventStatus: 'active', isAdmin }), 'locked');
  }
  // Rouvert par l'admin (refusé) : de nouveau modifiable.
  assert.equal(designTabView({ kind: 'print', designStatus: 'rejected', eventStatus: 'active', isAdmin: false }), 'editor');
  // L'écran d'accueil envoyé ne bloque pas le modèle photo.
  assert.equal(designTabView({ kind: 'print', designStatus: 'draft', eventStatus: 'active', isAdmin: false }), 'editor');
});

test('designLockedMessage : cadre validé en mots simples (ni « modèle » ni « template »)', () => {
  assert.equal(PRINT_LOCKED_MESSAGE, 'Votre cadre est validé. Contactez-nous pour le modifier.');
  assert.equal(designLockedMessage('print'), PRINT_LOCKED_MESSAGE);
  assert.equal(designLockedMessage('home'), HOME_LOCKED_MESSAGE);
  assert.doesNotMatch(PRINT_LOCKED_MESSAGE, /modèle|template/i);
});

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');

test("éditeur client : cadre validé en lecture seule, lien « Modifier mes réponses » dans le menu ⋯ (LAB-294)", () => {
  const page = readSrc('../pages/EditorPage.jsx');
  assert.match(page, /<DesignStatusPanel title="Cadre validé" message=\{PRINT_LOCKED_MESSAGE\} \/>/);
  // Cadre validé : lecture seule pour tous, l'admin le rouvre depuis la fiche de l'événement.
  assert.match(page, /return frame\?\.status === 'approved' \? 'frameLocked' : 'editor';/);
  assert.match(page, /onEditAnswers=\{globalForm && !isAdmin \? handleEditAnswers : null\}/);

  // Le prop reste déclaré dans Editor.jsx ; le menu ⋯ est dans l'en-tête (editor/EditorHeader.jsx).
  assert.match(readSrc('../components/Editor.jsx'), /onEditAnswers\s+= null/);
  assert.match(readEditor(), /<DropdownMenuItem onSelect=\{\(\) => onEditAnswers\(\)\}[^>]*>\s+Modifier mes réponses/);
});
