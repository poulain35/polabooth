// LAB-290 : designs du client dans l'admin (modèle photo et écran d'accueil).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_KIND_LABELS, designReviewActions, FRAME_PAPER, frameTitle, frameWarnings, framesSectionView,
  HOME_DESIGN_STATUS, HOME_SAFE_SIDE_PERCENT, homeDesignShownOnKiosk, kioskFrames, mainFrame, pendingKindsByEvent,
  framesReviewHint, reviewPendingNotice, sortFrames,
} from './clientDesigns.js';
import { readFileSync } from 'node:fs';

test('libellés : « Écran d’accueil » distinct du template', () => {
  assert.equal(DESIGN_KIND_LABELS.print, 'Template');
  assert.equal(DESIGN_KIND_LABELS.home, 'Écran d’accueil');
  assert.deepEqual(Object.values(HOME_DESIGN_STATUS).map((s) => s.label), ['Brouillon', 'Envoyé', 'Validé', 'À corriger']);
});

test('cadre 16:10 : 96 px coupés de chaque côté sur 1920 (5 %)', () => {
  assert.equal(HOME_SAFE_SIDE_PERCENT, 5);
});

test('designs à valider regroupés par événement, modèle photo d’abord, sans doublon', () => {
  const map = pendingKindsByEvent([
    { event_id: 'a', kind: 'home' }, { event_id: 'a', kind: 'print' }, { event_id: 'b', kind: 'home' },
    { event_id: 'c' }, { event_id: 'c', kind: 'print' }, { event_id: 'd', kind: 'autre' },
  ]);
  assert.deepEqual([...map.entries()], [['a', ['print', 'home']], ['b', ['home']], ['c', ['print']]]);
  assert.equal(pendingKindsByEvent(null).size, 0);
});

test('validation : modèle photo envoyé, validable ou refusable', () => {
  assert.deepEqual(designReviewActions('print', 'submitted'), { canApprove: true, canReject: true, reopen: false });
  for (const status of ['draft', 'rejected']) {
    assert.deepEqual(designReviewActions('print', status), { canApprove: false, canReject: false, reopen: false }, status);
  }
});

test('validation : cadre du modèle photo validé, refus possible pour le rouvrir (LAB-294)', () => {
  assert.deepEqual(designReviewActions('print', 'approved'), { canApprove: false, canReject: true, reopen: true });
});

test('validation : écran d’accueil validé, refus possible pour le rouvrir', () => {
  assert.deepEqual(designReviewActions('home', 'submitted'), { canApprove: true, canReject: true, reopen: false });
  assert.deepEqual(designReviewActions('home', 'approved'), { canApprove: false, canReject: true, reopen: true });
  assert.deepEqual(designReviewActions('home', 'rejected'), { canApprove: false, canReject: false, reopen: false });
  assert.deepEqual(designReviewActions('home', 'draft'), { canApprove: false, canReject: false, reopen: false });
});

test('affiché sur la borne : validé et les deux options au booléen true', () => {
  const on = { personalized: true, client_design: true };
  assert.equal(homeDesignShownOnKiosk(on, { status: 'approved' }), true);
  assert.equal(homeDesignShownOnKiosk(on, { status: 'submitted' }), false);
  assert.equal(homeDesignShownOnKiosk(on, null), false);
  assert.equal(homeDesignShownOnKiosk({ personalized: false, client_design: true }, { status: 'approved' }), false);
  assert.equal(homeDesignShownOnKiosk({ personalized: true, client_design: 'true' }, { status: 'approved' }), false);
});

// ── LAB-314 : plusieurs cadres ──
const frame = (slot, status = 'approved', over = {}) => ({
  id: `f${slot}`, kind: 'print', slot, status, format: 'portrait', label: null, ...over,
});
const ON = { frame_choice: { enabled: true, max_frames: 3 } };

test('sortFrames : modèles photo triés par cadre, écran d’accueil écarté', () => {
  const rows = [frame(3), { id: 'h', kind: 'home', slot: 1, status: 'approved' }, frame(1), { id: 'old', status: 'draft' }];
  assert.deepEqual(sortFrames(rows).map((f) => f.id), ['f1', 'old', 'f3']);
  assert.deepEqual(sortFrames(null), []);
});

test('frameTitle : numéro et nom du cadre', () => {
  assert.equal(frameTitle(frame(2)), 'Cadre 2');
  assert.equal(frameTitle(frame(2, 'approved', { label: '  Mariage ' })), 'Cadre 2 · Mariage');
  assert.equal(frameTitle(frame(1, 'approved', { label: '   ' })), 'Cadre 1');
});

test('mainFrame : cadre validé au plus petit numéro', () => {
  assert.equal(mainFrame([frame(2), frame(1)]).id, 'f1');
  assert.equal(mainFrame([frame(1, 'rejected'), frame(3), frame(2)]).id, 'f2');
  assert.equal(mainFrame([frame(1, 'submitted')]), null);
  assert.equal(mainFrame([]), null);
});

test('kioskFrames : le principal seul quand le choix est coupé, tous les validés sinon', () => {
  const frames = [frame(1), frame(2), frame(3), frame(4, 'submitted')];
  assert.deepEqual(kioskFrames(frames, {}).map((f) => f.id), ['f1']);
  assert.deepEqual(kioskFrames(frames, { frame_choice: { enabled: 'true' } }).map((f) => f.id), ['f1']);
  assert.deepEqual(kioskFrames(frames, { frame_choice: { enabled: true, max_frames: 2 } }).map((f) => f.id), ['f1', 'f2', 'f3']);
  assert.deepEqual(kioskFrames([frame(1, 'submitted')], ON), []);
});

