// LAB-289 : envoi d'un design selon son kind (modèle photo / écran d'accueil).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  designPngPath, pngFitsKind, pngSize, renderHomeSubmitNotificationEmail, submitSuccessMessage,
  submitUpdatesEventStatus, submitWebhookEvent,
} from './logic.ts';
import { renderSubmitNotificationEmail } from '../_shared/saas-emails.ts';

/** En-tête PNG minimal (signature + IHDR) pour une image width×height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("designPngPath : l'écran d'accueil dans designs/{event_id}/home/, le modèle photo inchangé", () => {
  assert.equal(designPngPath('evt-1', 'home', '20261115_101500'), 'evt-1/home/20261115_101500.png');
  assert.equal(designPngPath('evt-1', 'print', '20261115_101500'), 'evt-1/20261115_101500.png');
});

test('designPngPath : un cadre ajouté (slot > 1) porte son numéro, le cadre 1 garde son chemin (LAB-312)', () => {
  assert.equal(designPngPath('evt-1', 'print', '20261115_101500', 1), 'evt-1/20261115_101500.png');
  assert.equal(designPngPath('evt-1', 'print', '20261115_101500', 3), 'evt-1/20261115_101500_slot3.png');
  assert.equal(designPngPath('evt-1', 'home', '20261115_101500', 1), 'evt-1/home/20261115_101500.png');
});

test("seul le modèle photo fait passer l'événement en submitted", () => {
  assert.equal(submitUpdatesEventStatus('print'), true);
  assert.equal(submitUpdatesEventStatus('home'), false);
});

test('webhook et message distincts pour l\'écran d\'accueil', () => {
  assert.equal(submitWebhookEvent('print'), 'design.submitted');
  assert.equal(submitWebhookEvent('home'), 'home_design.submitted');
  assert.equal(submitSuccessMessage('print'), 'Design envoyé avec succès');
  assert.match(submitSuccessMessage('home'), /Écran d'accueil envoyé/);
});

test('pngSize lit IHDR ; refuse ce qui n\'est pas un PNG', () => {
  assert.deepEqual(pngSize(pngHeader(1920, 1080)), { width: 1920, height: 1080 });
  assert.equal(pngSize(new Uint8Array(10)), null);
  const jpeg = pngHeader(1920, 1080);
  jpeg[0] = 0xff;
  assert.equal(pngSize(jpeg), null);
});

test("pngFitsKind : écran d'accueil exactement 1920×1080, modèle photo non contrôlé", () => {
  assert.equal(pngFitsKind('home', pngHeader(1920, 1080)), true);
  assert.equal(pngFitsKind('home', pngHeader(1920, 1200)), false);
  assert.equal(pngFitsKind('home', pngHeader(960, 540)), false);
  assert.equal(pngFitsKind('home', new Uint8Array(4)), false);
  assert.equal(pngFitsKind('print', new Uint8Array(4)), true);
});

test("notification « écran d'accueil envoyé » : libellé distinct, données échappées", () => {
  const { subject, html } = renderHomeSubmitNotificationEmail({
    eventName: 'Mariage <A&B>', clientName: 'Camille <script>', adminUrl: 'https://app.exemple.fr/admin/events/1',
  });
  assert.equal(subject, "✅ Écran d'accueil envoyé — Mariage <A&B>");
  assert.match(html, /Nouvel écran d&#39;accueil reçu/);
  assert.match(html, /Camille &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /https:\/\/app\.exemple\.fr\/admin\/events\/1/);
});

test('notification admin « design envoyé » : objet sans « Template »', () => {
  const { subject } = renderSubmitNotificationEmail({
    eventName: 'Mariage Camille & Hugo', clientName: 'Camille', adminUrl: 'https://app.exemple.fr/admin/events/1',
  });
  assert.equal(subject, '✅ Design envoyé — Mariage Camille & Hugo');
});

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// LAB-294 : un design validé (écran d'accueil ou cadre) n'est plus écrit, le statut reste approved.
const LOCK_GUARD = /if \(await clientDesignLocked\(db, event\.id, kind, slot\)\) \{\s+return corsResponse\(409, \{ error: designLockedError\(kind\), code: DESIGN_LOCKED_CODE \}\);/;

test('submit-design : kind validé, design validé refusé, statut de l\'événement réservé au modèle photo', () => {
  const src = read('./index.ts');
  assert.match(src, /const kind = parseDesignKind\(body\.kind\);\s+if \(!kind\) return corsResponse\(400/);
  assert.match(src, /if \(!formatAllowedForKind\(kind, format\)\)/);
  assert.match(src, /if \(kind === 'home' && !homeEditorEnabled\(event\.form_config\)\) return corsResponse\(403/);
  assert.match(src, LOCK_GUARD);
  assert.ok(src.indexOf('clientDesignLocked(db') < src.indexOf(".from('designs')"), 'contrôle avant l\'upload');
  assert.ok(src.indexOf('clientDesignLocked(db') < src.indexOf(".from('client_designs')"), 'contrôle avant l\'écriture');
  assert.match(src, /if \(submitUpdatesEventStatus\(kind\)\) \{\s+await db\.from\('events'\)\.update\(\{ status: 'submitted' \}\)/);
  assert.equal((src.match(/\.update\(\{ status: 'submitted' \}\)/g) ?? []).length, 1);
  assert.match(src, /onConflict: 'event_id,kind,slot'/);
  // Pas d'exception admin : la fonction est publique (code d'accès), personne n'écrit un écran validé.
  assert.doesNotMatch(src, /Authorization/);
});

test('autosave-design et design-versions : mêmes gardes (écran d\'accueil, design validé)', () => {
  const autosave = read('../autosave-design/index.ts');
  assert.match(autosave, /const kind = parseDesignKind\(body\.kind\);\s+if \(!kind\) return corsResponse\(400/);
  assert.match(autosave, /if \(!remove && !formatAllowedForKind\(kind, format\)\)/);
  assert.match(autosave, /homeEditorEnabled\(event\.form_config\)/);
  assert.match(autosave, LOCK_GUARD);
  assert.ok(autosave.indexOf('clientDesignLocked(db') < autosave.indexOf('.upsert('), 'contrôle avant l\'écriture');
  assert.match(autosave, /\{ event_id: event\.id, kind, slot, canvas_json, format, status: 'draft'/);

  const versions = read('../design-versions/index.ts');
  assert.match(versions, /if \(request\.kind === 'home' && !homeEditorEnabled\(event\.form_config\)\)/);
  assert.match(versions, /if \(request\.action === 'save' && await clientDesignLocked\(db, event\.id, request\.kind, request\.slot\)\) \{\s+return corsResponse\(409, \{ error: designLockedError\(request\.kind\), code: DESIGN_LOCKED_CODE \}\);/);
  assert.ok(versions.indexOf('clientDesignLocked(db') < versions.indexOf('runVersionRequest(db'), 'contrôle avant l\'écriture');
});

test('submit-design : cadre `slot` (1 par défaut), refusé au-delà de max_frames, upsert par (event_id, kind, slot)', () => {
  const src = read('./index.ts');
  assert.match(src, /const slot = parseDesignSlot\(body\.slot\);\s+if \(slot === null \|\| !slotAllowedForKind\(kind, slot\)\) return corsResponse\(400, \{ error: 'slot invalide' \}\);/);
  assert.match(src, /if \(!clientCanWriteSlot\(kind, slot, event\.form_config\)\) return corsResponse\(403, \{ error: FRAME_LIMIT_ERROR \}\);/);
  assert.ok(src.indexOf('clientCanWriteSlot(kind, slot') < src.indexOf(".from('designs')"), 'contrôle avant l\'upload');
  assert.match(src, /designPngPath\(event\.id, kind, fmtTimestamp\(new Date\(\)\), slot\)/);
  assert.match(src, /kind,\s+slot,\s+\.\.\.\(label === undefined \? \{\} : \{ label \}\),/);
  assert.match(src, /\{ onConflict: 'event_id,kind,slot' \}/);
});
