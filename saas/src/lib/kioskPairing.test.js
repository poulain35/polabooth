// LAB-243 : saisie du code de la borne et messages de la page /associer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePairingCode, pairingCodeProblem, isValidPairingCode, pairingCodeHint, formatPairingCode,
  minutesLeft, isRateLimitError, lookupStatusMessage, approveResultMessage, pairingErrorMessage,
  pairingFollowState, suggestedKioskLabel, safeNextPath, PAIRING_ALPHABET,
  MSG_NOT_FOUND, MSG_EXPIRED, MSG_USED, MSG_RATE_LIMITED, MSG_OTHER_ACCOUNT,
} from './kioskPairing.js';

test('normalizePairingCode : minuscules, tiret et espaces acceptés', () => {
  assert.equal(normalizePairingCode('k7m4qp'), 'K7M4QP');
  assert.equal(normalizePairingCode('K7M-4QP'), 'K7M4QP');
  assert.equal(normalizePairingCode('  k7m 4qp '), 'K7M4QP');
  assert.equal(normalizePairingCode('k7m–4qp'), 'K7M4QP');
  assert.equal(normalizePairingCode(null), '');
});

test('normalizePairingCode : O→0, I et L→1, puis refusés', () => {
  assert.equal(normalizePairingCode('kom4qp'), 'K0M4QP');
  assert.equal(normalizePairingCode('kim4ql'), 'K1M4Q1');
  assert.equal(pairingCodeProblem(normalizePairingCode('kom4qp')), 'ambiguous');
  assert.equal(pairingCodeProblem(normalizePairingCode('kum4qp')), 'ambiguous');
  assert.match(pairingCodeHint('K0M4QP'), /jamais 0, 1, O, I, L ni U/);
});

test('pairingCodeProblem : longueur et code vide', () => {
  assert.equal(pairingCodeProblem(''), 'empty');
  assert.equal(pairingCodeProblem('K7M4Q'), 'too_short');
  assert.equal(pairingCodeProblem('K7M4QPX'), 'too_long');
  assert.equal(pairingCodeProblem('K7M4QP'), null);
  assert.equal(pairingCodeHint(''), null);
  assert.equal(pairingCodeHint('K7M4QP'), null);
  assert.equal(pairingCodeHint('K7M'), 'Le code compte 6 caractères.');
  assert.ok(isValidPairingCode('ZZZ222'));
  assert.equal(PAIRING_ALPHABET.length, 30);
});

test('formatPairingCode : XXX-XXX', () => {
  assert.equal(formatPairingCode('K7M4QP'), 'K7M-4QP');
  assert.equal(formatPairingCode('K7M'), 'K7M');
  assert.equal(formatPairingCode('K7M4'), 'K7M-4');
});

test('minutesLeft : arrondi au-dessus, 0 si expiré', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  assert.equal(minutesLeft('2026-11-05T10:07:00Z', now), 7);
  assert.equal(minutesLeft('2026-11-05T10:06:01Z', now), 7);
  assert.equal(minutesLeft('2026-11-05T10:00:30Z', now), 1);
  assert.equal(minutesLeft('2026-11-05T09:59:00Z', now), 0);
  assert.equal(minutesLeft(null, now), 0);
});

test('isRateLimitError : PT429 ou indice trop_de_requetes', () => {
  assert.ok(isRateLimitError({ code: 'PT429' }));
  assert.ok(isRateLimitError({ code: 'P0001', hint: 'trop_de_requetes' }));
  assert.ok(!isRateLimitError({ code: '42501' }));
  assert.ok(!isRateLimitError(null));
});

test('lookupStatusMessage : un message par refus, rien pour pending', () => {
  assert.equal(lookupStatusMessage('pending'), null);
  assert.equal(lookupStatusMessage('not_found'), MSG_NOT_FOUND);
  assert.equal(lookupStatusMessage('expired'), MSG_EXPIRED);
  assert.equal(lookupStatusMessage('approved'), MSG_USED);
  assert.equal(lookupStatusMessage('delivered'), MSG_USED);
  assert.match(lookupStatusMessage('cancelled'), /annulé/);
});

