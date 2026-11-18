// LAB-322 : plusieurs cadres, un email par événement (admin à l'envoi, client à la dernière décision),
// relance tant qu'un cadre créé reste à envoyer. Règles pures, rendus et branchement dans les fonctions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allFramesApproved, decidedFrames, frameFormatName, frameName, framesLeftToSend, openFrames,
  reminderDaysLeft, reminderFramesLeft, renderFramesReviewEmail, renderFramesSubmitNotificationEmail, reviewOutcome,
  submitNotification, type FrameRow,
} from './design-frames.ts';
import { renderDesignReminderEmail } from './saas-emails.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const choice = (max: number) => ({ kiosk: { frame_choice: { enabled: true, max_frames: max } } });
const f = (slot: number, status: string, extra: Partial<FrameRow> = {}): FrameRow =>
  ({ id: `d${slot}`, slot, status, label: null, format: 'portrait', ...extra });

test('frameName / frameFormatName : nom saisi sinon « Cadre n », formats en français', () => {
  assert.equal(frameName(f(2, 'draft')), 'Cadre 2');
  assert.equal(frameName(f(3, 'draft', { label: '  Soirée ' })), 'Soirée');
  assert.equal(frameName({ status: 'draft' }), 'Cadre 1');
  assert.equal(frameFormatName('stripV'), 'Bandelette verticale');
  assert.equal(frameFormatName('landscape'), 'Paysage');
  assert.equal(frameFormatName('inconnu'), 'inconnu');
  assert.equal(frameFormatName(null), '—');
});

test('openFrames : cadres ouverts triés, choix coupé = cadre 1, keepId garde le cadre relu', () => {
  const rows = [f(3, 'draft'), f(1, 'submitted'), f(2, 'approved')];
  assert.deepEqual(openFrames(rows, choice(4)).map((x) => x.slot), [1, 2, 3]);
  assert.deepEqual(openFrames(rows, choice(2)).map((x) => x.slot), [1, 2]);
  assert.deepEqual(openFrames(rows, {}).map((x) => x.slot), [1], 'choix coupé : cadre 1 seulement');
  assert.deepEqual(openFrames(rows, {}, 'd3').map((x) => x.slot), [1, 3]);
  assert.deepEqual(openFrames(null, choice(4)), []);
});

test('framesLeftToSend : brouillon et refusé non renvoyé comptent, envoyé et validé non', () => {
  assert.equal(framesLeftToSend([f(1, 'submitted'), f(2, 'approved')]), 0);
  assert.equal(framesLeftToSend([f(1, 'submitted'), f(2, 'draft'), f(3, 'rejected')]), 2);
});

test('submitNotification : un seul email admin, quand tous les cadres créés sont envoyés', () => {
  // Un seul cadre : email d'avant, à chaque envoi.
  assert.equal(submitNotification([f(1, 'submitted')], true), 'single');
  // 3 cadres envoyés d'un coup : les 2 premiers demandent notify:false, le dernier envoie l'email.
  assert.equal(submitNotification([f(1, 'submitted'), f(2, 'draft'), f(3, 'draft')], false), 'none');
  assert.equal(submitNotification([f(1, 'submitted'), f(2, 'submitted'), f(3, 'draft')], false), 'none');
  assert.equal(submitNotification([f(1, 'submitted'), f(2, 'submitted'), f(3, 'submitted')], true), 'frames');
  // Un cadre créé reste en brouillon (client parti en route) : pas d'email.
  assert.equal(submitNotification([f(1, 'submitted'), f(2, 'draft')], true), 'none');
  // Renvoi après refus : email seulement quand plus aucun cadre refusé n'attend d'être renvoyé.
  assert.equal(submitNotification([f(1, 'approved'), f(2, 'submitted'), f(3, 'rejected')], true), 'none');
  assert.equal(submitNotification([f(1, 'approved'), f(2, 'submitted'), f(3, 'submitted')], true), 'frames');
});

