// Tests des vérifications de la messagerie (LAB-376) : fonctions pures et échange avec un faux serveur
// SMTP (socket simulé, install-checks.fixture.mjs). Aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authMechanisms, buildTestEmail, encodeHeaderWord, formatAddress, parseSmtpReplies, pickAuthMechanism,
  rfc5322Date, smtpCheck, smtpData, SmtpError, smtpFailure, TEST_EMAIL_SUBJECT,
} from './install-checks-smtp.mjs';
import { fakeSmtp, smtpConfig } from './install-checks.fixture.mjs';

// ── SMTP : fonctions pures ──────────────────────────────────────────────────────────────────

test('parseSmtpReplies : réponses multilignes, tampon incomplet', () => {
  const { replies, rest } = parseSmtpReplies('220 bonjour\r\n250-smtp.exemple.fr\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000\r\n250-PIPEL');
  assert.deepEqual(replies.map((r) => r.code), [220, 250]);
  assert.deepEqual(replies[1].lines, ['smtp.exemple.fr', 'AUTH PLAIN LOGIN', 'SIZE 1000']);
  assert.equal(rest, '250-PIPEL');
  assert.equal(parseSmtpReplies('535 5.7.8 Authentication failed\n').replies[0].text, '5.7.8 Authentication failed');
});

test('authMechanisms : AUTH et AUTH=, choix PLAIN puis LOGIN', () => {
  assert.deepEqual(authMechanisms(['smtp.x', 'AUTH LOGIN PLAIN CRAM-MD5', 'AUTH=LOGIN']), ['LOGIN', 'PLAIN', 'CRAM-MD5']);
  assert.equal(pickAuthMechanism(['LOGIN', 'PLAIN']), 'PLAIN');
  assert.equal(pickAuthMechanism(['LOGIN']), 'LOGIN');
  assert.equal(pickAuthMechanism(['CRAM-MD5', 'XOAUTH2']), null);
});

const decodeWords = (header) => header.split('\r\n ').map((w) => {
  const m = w.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
  assert.ok(m, `mot encodé invalide : ${w}`);
  assert.ok(w.length <= 75, 'mot encodé de 75 caractères au plus');
  return Buffer.from(m[1], 'base64');
});

test('encodeHeaderWord et formatAddress : UTF-8 encodé (RFC 2047), ASCII tel quel', () => {
  assert.equal(encodeHeaderWord(TEST_EMAIL_SUBJECT), TEST_EMAIL_SUBJECT);
  const long = 'Boîte à photos « Élodie & Cie » — événements, mariages, anniversaires et séminaires';
  const encoded = encodeHeaderWord(long);
  assert.ok(encoded.includes('\r\n '), 'en-tête replié sur plusieurs lignes');
  assert.equal(Buffer.concat(decodeWords(encoded)).toString('utf8'), long);
  assert.equal(formatAddress('Studio Exemple', 'a@b.fr'), 'Studio Exemple <a@b.fr>');
  assert.equal(formatAddress('Studio "X", Rennes', 'a@b.fr'), '"Studio \\"X\\", Rennes" <a@b.fr>');
  assert.equal(formatAddress('', 'a@b.fr'), '<a@b.fr>');
  assert.match(formatAddress('Société Équipée', 'a@b.fr'), /^=\?UTF-8\?B\?[^ ]+\?= <a@b\.fr>$/);
});

test('buildTestEmail : en-têtes MIME, lignes CRLF, corps UTF-8 en base64 ; smtpData double les points', () => {
  const date = new Date('2026-11-18T10:00:00Z');
  assert.equal(rfc5322Date(date), 'Wed, 18 Nov 2026 10:00:00 +0000');
  const email = buildTestEmail({ fromEmail: 'contact@exemple.fr', fromName: 'Boîte Pola', to: 'admin@exemple.fr', smtpHost: 'smtp.exemple.fr', date, messageId: 'id@exemple.fr' });
  assert.ok(!/[^\r]\n/.test(email), 'aucune fin de ligne sans CR');
  const [head, body] = email.split('\r\n\r\n');
  assert.match(head, /^From: =\?UTF-8\?B\?/);
  assert.match(head, /\r\nTo: <admin@exemple\.fr>\r\n/);
  assert.match(head, /\r\nSubject: Polabooth : votre messagerie fonctionne\r\n/);
  assert.match(head, /\r\nDate: Wed, 18 Nov 2026 10:00:00 \+0000\r\n/);
  assert.match(head, /\r\nMessage-ID: <id@exemple\.fr>\r\nMIME-Version: 1\.0\r\nContent-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64$/);
  assert.ok(body.split('\r\n').every((l) => l.length <= 76));
  const text = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(text, /Votre messagerie \(smtp\.exemple\.fr\) fonctionne/);
  assert.match(text, /Rien à faire/);
  assert.equal(smtpData('a\r\n.b\r\nc'), 'a\r\n..b\r\nc\r\n.\r\n');
});

