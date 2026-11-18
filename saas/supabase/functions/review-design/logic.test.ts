// Tests de la revue des designs (LAB-290) : modèle photo inchangé, écran d'accueil rouvrable,
// emails de l'écran d'accueil. Exécution : `npm test` (runner natif Node, strip-types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canReview, designKind, resetsEventStatus, reviewEmailLogType, reviewFrameLabel, reviewMessage } from './logic.ts';
import { renderApprovalEmail, renderRejectionEmail } from '../_shared/saas-emails.ts';
import { renderHomeApprovalEmail, renderHomeRejectionEmail } from './home-emails.ts';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('kind : une ligne sans kind compte comme modèle photo', () => {
  assert.equal(designKind('home'), 'home');
  assert.equal(designKind('print'), 'print');
  assert.equal(designKind(undefined), 'print');
  assert.equal(designKind('autre'), 'print');
});

test('modèle photo : seul un design envoyé se valide ; un brouillon ou un refusé ne se refuse pas', () => {
  assert.equal(canReview('print', 'submitted', 'approve'), true);
  assert.equal(canReview('print', 'submitted', 'reject'), true);
  for (const status of ['draft', 'approved', 'rejected']) {
    assert.equal(canReview('print', status, 'approve'), false, status);
  }
  for (const status of ['draft', 'rejected']) {
    assert.equal(canReview('print', status, 'reject'), false, status);
  }
});

test('cadre du modèle photo validé : il se rouvre par un refus, comme l’écran d’accueil (LAB-294)', () => {
  assert.equal(canReview('print', 'approved', 'reject'), true);
  assert.equal(canReview(undefined, 'approved', 'reject'), true);
  assert.equal(canReview('print', 'approved', 'approve'), false);
  // Le refus d'un cadre validé remet l'événement en cours : le client peut le corriger et le renvoyer.
  assert.equal(resetsEventStatus('print', 'reject'), true);
});

test('écran d’accueil : validé, il se rouvre par un refus, mais ne se revalide pas', () => {
  assert.equal(canReview('home', 'submitted', 'approve'), true);
  assert.equal(canReview('home', 'submitted', 'reject'), true);
  assert.equal(canReview('home', 'approved', 'reject'), true);
  assert.equal(canReview('home', 'approved', 'approve'), false);
  for (const status of ['draft', 'rejected']) {
    assert.equal(canReview('home', status, 'approve'), false, status);
    assert.equal(canReview('home', status, 'reject'), false, status);
  }
});

test('events.status : seul le refus du modèle photo remet l’événement en cours', () => {
  assert.equal(resetsEventStatus('print', 'reject'), true);
  assert.equal(resetsEventStatus('print', 'approve'), false);
  assert.equal(resetsEventStatus('home', 'reject'), false);
  assert.equal(resetsEventStatus('home', 'approve'), false);
});

test('journal et messages : types distincts pour l’écran d’accueil, modèle photo inchangé', () => {
  assert.equal(reviewEmailLogType('print', 'approve'), 'design_approved');
  assert.equal(reviewEmailLogType('print', 'reject'), 'design_rejected');
  assert.equal(reviewEmailLogType('home', 'approve'), 'home_design_approved');
  assert.equal(reviewEmailLogType('home', 'reject'), 'home_design_rejected');
  assert.equal(reviewMessage('print', 'approve'), 'Template approuvé');
  assert.equal(reviewMessage('print', 'reject'), 'Template refusé');
  assert.match(reviewMessage('home', 'approve'), /Écran d’accueil validé/);
  assert.match(reviewMessage('home', 'reject'), /Écran d’accueil/);
});