test('reviewOutcome : un email client à la dernière décision, brouillons ignorés', () => {
  assert.deepEqual(reviewOutcome([f(1, 'approved')]), { mode: 'single', pending: 0 });
  assert.deepEqual(reviewOutcome([f(1, 'rejected')]), { mode: 'single', pending: 0 });
  assert.deepEqual(reviewOutcome([f(1, 'approved'), f(2, 'draft')]), { mode: 'single', pending: 0 },
    'un seul cadre envoyé : email d\'avant');
  // 3 cadres : validés 2, refusé 1. Seule la dernière décision envoie l'email.
  assert.deepEqual(reviewOutcome([f(1, 'approved'), f(2, 'submitted'), f(3, 'submitted')]), { mode: 'wait', pending: 2 });
  assert.deepEqual(reviewOutcome([f(1, 'approved'), f(2, 'approved'), f(3, 'submitted')]), { mode: 'wait', pending: 1 });
  assert.deepEqual(reviewOutcome([f(1, 'approved'), f(2, 'approved'), f(3, 'rejected')]), { mode: 'summary', pending: 0 });
});

test('decidedFrames / allFramesApproved : bilan des cadres validés et refusés', () => {
  const frames = [f(1, 'approved'), f(2, 'draft'), f(3, 'rejected')];
  assert.deepEqual(decidedFrames(frames).map((x) => x.slot), [1, 3]);
  assert.equal(allFramesApproved(frames), false);
  assert.equal(allFramesApproved([f(1, 'approved'), f(2, 'approved')]), true);
});

test('reminderFramesLeft : relance d\'avant, cadres restants, ou rien', () => {
  assert.equal(reminderFramesLeft([], choice(4)), 0, 'aucun cadre : relance d\'avant');
  assert.equal(reminderFramesLeft([f(1, 'draft'), f(2, 'draft')], choice(4)), 0, 'rien d\'envoyé : relance d\'avant');
  assert.equal(reminderFramesLeft([f(1, 'submitted')], {}), null, 'un seul cadre envoyé : rien');
  assert.equal(reminderFramesLeft([f(1, 'submitted'), f(2, 'draft'), f(3, 'draft')], choice(3)), 2);
  assert.equal(reminderFramesLeft([f(1, 'approved'), f(2, 'rejected')], choice(2)), 1, 'refusé non renvoyé');
  assert.equal(reminderFramesLeft([f(1, 'submitted'), f(2, 'approved')], choice(2)), null, 'tout envoyé');
  // Choix coupé depuis : le brouillon du cadre 2 ne compte plus (comportement d'un seul cadre).
  assert.equal(reminderFramesLeft([f(1, 'submitted'), f(2, 'draft')], {}), null);
});

test('reminderDaysLeft : timestamptz et date seule lus au jour près (Paris), illisible = NaN', () => {
  const now = Date.parse('2026-11-15T10:00:00Z');
  assert.equal(reminderDaysLeft('2026-11-25T00:00:00+00:00', now), 10, 'timestamptz renvoyé par PostgREST');
  assert.equal(reminderDaysLeft('2026-11-25 18:30:00+00', now), 10);
  assert.equal(reminderDaysLeft('2026-11-25', now), 10, 'date seule');
  assert.equal(reminderDaysLeft('2026-11-24T23:30:00+00:00', now), 10, 'minuit et demi à Paris : jour suivant');
  assert.equal(reminderDaysLeft('2026-11-15T20:00:00Z', now), 0);
  assert.equal(reminderDaysLeft('2026-11-14T08:00:00Z', now), -1);
  assert.ok(Number.isNaN(reminderDaysLeft('pas une date', now)));
  assert.ok(Number.isNaN(new Date('2026-11-25T00:00:00+00:00T00:00:00Z').getTime()), 'ancien calcul : date invalide');
});

test('email admin : un seul email qui nomme tous les cadres envoyés (nom, format), noms échappés', () => {
  const { subject, html } = renderFramesSubmitNotificationEmail({
    eventName: 'Mariage', clientName: 'Camille <b>', adminUrl: 'https://app.test/admin/events/1',
    frames: [f(1, 'submitted', { label: 'Bande <i>' }), f(2, 'submitted', { format: 'stripV' }), f(3, 'submitted', { format: 'landscape' })],
  });
  assert.equal(subject, '✅ 3 cadres soumis — Mariage');
  assert.match(html, /Nouveaux cadres reçus/);
  assert.match(html, /Camille &lt;b&gt;/);
  assert.match(html, /Bande &lt;i&gt;/);
  assert.match(html, /Cadre 2/);
  assert.match(html, /Bandelette verticale/);
  assert.match(html, /Cadre 3/);
  assert.match(html, /Paysage/);
  assert.match(html, /https:\/\/app\.test\/admin\/events\/1/);
  // Renvoi après refus : seul le cadre à valider est listé, les validés sont rappelés.
  const resend = renderFramesSubmitNotificationEmail({
    eventName: 'Mariage', clientName: 'Camille', adminUrl: 'https://x',
    frames: [f(1, 'approved'), f(2, 'submitted')],
  });
  assert.equal(resend.subject, '✅ 1 cadre soumis — Mariage');
  assert.match(resend.html, /Déjà validé : Cadre 1\./);
});

