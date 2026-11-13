import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionError, rateLimitMessage, readJson, retryAfterSeconds, retryHint } from './httpErrors.js';

const res = (status, headers = {}) => ({ status, headers: new Headers(headers) });

test('retryHint : secondes, minutes, heures', () => {
  assert.equal(retryHint(1), 'Réessayez dans 1 seconde.');
  assert.equal(retryHint(30), 'Réessayez dans 30 secondes.');
  assert.equal(retryHint(90), 'Réessayez dans 2 minutes.');
  assert.equal(retryHint(7200), 'Réessayez dans 2 heures.');
});

test('retryAfterSeconds : corps prioritaire, puis en-tête, sinon null', () => {
  assert.equal(retryAfterSeconds(res(429, { 'Retry-After': '30' }), { retry_after: 12 }), 12);
  assert.equal(retryAfterSeconds(res(429, { 'Retry-After': '30' }), {}), 30);
  assert.equal(retryAfterSeconds(res(429), {}), null);
  assert.equal(retryAfterSeconds(res(429, { 'Retry-After': 'Wed, 21 Oct 2027 07:28:00 GMT' }), {}), null);
});

test('functionError : 429 avec message serveur ⇒ message serveur conservé', () => {
  const err = functionError(
    res(429, { 'Retry-After': '120' }),
    { error: 'Trop de requêtes. Réessayez dans 2 minutes.', code: 'trop_de_requetes', retry_after: 120 },
    'Erreur serveur',
  );
  assert.equal(err.message, 'Trop de requêtes. Réessayez dans 2 minutes.');
  assert.equal(err.status, 429);
  assert.equal(err.code, 'trop_de_requetes');
  assert.equal(err.retryAfter, 120);
  assert.equal(err.rateLimited, true);
});

test('functionError : 429 sans corps exploitable (passerelle) ⇒ message clair, jamais le repli générique', () => {
  assert.equal(functionError(res(429, { 'Retry-After': '45' }), {}, 'Erreur serveur').message, 'Trop de requêtes. Réessayez dans 45 secondes.');
  assert.equal(functionError(res(429), {}, 'Erreur serveur').message, rateLimitMessage(null));
  assert.equal(functionError(res(429), { error: 'rate limit exceeded' }, 'Erreur').message, rateLimitMessage(null));
});

test('functionError : autres statuts ⇒ data.error puis repli (comportement inchangé)', () => {
  const e404 = functionError(res(404), { error: 'Code d\'accès invalide' }, 'Erreur serveur');
  assert.equal(e404.message, 'Code d\'accès invalide');
  assert.equal(e404.rateLimited, false);
  assert.equal(e404.retryAfter, null);
  assert.equal(functionError(res(500), {}, 'Erreur serveur').message, 'Erreur serveur');
});

test('readJson : corps non JSON ⇒ objet vide', async () => {
  assert.deepEqual(await readJson({ json: () => Promise.reject(new SyntaxError('x')) }), {});
  assert.deepEqual(await readJson({ json: () => Promise.resolve({ a: 1 }) }), { a: 1 });
});

test('functionError : refus Brevo (502 brevo_refused) ⇒ motif serveur affiché, code et statut conservés (LAB-126)', () => {
  const body = {
    error: "L'email de livraison n'a pas été envoyé : Brevo a refusé l'envoi (Brevo 400 : invalid email). Réessayez.",
    code: 'brevo_refused',
  };
  const err = functionError(res(502), body, "Erreur lors de l'envoi de la livraison");
  assert.equal(err.message, body.error);
  assert.equal(err.code, 'brevo_refused');
  assert.equal(err.status, 502);
  assert.equal(err.rateLimited, false);
});

test('functionError : 502 de passerelle (HTML, corps illisible) ⇒ message de repli, jamais un succès (LAB-126)', async () => {
  const data = await readJson({ json: () => Promise.reject(new SyntaxError('<html>')) });
  const err = functionError(res(502), data, "Erreur lors de l'envoi");
  assert.equal(err.message, "Erreur lors de l'envoi");
  assert.equal(err.code, null);
});

test('readJson : corps de succès des envois manuels rendu tel quel (skipped compris)', async () => {
  const ok = { message: 'Livraison déjà envoyée', skipped: true };
  assert.deepEqual(await readJson({ json: () => Promise.resolve(ok) }), ok);
});
