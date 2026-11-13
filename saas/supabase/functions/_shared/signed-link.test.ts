import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  base64url, generateNonce, linkSecretProblem, signDecisionLink, timingSafeEqual, verifyDecisionLink, MIN_LINK_SECRET_BYTES,
  DECISION_LINK_TTL_SECONDS,
} from './signed-link.ts';

const SECRET = 'test-secret';
const LEAD = '6f1c2a3e-1111-4222-8333-944455556666';
const NOW = Date.UTC(2027, 0, 10, 12, 0, 0);

function parse(url: string) {
  const u = new URL(url);
  return { path: u.pathname, a: u.searchParams.get('a'), exp: u.searchParams.get('exp'), n: u.searchParams.get('n'), sig: u.searchParams.get('sig') };
}

test('base64url : sans padding ni + /', () => {
  assert.equal(base64url(new Uint8Array([0xfb, 0xff, 0xfe])), '-__-');
  assert.equal(base64url(new Uint8Array([1])), 'AQ');
});

test('generateNonce : 128 bits, distincts', () => {
  const a = generateNonce();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, generateNonce());
});

test('signDecisionLink : forme du lien et signature conforme à la spec', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://photobooth.exemple.fr/', leadId: LEAD, action: 'accept', nonce: 'abc', now: NOW });
  const p = parse(link.url);
  assert.equal(p.path, `/admin/demandes/${LEAD}`);
  assert.equal(p.a, 'accept');
  assert.equal(p.n, 'abc');
  assert.equal(Number(p.exp), NOW / 1000 + DECISION_LINK_TTL_SECONDS);
  const expected = createHmac('sha256', SECRET).update(`${LEAD}.accept.${p.exp}.abc`).digest('base64url');
  assert.equal(p.sig, expected);
});

test('verifyDecisionLink : lien valide', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://x.test', leadId: LEAD, action: 'refuse', nonce: 'n1', now: NOW });
  const p = parse(link.url);
  const r = await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, now: NOW + 1000 });
  assert.deepEqual(r, { ok: true, action: 'refuse', nonce: 'n1', exp: link.exp });
});

test('verifyDecisionLink : expiré au-delà de 14 jours', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://x.test', leadId: LEAD, action: 'accept', nonce: 'n1', now: NOW });
  const p = parse(link.url);
  const later = NOW + (DECISION_LINK_TTL_SECONDS + 1) * 1000;
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, now: later }), { ok: false, reason: 'expired' });
});

test('verifyDecisionLink : toute altération casse la signature', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://x.test', leadId: LEAD, action: 'refuse', nonce: 'n1', now: NOW });
  const p = parse(link.url);
  const bad = { ok: false, reason: 'bad_signature' };
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, a: 'accept', now: NOW }), bad);
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, n: 'n2', now: NOW }), bad);
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, exp: String(Number(p.exp) + 1), now: NOW }), bad);
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: 'autre-lead', ...p, now: NOW }), bad);
  assert.deepEqual(await verifyDecisionLink({ secret: 'autre', leadId: LEAD, ...p, now: NOW }), bad);
});

test('verifyDecisionLink : paramètres invalides', async () => {
  const base = { secret: SECRET, leadId: LEAD, a: 'accept', exp: '1900000000', n: 'x', sig: 'y', now: NOW };
  assert.deepEqual(await verifyDecisionLink({ ...base, a: 'delete' }), { ok: false, reason: 'malformed' });
  assert.deepEqual(await verifyDecisionLink({ ...base, exp: 'abc' }), { ok: false, reason: 'malformed' });
  assert.deepEqual(await verifyDecisionLink({ ...base, exp: '01900000000' }), { ok: false, reason: 'malformed' });
  assert.deepEqual(await verifyDecisionLink({ ...base, sig: null }), { ok: false, reason: 'malformed' });
  assert.deepEqual(await verifyDecisionLink({ ...base, secret: '' }), { ok: false, reason: 'malformed' });
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

// ── Couverture complémentaire (agent Test LAB-58) ────────────────────────────

test('verifyDecisionLink : encore valide à la seconde d\'expiration, expiré une seconde après', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://x.test', leadId: LEAD, action: 'extend', nonce: 'n1', now: NOW });
  const p = parse(link.url);
  const atExp = await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, now: link.exp * 1000 + 999 });
  assert.equal(atExp.ok, true);
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, now: (link.exp + 1) * 1000 }), { ok: false, reason: 'expired' });
});

test('verifyDecisionLink : signature vérifiée avant l\'expiration (un lien forgé expiré reste bad_signature)', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://x.test', leadId: LEAD, action: 'accept', nonce: 'n1', now: NOW });
  const p = parse(link.url);
  const later = NOW + (DECISION_LINK_TTL_SECONDS + 10) * 1000;
  assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, a: 'refuse', now: later }), { ok: false, reason: 'bad_signature' });
});

test('verifyDecisionLink : signature tronquée, rallongée ou à la casse modifiée refusée', async () => {
  const link = await signDecisionLink({ secret: SECRET, baseUrl: 'https://x.test', leadId: LEAD, action: 'expire', nonce: 'n1', now: NOW });
  const p = parse(link.url);
  const sig = p.sig!;
  const flipped = sig.toUpperCase() === sig ? sig.toLowerCase() : sig.toUpperCase();
  const bad = { ok: false, reason: 'bad_signature' };
  for (const s of [sig.slice(0, -1), sig + 'A', sig.slice(0, 10), flipped, `${sig}=`]) {
    assert.deepEqual(await verifyDecisionLink({ secret: SECRET, leadId: LEAD, ...p, sig: s, now: NOW }), bad, s);
  }
});

test('timingSafeEqual : longueurs différentes avec préfixe commun, différence en tête ou en queue', () => {
  assert.equal(timingSafeEqual('ab', 'abc'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
  assert.equal(timingSafeEqual('', 'a'), false);
  assert.equal(timingSafeEqual('a'.repeat(43), 'a'.repeat(42) + 'b'), false);
  assert.equal(timingSafeEqual('b' + 'a'.repeat(42), 'a'.repeat(43)), false);
  assert.equal(timingSafeEqual('ab\u0000', 'ab'), false);
});

test('linkSecretProblem : secret absent ou < 32 octets refusé', () => {
  assert.equal(MIN_LINK_SECRET_BYTES, 32);
  assert.equal(linkSecretProblem(undefined), 'BOOKING_LINK_SECRET manquant');
  assert.equal(linkSecretProblem(''), 'BOOKING_LINK_SECRET manquant');
  assert.match(linkSecretProblem('a'.repeat(31)) ?? '', /trop court \(31 octets, minimum 32\)/);
  assert.equal(linkSecretProblem('a'.repeat(32)), null);
  assert.equal(linkSecretProblem('é'.repeat(16)), null);
});