test('email client : bilan, motif de chaque refus échappé, tous validés', () => {
  const ko = renderFramesReviewEmail({
    clientName: 'Camille', eventName: 'Mariage', editorUrl: 'https://app.test/e/ABC',
    frames: [f(1, 'approved'), f(2, 'approved', { label: 'Soirée' }), f(3, 'rejected', { review_feedback: 'Logo <trop> petit' })],
  });
  assert.equal(ko.subject, '🔄 1 cadre nécessite des modifications — Mariage');
  assert.match(ko.html, /Soirée/);
  assert.equal((ko.html.match(/✅ Validé/g) ?? []).length, 2);
  assert.match(ko.html, /🔄 À modifier/);
  assert.match(ko.html, /Logo &lt;trop&gt; petit/);
  assert.match(ko.html, /Envoyer mes cadres/);
  assert.match(ko.html, /https:\/\/app\.test\/e\/ABC/);
  const two = renderFramesReviewEmail({
    clientName: 'C', eventName: 'M', editorUrl: 'https://x',
    frames: [f(1, 'rejected', { review_feedback: 'a' }), f(2, 'rejected', { review_feedback: 'b' })],
  });
  assert.equal(two.subject, '🔄 2 cadres nécessitent des modifications — M');
  const ok = renderFramesReviewEmail({
    clientName: 'C', eventName: 'M', editorUrl: 'https://x', frames: [f(1, 'approved'), f(2, 'approved')],
  });
  assert.equal(ok.subject, '✅ Vos cadres ont été validés — M');
  assert.doesNotMatch(ok.html, /À modifier/);
});

test('relance partielle : dit combien de cadres restent, relance d\'avant inchangée', () => {
  const base = { clientName: 'Camille', eventName: 'Mariage', accessCode: 'ABC123', editorUrl: 'https://x/e/ABC123', daysLeft: 10 };
  assert.deepEqual(renderDesignReminderEmail({ ...base, framesLeft: 0 }), renderDesignReminderEmail(base));
  assert.equal(renderDesignReminderEmail(base).subject, '⏳ Pensez à finaliser votre cadre photobooth — Mariage');
  const two = renderDesignReminderEmail({ ...base, framesLeft: 2 });
  assert.equal(two.subject, '⏳ Il vous reste 2 cadres à envoyer — Mariage');
  assert.match(two.html, /il vous reste <strong>2 cadres<\/strong> à envoyer/);
  assert.match(two.html, /ABC123/);
  assert.equal(renderDesignReminderEmail({ ...base, framesLeft: 1 }).subject, '⏳ Il vous reste 1 cadre à envoyer — Mariage');
});

test('submit-design : notify lu, email admin selon submitNotification (un seul cadre = email d\'avant)', () => {
  const src = read('../submit-design/index.ts');
  assert.match(src, /const notify = body\.notify !== false;/);
  assert.match(src, /const frames = openFrames\(rows, event\.form_config, design\.id\);/);
  assert.match(src, /const mode = submitNotification\(frames, notify\);/);
  assert.match(src, /if \(mode === 'single'\) \{\s+await sendSubmitNotificationEmail\(/);
  assert.match(src, /renderFramesSubmitNotificationEmail\(/);
});

test('review-design : pas d\'email tant qu\'un cadre attend, bilan à la dernière décision, journal cohérent', () => {
  const src = read('../review-design/index.ts');
  assert.match(src, /outcome = reviewOutcome\(frames\);/);
  assert.match(src, /if \(event\.client_email && outcome\.mode !== 'wait'\) \{/);
  assert.match(src, /renderFramesReviewEmail\(\{ clientName, eventName: event\.name, editorUrl, frames, trackingUrl \}\)/);
  assert.match(src, /const logAction: ReviewAction = summary \? \(allFramesApproved\(frames\) \? 'approve' : 'reject'\) : reviewAction;/);
  assert.match(src, /client_notified: Boolean\(event\.client_email\) && outcome\.mode !== 'wait',/);
  assert.match(src, /pending_frames:\s+outcome\.pending,/);
});
