// Ligne « Suivre ma réservation » des emails de l'événement (spec suivi-client-reservation, D8).
// Sans lien, chaque email reste celui d'avant, octet pour octet : empreintes calculées sur le code
// d'avant le lot C (LAB-381). Une modification volontaire d'un email met à jour son empreinte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as saas from './saas-emails.ts';
import { renderFramesReviewEmail } from './design-frames.ts';
import { trackingLine } from './email-layout.ts';
import { renderHomeApprovalEmail, renderHomeRejectionEmail } from '../review-design/home-emails.ts';
import { renderMediaExpiryReminderEmail } from '../media-expiry/email.ts';

type Render = (trackingUrl?: string | null) => { subject: string; html: string };

const E = 'https://app.test/e/K7M2PQ';
const frames = [
  { slot: 1, label: 'Bande <b>', status: 'approved' },
  { slot: 2, label: null, status: 'rejected', review_feedback: 'Texte trop près\ndu bord' },
];

const CASES: Record<string, Render> = {
  access: (t) => saas.renderAccessCodeEmail({ clientName: 'Camille <C>', eventName: 'Mariage & co', accessCode: 'K7M2PQ', editorUrl: E, expiresAt: '2027-06-30T12:00:00Z', trackingUrl: t }),
  accessNoExpiry: (t) => saas.renderAccessCodeEmail({ clientName: 'Camille', eventName: 'Mariage', accessCode: 'K7M2PQ', editorUrl: E, trackingUrl: t }),
  approval: (t) => saas.renderApprovalEmail({ clientName: 'Camille', eventName: 'Mariage', trackingUrl: t }),
  approvalLabel: (t) => saas.renderApprovalEmail({ clientName: 'Camille', eventName: 'Mariage', frameLabel: 'Cadre <2>', trackingUrl: t }),
  rejection: (t) => saas.renderRejectionEmail({ clientName: 'Camille', eventName: 'Mariage', editorUrl: E, feedback: 'Trop\nprès', frameLabel: 'Bande', trackingUrl: t }),
  framesApproved: (t) => renderFramesReviewEmail({ clientName: 'Camille', eventName: 'Mariage', editorUrl: E, frames: [frames[0], { slot: 2, status: 'approved' }], trackingUrl: t }),
  framesRejected: (t) => renderFramesReviewEmail({ clientName: 'Camille', eventName: 'Mariage', editorUrl: E, frames, trackingUrl: t }),
  homeApproval: (t) => renderHomeApprovalEmail({ clientName: 'Camille', eventName: 'Mariage', trackingUrl: t }),
  homeRejection: (t) => renderHomeRejectionEmail({ clientName: 'Camille', eventName: 'Mariage', editorUrl: E, feedback: 'Logo flou', trackingUrl: t }),
  reminder: (t) => saas.renderDesignReminderEmail({ clientName: 'Camille', eventName: 'Mariage', accessCode: 'K7M2PQ', editorUrl: E, daysLeft: 12, trackingUrl: t }),
  reminderSoon: (t) => saas.renderDesignReminderEmail({ clientName: 'Camille', eventName: '', accessCode: 'K7M2PQ', editorUrl: E, daysLeft: 1, trackingUrl: t }),
  reminderFrames: (t) => saas.renderDesignReminderEmail({ clientName: 'Camille', eventName: 'Mariage', accessCode: 'K7M2PQ', editorUrl: E, daysLeft: 12, framesLeft: 2, trackingUrl: t }),
  delivery: (t) => saas.renderDeliveryEmail({ clientName: 'Camille', eventName: 'Mariage', brand: 'Pola', photoGalleryUrl: 'https://galerie.test/m', links: [{ label: "Livre d'or", url: 'https://app.test/audio/X' }], reviewUrl: 'https://g.page/r', hasAttachment: true, trackingUrl: t }),
  deliveryBare: (t) => saas.renderDeliveryEmail({ clientName: 'Camille', eventName: 'Mariage', brand: 'Pola', photoGalleryUrl: 'https://galerie.test/m', hasAttachment: false, trackingUrl: t }),
  report: (t) => saas.renderEventReportEmail({ clientName: 'Camille', eventName: 'Soirée', brand: 'Pola', reportUrl: 'https://app.test/rapport/x', expiresAt: '2027-12-19T09:30:00Z', trackingUrl: t }),
  reportNoExpiry: (t) => saas.renderEventReportEmail({ clientName: 'Camille', eventName: 'Soirée', brand: 'Pola', reportUrl: 'https://app.test/rapport/x', trackingUrl: t }),
  mediaExpiry: (t) => renderMediaExpiryReminderEmail({ clientName: 'Camille', eventName: 'Mariage', expiresAt: '2027-01-15T10:00:00Z', photosUrl: 'https://app.test/photos/X', audioUrl: 'https://app.test/audio/X', trackingUrl: t }),
  mediaExpiryAnon: (t) => renderMediaExpiryReminderEmail({ clientName: null, eventName: null, expiresAt: '2027-01-15T10:00:00Z', photosUrl: 'https://app.test/photos/X', trackingUrl: t }),
};

