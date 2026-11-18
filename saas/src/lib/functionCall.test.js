// LAB-420 : un seul assistant pour les appels aux edge functions (en-têtes, corps, erreurs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SESSION_EXPIRED_MESSAGE, createFunctionCaller } from './functionCall.js';

const BASE = 'https://projet.supabase.co/functions/v1';
const ANON = 'cle-anon';

function response(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, { status, headers });
}

// fetch et session simulés : chaque appel est noté, la réponse est celle donnée.
function caller({ session = { access_token: 'jeton-admin' }, reply = () => response(200, { ok: true }) } = {}) {
  const calls = [];
  let sessionReads = 0;
  const api = createFunctionCaller({
    baseUrl: BASE,
    anonKey: ANON,
    getSession: async () => { sessionReads += 1; return session; },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(); },
  });
  return { ...api, calls, sessionReads: () => sessionReads };
}

test('appel anonyme : apikey et Content-Type JSON, jamais de jeton, session non lue', async () => {
  const c = caller();
  const data = await c.callFunction('submit-design', { json: { code: 'ABC', kind: 'print' }, fallback: 'Erreur' });
  assert.deepEqual(data, { ok: true });
  assert.equal(c.calls.length, 1);
  const { url, init } = c.calls[0];
  assert.equal(url, `${BASE}/submit-design`);
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', apikey: ANON });
  assert.equal(init.body, JSON.stringify({ code: 'ABC', kind: 'print' }));
  assert.equal(c.sessionReads(), 0);
});

test('appel admin : jeton de la session en Authorization, en plus de apikey', async () => {
  const c = caller({ session: { access_token: 'tok-123' } });
  await c.callFunction('review-design', { admin: true, json: { design_id: 'd1' }, fallback: 'Erreur' });
  assert.deepEqual(c.calls[0].init.headers, {
    'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer tok-123',
  });
});

test('appel admin sans session : erreur « Session expirée » (401), rien n’est envoyé', async () => {
  const c = caller({ session: null });
  await assert.rejects(
    c.callFunction('send-delivery', { admin: true, json: {}, fallback: 'Erreur' }),
    (err) => err.message === SESSION_EXPIRED_MESSAGE && err.status === 401,
  );
  await assert.rejects(c.fetchFunction('google-font-file', { admin: true, json: {} }), { message: SESSION_EXPIRED_MESSAGE });
  assert.equal(c.calls.length, 0);
});

test('corps : `json` sérialisé (`{}` donne « {} »), `body` envoyé tel quel avec son type', async () => {
  const c = caller();
  await c.callFunction('send-test-email', { admin: true, json: {}, fallback: 'Erreur' });
  assert.equal(c.calls[0].init.body, '{}');

  const serialized = JSON.stringify({ code: 'ABC', canvas_json: { objects: [] } });
  await c.callFunction('autosave-design', { body: serialized, fallback: 'Erreur' });
  assert.equal(c.calls[1].init.body, serialized);
  assert.equal(c.calls[1].init.headers['Content-Type'], 'application/json');

  const bytes = new Uint8Array([137, 80, 78, 71]);
  await c.callFunction('upload-design-image?code=ABC', { body: bytes, contentType: 'image/png', fallback: 'Erreur' });
  assert.equal(c.calls[2].init.body, bytes);
  assert.deepEqual(c.calls[2].init.headers, { 'Content-Type': 'image/png', apikey: ANON });
});

test('GET sans corps : pas de Content-Type ; méthode, adresse et signal transmis', async () => {
  const c = caller();
  const controller = new AbortController();
  await c.callFunction('get-event?code=AB%20C', { method: 'GET', signal: controller.signal, fallback: 'Erreur serveur' });
  const { url, init } = c.calls[0];
  assert.equal(url, `${BASE}/get-event?code=AB%20C`);
  assert.equal(init.method, 'GET');
  assert.equal(init.body, undefined);
  assert.deepEqual(init.headers, { apikey: ANON });
  assert.equal(init.signal, controller.signal);

  await c.callFunction('delete-photo', { admin: true, method: 'DELETE', json: { photo_id: 'p1' }, fallback: 'Erreur' });
  assert.equal(c.calls[1].init.method, 'DELETE');
  assert.equal(c.calls[1].init.body, '{"photo_id":"p1"}');
});

test('erreur HTTP : message du serveur, statut et code portés par l’erreur', async () => {
  const c = caller({ reply: () => response(403, { error: 'Accès refusé', code: 'forbidden' }) });
  await assert.rejects(
    c.callFunction('email-sync', { admin: true, json: {}, fallback: 'Erreur lors de la synchronisation du suivi' }),
    (err) => err.message === 'Accès refusé' && err.status === 403 && err.code === 'forbidden' && err.rateLimited === false,
  );
});