test('FRAME_PAPER : 10×15 pour portrait et paysage, bande pour les strips', () => {
  assert.deepEqual(FRAME_PAPER, { portrait: '4x6', landscape: '4x6', stripV: '2x6', stripH: '2x6' });
});

test('frameWarnings : papiers mélangés quand le choix est actif', () => {
  const [w] = frameWarnings([frame(1), frame(2, 'submitted', { format: 'stripV' })], ON);
  assert.equal(w.code, 'mixed_paper');
  assert.match(w.message, /DS620/);
  assert.match(w.message, /RX1-HS/);
  assert.deepEqual(frameWarnings([frame(1), frame(2, 'approved', { format: 'landscape' })], ON), []);
  assert.deepEqual(frameWarnings([frame(1), frame(2, 'draft', { format: 'stripH' })], ON), []);
  assert.equal(frameWarnings([frame(1, 'approved', { format: null }), frame(2, 'approved', { format: 'stripH' })], ON)[0].code, 'mixed_paper');
  assert.deepEqual(frameWarnings([frame(1, 'approved', { format: null }), frame(2)], ON), []);
});

test('frameWarnings : choix coupé avec plusieurs cadres', () => {
  const [w] = frameWarnings([frame(1, 'approved', { label: 'Jour' }), frame(2)], {});
  assert.equal(w.code, 'choice_off');
  assert.match(w.message, /seul « Cadre 1 · Jour » part/);
  assert.match(frameWarnings([frame(1, 'submitted'), frame(2, 'draft')], {})[0].message, /un seul cadre partira/);
  assert.deepEqual(frameWarnings([frame(1)], {}), []);
  assert.deepEqual(frameWarnings([], {}), []);
});

test('framesSectionView : un cadre et choix coupé = affichage d’avant', () => {
  const f1 = frame(1);
  assert.deepEqual(framesSectionView([f1], {}), {
    mode: 'single', items: [{ frame: f1, title: null, kioskNote: null, onKiosk: true }], warnings: [],
  });
  assert.deepEqual(framesSectionView([], undefined), { mode: 'single', items: [], warnings: [] });
});

test('framesSectionView : deux cadres validés, choix coupé puis actif', () => {
  const frames = [frame(2, 'approved', { label: 'Soir' }), frame(1)];
  const off = framesSectionView(frames, {});
  assert.equal(off.mode, 'list');
  assert.deepEqual(off.items.map((i) => [i.title, i.kioskNote, i.onKiosk]), [
    ['Cadre 1', 'Sur la borne', true],
    ['Cadre 2 · Soir', 'Pas sur la borne : le choix du cadre est coupé', false],
  ]);
  assert.equal(off.warnings[0].code, 'choice_off');
  const on = framesSectionView([...frames, frame(3, 'submitted')], ON);
  assert.deepEqual(on.items.map((i) => [i.title, i.kioskNote]), [
    ['Cadre 1', 'Sur la borne'], ['Cadre 2 · Soir', 'Sur la borne'], ['Cadre 3', null],
  ]);
  assert.deepEqual(on.warnings, []);
  assert.equal(framesSectionView([frame(1)], ON).mode, 'list');
});

// ── LAB-322 : un seul email au client, à la dernière décision ──────────────

test('reviewPendingNotice : dit que le client sera prévenu plus tard, rien sinon', () => {
  assert.equal(reviewPendingNotice({ client_notified: false, pending_frames: 2 }),
    'Décision enregistrée. Le client sera prévenu quand tous les cadres auront été traités (encore 2 cadres à traiter).');
  assert.match(reviewPendingNotice({ client_notified: false, pending_frames: 1 }), /encore 1 cadre à traiter/);
  assert.equal(reviewPendingNotice({ client_notified: true, pending_frames: 0 }), '');
  assert.equal(reviewPendingNotice({ client_notified: false, pending_frames: 0 }), '', 'sans email client : rien');
  assert.equal(reviewPendingNotice({ message: 'ok' }), '', 'réponse d\'avant : rien');
  assert.equal(reviewPendingNotice(null), '');
});

test('framesReviewHint : seulement quand au moins 2 cadres attendent une décision', () => {
  assert.equal(framesReviewHint([{ status: 'submitted' }, { status: 'approved' }]), null);
  assert.equal(framesReviewHint(null), null);
  assert.match(framesReviewHint([{ status: 'submitted' }, { status: 'submitted' }]), /un seul email/);
});

test('admin : la notice de revue est affichée après la décision, le rappel en tête des cadres', () => {
  const detail = readFileSync(new URL('../pages/admin/event/CreationTab.jsx', import.meta.url), 'utf8');
  assert.match(detail, /const result = await reviewDesign\(/);
  assert.match(detail, /setNotice\(reviewPendingNotice\(result\)\);/);
  assert.match(detail, /\{notice && \(/);
  const section = readFileSync(new URL('../components/admin/ClientFramesSection.jsx', import.meta.url), 'utf8');
  assert.match(section, /const hint = framesReviewHint\(frames\);/);
});