test('smtpFailure : hôte introuvable, refus, délai, certificat, identifiants, expéditeur', () => {
  const ctx = { host: 'smtp.exemple.fr', port: '465', user: 'contact@exemple.fr', fromEmail: 'contact@exemple.fr', to: 'admin@exemple.fr' };
  const net = (code) => smtpFailure(new SmtpError('connect', { code, cause: Object.assign(new Error(code), { code }) }), ctx);
  assert.match(net('ENOTFOUND').message, /introuvable/);
  assert.match(net('ECONNREFUSED').message, /Connexion refusée/);
  assert.match(net('ETIMEDOUT').message, /Pas de réponse .* en 15 s/);
  assert.match(net('CERT_HAS_EXPIRED').message, /Certificat/);
  assert.match(net('ERR_SSL_WRONG_VERSION_NUMBER').hint, /465/);
  const reply = (stage, code, text) => smtpFailure(new SmtpError(stage, { code: 'REPLY', reply: { code, text } }), ctx);
  assert.match(reply('auth', 535, '5.7.8 Authentication failed').message, /Identifiants SMTP refusés pour contact@exemple\.fr \(535/);
  assert.match(reply('auth', 534, '5.7.9 Application-specific password required').hint, /mot de passe d'application/);
  assert.match(reply('mail', 553, '5.7.1 Sender address rejected').message, /FROM_EMAIL \(contact@exemple\.fr\) n'est pas autorisé/);
  assert.match(reply('rcpt', 550, 'no such user').message, /ADMIN_EMAIL/);
  assert.match(reply('auth', 421, 'try later').message, /temporaire/);
  assert.match(smtpFailure(new SmtpError('auth', { code: 'NO_AUTH', offered: ['XOAUTH2'] }), ctx).message, /ni AUTH PLAIN ni AUTH LOGIN \(proposées : XOAUTH2\)/);
});

test('smtpCheck : TLS direct, AUTH PLAIN, email de test envoyé', async () => {
  const smtp = fakeSmtp();
  assert.deepEqual(await smtpCheck(smtpConfig, { connect: smtp.connect, now: new Date('2026-11-18T10:00:00Z'), randomId: () => 'abc' }), { mechanism: 'PLAIN', sent: true });
  assert.deepEqual(smtp.log, ['connect smtp.exemple.fr:465 tls', 'EHLO exemple.fr', 'AUTH PLAIN …', 'MAIL FROM:<contact@exemple.fr>', 'RCPT TO:<admin@exemple.fr>', 'DATA', 'QUIT']);
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0], /Subject: Polabooth : votre messagerie fonctionne\r\n/);
  assert.match(smtp.messages[0], /Message-ID: <polabooth-verification-abc@exemple\.fr>/);
});

test('smtpCheck : AUTH LOGIN si PLAIN absent ; connexion et identifiants seulement sans envoi', async () => {
  const smtp = fakeSmtp({ auth: 'LOGIN' });
  assert.deepEqual(await smtpCheck(smtpConfig, { connect: smtp.connect, sendEmail: false }), { mechanism: 'LOGIN', sent: false });
  assert.deepEqual(smtp.log.slice(1), ['EHLO exemple.fr', 'AUTH LOGIN', '…', '…', 'QUIT']);
  assert.equal(smtp.messages.length, 0);
});

test('smtpCheck : mauvais mot de passe, expéditeur refusé, pas de réponse', async () => {
  await assert.rejects(smtpCheck({ ...smtpConfig, smtpPassword: 'faux' }, { connect: fakeSmtp().connect }), (e) => e.stage === 'auth' && e.reply.code === 535);
  await assert.rejects(smtpCheck(smtpConfig, { connect: fakeSmtp({ fromAllowed: false }).connect }), (e) => e.stage === 'mail' && e.reply.code === 553);
  await assert.rejects(smtpCheck(smtpConfig, { connect: fakeSmtp({ silent: true }).connect, timeoutMs: 20 }), (e) => e.stage === 'greeting' && e.code === 'ETIMEDOUT');
  await assert.rejects(smtpCheck(smtpConfig, { connect: fakeSmtp({ connectError: 'ENOTFOUND' }).connect }), (e) => e.stage === 'connect' && e.code === 'ENOTFOUND');
  await assert.rejects(smtpCheck(smtpConfig, { connect: fakeSmtp({ auth: '' }).connect }), (e) => e.code === 'NO_AUTH');
});