test('erreur HTTP sans message : le texte de repli de l’appel', async () => {
  const c = caller({ reply: () => response(500, { detail: 'boom' }) });
  await assert.rejects(
    c.callFunction('kiosk-admin-pin', { admin: true, json: {}, fallback: "Erreur lors de l'enregistrement du PIN" }),
    { message: "Erreur lors de l'enregistrement du PIN", status: 500 },
  );
});

test('erreur HTTP au corps non JSON (passerelle) : texte de repli, et message clair pour un 429', async () => {
  const html = caller({ reply: () => response(502, '<html>Bad gateway</html>', { 'Content-Type': 'text/html' }) });
  await assert.rejects(html.callFunction('assistant-chat', { json: {}, fallback: 'Erreur assistant' }), {
    message: 'Erreur assistant', status: 502,
  });

  const limited = caller({ reply: () => response(429, '', { 'Retry-After': '30' }) });
  await assert.rejects(limited.callFunction('submit-support-message', { json: {}, fallback: 'Envoi du message échoué' }), {
    message: 'Trop de requêtes. Réessayez dans 30 secondes.', rateLimited: true, retryAfter: 30,
  });
});

test('réponse 200 au corps non JSON ou vide : {} au lieu d’une erreur de lecture', async () => {
  const c = caller({ reply: () => response(200, 'pas du json') });
  assert.deepEqual(await c.callFunction('gcal-sync', { admin: true, json: {}, fallback: 'Erreur' }), {});
  const empty = caller({ reply: () => response(204, null) });
  assert.deepEqual(await empty.callFunction('gcal-sync', { admin: true, json: {}, fallback: 'Erreur' }), {});
});

test('errorFields : champs de la réponse ajoutés à l’erreur', async () => {
  const c = caller({ reply: () => response(422, { error: 'Bilan incomplet', blockers: ['photos'] }) });
  await assert.rejects(
    c.callFunction('send-event-report', {
      admin: true, json: {}, fallback: 'Le bilan n’a pas pu être envoyé',
      errorFields: (data) => ({ blockers: data.blockers }),
    }),
    (err) => err.message === 'Bilan incomplet' && err.status === 422 && err.blockers[0] === 'photos',
  );
});

test('requestFunction ne lève pas sur un statut d’erreur : { res, data } lus par l’appelant', async () => {
  const c = caller({ reply: () => response(404, { error: 'Cadre introuvable' }) });
  const { res, data } = await c.requestFunction('autosave-design', { json: { code: 'ABC', delete: true } });
  assert.equal(res.status, 404);
  assert.deepEqual(data, { error: 'Cadre introuvable' });
});

test('fetchFunction rend la réponse brute (fichier de police) sans lire le corps', async () => {
  const font = new Uint8Array([0, 1, 0, 0]);
  const c = caller({ reply: () => new Response(font, { status: 200, headers: { 'Content-Type': 'font/ttf' } }) });
  const res = await c.fetchFunction('google-font-file', { admin: true, json: { family: 'Lexend', weight: 400 } });
  assert.equal(res.headers.get('Content-Type'), 'font/ttf');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), font);
  assert.equal(c.calls[0].init.body, '{"family":"Lexend","weight":400}');
});

test('lib/api : plus de fetch aux edge functions hors de l’assistant, sauf get-photos', () => {
  const dir = new URL('./api/', import.meta.url);
  const files = ['designs', 'emails', 'eventReports', 'kioskConfig', 'kiosks', 'kioskScreens', 'library',
    'photos', 'planning', 'settings', 'support'];
  for (const name of files) {
    const src = readFileSync(new URL(`${name}.js`, dir), 'utf8');
    assert.doesNotMatch(src, /fetch\(`\$\{FUNCTIONS_URL\}/, `${name}.js appelle encore une fonction par fetch`);
    assert.doesNotMatch(src, /access_token/, `${name}.js construit encore l’en-tête de session`);
  }
  // Seule exception : get-photos (GET, clé anon en Authorization, repli silencieux sur {}).
  const photos = readFileSync(new URL('photos.js', dir), 'utf8');
  assert.equal([...photos.matchAll(/FUNCTIONS_URL/g)].length, 2);
  assert.match(photos, /fetch\(getPhotosUrl\(FUNCTIONS_URL, code, link\)/);
  // L'assistant branché sur le client partagé.
  const functions = readFileSync(new URL('functions.js', dir), 'utf8');
  assert.match(functions, /baseUrl: FUNCTIONS_URL, anonKey: supabaseAnon, getSession: currentSession/);
});