test('emails de l’écran d’accueil : parlent de l’écran d’accueil, motif échappé, lien vers l’éditeur', () => {
  const ok = renderHomeApprovalEmail({ clientName: 'Camille', eventName: 'Mariage <C&T>' });
  assert.match(ok.subject, /écran d'accueil a été validé/);
  assert.match(ok.subject, /Mariage <C&T>/);
  assert.match(ok.html, /Mariage &lt;C&amp;T&gt;/);
  assert.doesNotMatch(ok.html, /template/i);

  const ko = renderHomeRejectionEmail({
    clientName: 'Camille', eventName: 'Mariage', editorUrl: 'https://app.exemple.fr/e/ABC123', feedback: 'Texte coupé <à gauche>',
  });
  assert.match(ko.subject, /écran d'accueil nécessite des modifications/);
  assert.match(ko.html, /Texte coupé &lt;à gauche&gt;/);
  assert.match(ko.html, /https:\/\/app\.exemple\.fr\/e\/ABC123/);
  assert.match(ko.html, /Mon écran d'accueil/);
  assert.doesNotMatch(ko.html, /template/i);
});

test('index.ts : règles de logic.ts branchées, emails selon le kind', () => {
  assert.match(source, /canReview\(design\.kind, design\.status, reviewAction\)/);
  assert.match(source, /resetsEventStatus\(design\.kind, reviewAction\)/);
  assert.match(source, /type: reviewEmailLogType\(design\.kind, logAction\)/);
  assert.match(source, /renderHomeApprovalEmail\(/);
  assert.match(source, /renderHomeRejectionEmail\(/);
  // Plus de garde codée en dur « submitted seulement » : un écran validé doit pouvoir être rouvert.
  assert.doesNotMatch(source, /design\.status !== 'submitted'/);
});

// ── LAB-312 : plusieurs cadres, nom du cadre dans l'email au client ─────────

test('reviewFrameLabel : rien pour un seul cadre ni pour l\'écran d\'accueil, sinon le nom ou « Cadre n »', () => {
  assert.equal(reviewFrameLabel({ kind: 'print', slot: 1, label: null }, false), null);
  assert.equal(reviewFrameLabel({ kind: 'print', slot: 1, label: 'Bande' }, false), null);
  assert.equal(reviewFrameLabel({ kind: 'home', slot: 1, label: 'X' }, true), null);
  assert.equal(reviewFrameLabel({ kind: 'print', slot: 1, label: 'Bande' }, true), 'Bande');
  assert.equal(reviewFrameLabel({ kind: 'print', slot: 1, label: '  ' }, true), 'Cadre 1');
  assert.equal(reviewFrameLabel({ kind: 'print', slot: 3, label: null }, false), 'Cadre 3');
  assert.equal(reviewFrameLabel({ kind: 'print', slot: 2, label: 'Soirée' }, false), 'Soirée');
});

test('emails de revue : sans nom de cadre, identiques ; avec, le nom est cité et échappé', () => {
  const base = { clientName: 'Camille', eventName: 'Mariage' };
  assert.deepEqual(renderApprovalEmail({ ...base, frameLabel: null }), renderApprovalEmail(base));
  assert.equal(renderApprovalEmail(base).subject, '✅ Votre cadre a été validé — Mariage');
  const approved = renderApprovalEmail({ ...base, frameLabel: 'Bande <b>' });
  assert.equal(approved.subject, '✅ Votre cadre « Bande <b> » a été validé — Mariage');
  assert.match(approved.html, /Votre cadre photobooth « Bande &lt;b&gt; » pour l'événement/);
  const reject = { ...base, editorUrl: 'https://app.test/e/A', feedback: 'Plus grand' };
  assert.deepEqual(renderRejectionEmail({ ...reject, frameLabel: undefined }), renderRejectionEmail(reject));
  const rejected = renderRejectionEmail({ ...reject, frameLabel: 'Cadre 2' });
  assert.equal(rejected.subject, '🔄 Votre cadre « Cadre 2 » nécessite des modifications — Mariage');
  assert.match(rejected.html, /Votre cadre photobooth « Cadre 2 » pour l'événement/);
});

test('index.ts : le cadre (slot, label) et frame_choice sont lus, le nom passe aux deux emails', () => {
  assert.match(source, /\.select\('id, event_id, kind, status, slot, label'\)/);
  assert.match(source, /access_code, form_config'\)/);
  assert.match(source, /const frameLabel = reviewFrameLabel\(design, frameChoiceConfig\(event\.form_config\)\.enabled\);/);
  assert.equal((source.match(/^\s+frameLabel,$/gm) ?? []).length, 2);
});