test('approveResultMessage : refus de kiosk_pairing_approve', () => {
  assert.equal(approveResultMessage({ status: 'ok', mode: 'new' }), null);
  assert.equal(approveResultMessage({ status: 'not_found' }), MSG_NOT_FOUND);
  assert.equal(approveResultMessage({ status: 'expired' }), MSG_EXPIRED);
  assert.equal(approveResultMessage({ status: 'used' }), MSG_USED);
  assert.equal(approveResultMessage({ status: 'other_account' }), MSG_OTHER_ACCOUNT);
  assert.equal(
    approveResultMessage({ status: 'limit_reached', count: 3, limit: 3 }),
    'Votre compte compte déjà 3 bornes sur 3. Retirez une borne ou contactez votre loueur.',
  );
  assert.match(approveResultMessage({ status: 'limit_reached', count: 1, limit: 1 }), /déjà 1 borne sur 1\./);
  assert.match(approveResultMessage({ status: 'pc_in_use', label: 'Borne 2' }), /« Borne 2 »/);
  assert.match(approveResultMessage({ status: 'inconnu' }), /échoué/);
  assert.match(approveResultMessage(null), /échoué/);
});

test('pairingErrorMessage : exceptions des RPC', () => {
  assert.equal(pairingErrorMessage({ code: 'PT429' }), MSG_RATE_LIMITED);
  assert.match(pairingErrorMessage({ code: '22023' }), /80 caractères/);
  assert.match(pairingErrorMessage({ code: '42501', message: 'kiosk_pairing_approve : aucun compte pour cet utilisateur' }), /Aucun compte/);
  assert.match(pairingErrorMessage({ code: '42501', message: 'kiosk_pairing_approve : borne a remplacer introuvable dans ce compte' }), /remplacer/);
  assert.match(pairingErrorMessage({ code: '42501', message: 'kiosk_pairing_approve : seul le super-admin peut choisir un autre compte' }), /super-admin/);
  assert.match(pairingErrorMessage(new TypeError('Failed to fetch')), /réseau/);
});

test('pairingFollowState : connecté à la remise du secret', () => {
  assert.equal(pairingFollowState('approved'), 'waiting');
  assert.equal(pairingFollowState('delivered'), 'connected');
  assert.equal(pairingFollowState('cancelled'), 'stopped');
  assert.equal(pairingFollowState(undefined), 'waiting');
});

test('suggestedKioskLabel : nom de la borne connue, sinon nom du PC', () => {
  assert.equal(suggestedKioskLabel({ machine_name: 'DESKTOP-42', license: { label: 'Borne 2' } }), 'Borne 2');
  assert.equal(suggestedKioskLabel({ machine_name: 'DESKTOP-42', license: { label: null } }), 'DESKTOP-42');
  assert.equal(suggestedKioskLabel({ machine_name: 'DESKTOP-42' }), 'DESKTOP-42');
  assert.equal(suggestedKioskLabel(null), '');
  assert.equal(suggestedKioskLabel({ machine_name: 'x'.repeat(100) }).length, 80);
});

test('safeNextPath : chemins internes seulement', () => {
  assert.equal(safeNextPath('/admin/events'), '/admin/events');
  assert.equal(safeNextPath('/admin/demandes/abc-123'), '/admin/demandes/abc-123');
  assert.equal(safeNextPath('/associer'), '/associer');
  assert.equal(safeNextPath('/associer?code=K7M4QP'), '/associer?code=K7M4QP');
  assert.equal(safeNextPath('/associer?code=k7m-4qp&replace=0b6c'), '/associer?code=k7m-4qp&replace=0b6c');
  assert.equal(safeNextPath('//evil.com/admin/'), null);
  assert.equal(safeNextPath('https://evil.com'), null);
  assert.equal(safeNextPath('/associer/../x'), null);
  assert.equal(safeNextPath('/associerx'), null);
  assert.equal(safeNextPath('/associer?code=<script>'), null);
  assert.equal(safeNextPath(null), null);
});
