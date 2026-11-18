import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAILTO_MAX_LENGTH, MESSAGE_MAX_LENGTH, TOOL_MAX_LENGTH, VENDOR_EMAIL,
  buildVendorMailto, parseTopic, topicLabel, validateVendorRequest,
} from './vendorRequest.js';

function decode(link) {
  const [head, query] = link.split('?');
  const params = new URLSearchParams(query.replace(/\+/g, '%2B'));
  return { to: head.replace(/^mailto:/, ''), subject: params.get('subject'), body: params.get('body') };
}

const BASE = { tool: 'Axonaut', origin: 'https://photobooth.exemple.fr', version: 'abc1234' };

test('adresse : une seule, bien formée', () => {
  assert.match(VENDOR_EMAIL, /^[a-z]+@[a-z]+\.[a-z]+$/);
});

test('sujet : connector par défaut, module:<id> pour un module', () => {
  assert.deepEqual(parseTopic('connector'), { kind: 'connector' });
  assert.deepEqual(parseTopic(undefined), { kind: 'connector' });
  assert.deepEqual(parseTopic('module:audio_guestbook'), { kind: 'module', id: 'audio_guestbook' });
  assert.equal(topicLabel('connector'), 'connecteur de facturation');
  assert.equal(topicLabel('module:audio_guestbook'), 'module audio_guestbook');
});

test('validation : outil obligatoire (80 caractères), message facultatif (2 000 caractères)', () => {
  assert.equal(validateVendorRequest({ tool: '   ', message: '' }).errors.tool, 'Indiquez l\'outil voulu.');
  assert.ok(validateVendorRequest({ tool: 'x'.repeat(TOOL_MAX_LENGTH + 1) }).errors.tool);
  assert.ok(validateVendorRequest({ tool: 'x'.repeat(TOOL_MAX_LENGTH) }).valid);
  assert.ok(validateVendorRequest({ tool: 'Axonaut', message: 'x'.repeat(MESSAGE_MAX_LENGTH + 1) }).errors.message);
  const ok = validateVendorRequest({ tool: '  Axonaut ', message: ' merci ' });
  assert.deepEqual(ok, { tool: 'Axonaut', message: 'merci', errors: {}, valid: true });
});

test('lien : adresse, objet et texte de la demande de connecteur', () => {
  const link = buildVendorMailto({ ...BASE, message: 'Nous facturons avec Axonaut.\nMerci !' });
  assert.ok(link.startsWith(`mailto:${VENDOR_EMAIL}?subject=`));
  const { to, subject, body } = decode(link);
  assert.equal(to, VENDOR_EMAIL);
  assert.equal(subject, 'Polabooth : demande de connecteur Axonaut');
  assert.equal(body, [
    'Outil demandé : Axonaut',
    'Sujet : connecteur de facturation',
    'Message : Nous facturons avec Axonaut.\r\nMerci !',
    'Instance : https://photobooth.exemple.fr',
    'Version : abc1234',
  ].join('\r\n'));
});

test('lien : message vide = « (aucun) », sujet module, instance et version inconnues', () => {
  const { subject, body } = decode(buildVendorMailto({ tool: 'Galerie', topic: 'module:gallery' }));
  assert.equal(subject, 'Polabooth : demande du module Galerie');
  assert.equal(body, [
    'Outil demandé : Galerie',
    'Sujet : module gallery',
    'Message : (aucun)',
    'Instance : inconnue',
    'Version : inconnue',
  ].join('\r\n'));
});

test('lien : tout est encodé (espaces, accents, &, ?, #, +, retours à la ligne)', () => {
  const link = buildVendorMailto({ ...BASE, tool: 'Sage & Co ?', message: 'a+b #1 été\n' });
  assert.doesNotMatch(link.split('?').slice(1).join('?'), /[ \n\r#]|&(?!body=)/);
  const { subject, body } = decode(link);
  assert.equal(subject, 'Polabooth : demande de connecteur Sage & Co ?');
  assert.match(body, /^Message : a\+b #1 été$/m);
});

test('lien : 1 800 caractères au plus, message tronqué au-delà', () => {
  const message = 'é'.repeat(MESSAGE_MAX_LENGTH);
  const link = buildVendorMailto({ ...BASE, message });
  assert.ok(link.length <= MAILTO_MAX_LENGTH, `longueur ${link.length}`);
  const { body } = decode(link);
  const kept = /^Message : (.*)$/m.exec(body)[1];
  assert.ok(kept.endsWith('…'));
  assert.ok(kept.length > 100, 'le message garde ce qui tient');
  assert.match(body, /Version : abc1234$/, 'les lignes suivantes restent entières');
});

test('lien : le pire outil (80 caractères accentués) et un long message tiennent encore', () => {
  const link = buildVendorMailto({ ...BASE, tool: '€'.repeat(TOOL_MAX_LENGTH), message: '😀'.repeat(1000) });
  assert.ok(link.length <= MAILTO_MAX_LENGTH, `longueur ${link.length}`);
  assert.ok(decode(link).body.includes('😀…'), 'émojis coupés entre deux caractères');
});

test('lien : un message court n\'est jamais tronqué', () => {
  const message = 'Bonjour, nous utilisons Axonaut pour nos factures.';
  assert.match(decode(buildVendorMailto({ ...BASE, message })).body, new RegExp(`Message : ${message}\r\n`));
});