// Empreintes (sha256 de `objet\nHTML`, 32 premiers caractères) des emails d'avant le lot C.
const BEFORE: Record<string, string> = {
  access: '31450a32bc92ee7944e986b9db4e3385',
  accessNoExpiry: '586b12cf0e716caced21d7403d701e56',
  approval: 'db2c117eed2bd287525cbc3a26c081af',
  approvalLabel: '09682c76562742ca33e0f9418214bea3',
  rejection: 'deada09d3480c452b0c91e60491e8d5e',
  framesApproved: '057470e2be5588094af608b2c8e6a475',
  framesRejected: '46bb5550e39b330cabd47972c0d9221e',
  homeApproval: 'cd4dd5f0f51a8f9ae9848fdd73d6cffe',
  homeRejection: 'b6161b27449d2af4c7b48adc591134f3',
  reminder: '231b44b423ced5daa910ff0f778ef73d',
  reminderSoon: '93edee0f3f43132aeb216e2ef9a85bb9',
  reminderFrames: 'f09a46d13462fdfed3ba0b62e291e94d',
  delivery: '97bc25b8f0eb9479fc9f4103b36eb413',
  deliveryBare: '5318c8e036f04d80df9fa542430899f4',
  report: '2714d31e4c56aed6733a43b8a0ced3d1',
  reportNoExpiry: '25ba7e38cea9a9cfd30e9c12ceaa3148',
  mediaExpiry: '18f5917500edddb8f1937df6db901bf1',
  mediaExpiryAnon: '07e67a86c25c47e05ce75061563c0557',
};

const sha = (r: { subject: string; html: string }) =>
  createHash('sha256').update(`${r.subject}\n${r.html}`).digest('hex').slice(0, 32);

const TRACKING = 'https://app.test/reservation/tok_1';

test('sans lien (absent, null ou vide) : chaque email reste identique octet pour octet', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(BEFORE).sort());
  for (const [name, render] of Object.entries(CASES)) {
    assert.equal(sha(render()), BEFORE[name], `${name} : email modifié sans lien`);
    assert.deepEqual(render(null), render(), name);
    assert.deepEqual(render(''), render(), name);
  }
});

test('avec un lien : la ligne « Suivre ma réservation » est ajoutée en fin de corps, rien d\'autre ne change', () => {
  const line = trackingLine(TRACKING);
  assert.equal(trackingLine(null), '');
  assert.match(line, /Où en est votre réservation \?/);
  assert.match(line, /<a href="https:\/\/app\.test\/reservation\/tok_1"[^>]*>Suivre ma réservation<\/a>/);
  for (const [name, render] of Object.entries(CASES)) {
    const before = render();
    const after = render(TRACKING);
    assert.equal(after.subject, before.subject, name);
    assert.equal(after.html.split('Suivre ma réservation').length, 2, `${name} : une seule ligne`);
    // Le corps se termine juste avant la fermeture de la carte ; viennent ensuite la signature et les mentions.
    const cardEnd = before.html.lastIndexOf('\n      </td></tr>');
    assert.ok(cardEnd > 0, name);
    const expected = before.html.slice(0, cardEnd) + line + before.html.slice(cardEnd);
    assert.equal(after.html, expected, `${name} : ligne insérée à la fin du corps`);
    assert.ok(after.html.indexOf('Suivre ma réservation') < after.html.indexOf('<!--brand:footer-->'), `${name} : avant la signature`);
  }
});

test('lien échappé dans le HTML', () => {
  const { html } = CASES.approval('https://app.test/reservation/a"b<c>');
  assert.match(html, /href="https:\/\/app\.test\/reservation\/a&quot;b&lt;c&gt;"/);
});

test('envois : chaque fonction calcule le lien par clientTrackingUrl et le passe au rendu', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const senders: Record<string, RegExp[]> = {
    '../resend-access-email/index.ts': [/sendAccessCodeEmail\(\{[\s\S]*?trackingUrl: await clientTrackingUrl\(db, event\.id\),/],
    '../send-access-emails/index.ts': [/sendAccessCodeEmail\(\{[\s\S]*?trackingUrl: await clientTrackingUrl\(db, ev\.id\),/],
    '../send-design-reminders/index.ts': [/sendDesignReminderEmail\(\{[\s\S]*?trackingUrl: await clientTrackingUrl\(db, ev\.id\),/],
    '../send-delivery/index.ts': [/sendDeliveryEmail\(\{[\s\S]*?trackingUrl:\s+await clientTrackingUrl\(db, ev\.id\),/],
    '../send-event-report/index.ts': [/sendEventReportEmail\(\{[\s\S]*?trackingUrl: await clientTrackingUrl\(db, eventId\),/],
    '../media-expiry/reminders.ts': [/renderMediaExpiryReminderEmail\(\{[\s\S]*?trackingUrl: await clientTrackingUrl\(db, ev\.id\),/],
    '../review-design/index.ts': [
      /const trackingUrl = await clientTrackingUrl\(db, event\.id\);/,
      /renderHomeApprovalEmail\(\{[^}]*trackingUrl \}\)/,
      /renderHomeRejectionEmail\(\{[^}]*trackingUrl \}\)/,
      /renderFramesReviewEmail\(\{[^}]*trackingUrl \}\)/,
      /sendApprovalEmail\(\{[^}]*trackingUrl,\n\s+\}\)/,
      /sendRejectionEmail\(\{[^}]*trackingUrl,\n\s+\}\)/,
    ],
  };
  for (const [file, patterns] of Object.entries(senders)) {
    const src = read(file);
    assert.match(src, /import \{ clientTrackingUrl \} from '\.\.\/_shared\/client-tracking\.ts';/, file);
    for (const p of patterns) assert.match(src, p, file);
  }
});

test('modèles Brevo : TRACKING_URL (vide sans lien) dans l\'accès et la relance', () => {
  const email = readFileSync(new URL('./email.ts', import.meta.url), 'utf8');
  assert.equal(email.split("TRACKING_URL: trackingUrl ?? '',").length - 1, 2);
});
