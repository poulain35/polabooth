// Tests du rendu de l'email de rappel avant expiration (LAB-212). Exécution : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMediaExpiryReminderEmail } from './email.ts';

const EXPIRES = '2026-12-01T22:59:00Z'; // 1er décembre 23:59 à Paris

test('email : photos + audio, date longue en français, deux boutons', () => {
  const { subject, html } = renderMediaExpiryReminderEmail({
    clientName: 'Léa', eventName: 'Mariage Léa & Tom', expiresAt: EXPIRES,
    photosUrl: 'https://app.test/photos/ABC', audioUrl: 'https://app.test/audio/ABC',
  });
  assert.equal(subject, '⏳ Pensez à télécharger vos souvenirs — Mariage Léa & Tom');
  assert.match(html, /1 décembre 2026/);
  assert.match(html, /Les photos et les messages du livre d'or audio/);
  assert.match(html, /https:\/\/app\.test\/photos\/ABC/);
  assert.match(html, /https:\/\/app\.test\/audio\/ABC/);
  assert.match(html, /Mariage Léa &amp; Tom/); // échappé dans le corps
  assert.match(html, /Tout télécharger/);
});

test('email : photos seules ou audio seul', () => {
  const photos = renderMediaExpiryReminderEmail({ clientName: null, eventName: null, expiresAt: EXPIRES, photosUrl: 'https://app.test/photos/X' });
  assert.match(photos.html, /Les photos de votre événement/);
  assert.doesNotMatch(photos.html, /\/audio\//);
  assert.match(photos.html, /Bonjour,/);
  assert.equal(photos.subject, '⏳ Pensez à télécharger vos souvenirs');

  const audio = renderMediaExpiryReminderEmail({ clientName: 'Paul', eventName: 'Anniv', expiresAt: EXPIRES, audioUrl: 'https://app.test/audio/X' });
  assert.match(audio.html, /Les messages du livre d'or audio/);
  assert.doesNotMatch(audio.html, /\/photos\//);
});

test('email : nom client échappé', () => {
  const { html } = renderMediaExpiryReminderEmail({ clientName: '<b>x</b>', eventName: 'E', expiresAt: EXPIRES, photosUrl: 'https://app.test/p' });
  assert.doesNotMatch(html, /<b>x<\/b>/);
});
