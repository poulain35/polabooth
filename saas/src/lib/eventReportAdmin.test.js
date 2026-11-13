// LAB-238 : carte « Bilan client » (fonctions pures de eventReportAdmin.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKER_CODES, DEFAULT_FOR_VALUES, NOTHING_TO_REPORT, NO_CLIENT_EMAIL, blockerMessages, defaultReportPhotos,
  eventReportDefaultFor, initialReportSelection, isReportProposed, kioskStatusLines,
  previewReport, reportErrorMessage, reportLink, reportPhotoCandidates, reportStatus, sendState, toggleReportPhoto,
} from './eventReportAdmin.js';
import { BLOCKER_CODES as SERVER_CODES } from '../../supabase/functions/send-event-report/logic.ts';

const TOKEN = '3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f';
const APP = 'https://photobooth.exemple.fr';

/** n photos approuvées, une par minute à partir de 20 h (heure UTC), dans le désordre. */
const photos = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`,
  status: 'approved',
  photo_url: `https://cdn.example.com/p${i}.jpg`,
  thumbnail_url: `https://cdn.example.com/p${i}_thumb.jpg`,
  captured_at: new Date(Date.UTC(2026, 11, 12, 20, i)).toISOString(),
  created_at: new Date(Date.UTC(2026, 11, 13, 9, n - i)).toISOString(),
  ...over,
})).reverse();

test('parité : mêmes codes de blocage que send-event-report', () => {
  assert.deepEqual(BLOCKER_CODES, [...SERVER_CODES]);
});

test('6 photos réparties sur la soirée : première et dernière comprises, ordre chronologique', () => {
  assert.deepEqual(defaultReportPhotos(photos(31)), ['p0', 'p6', 'p12', 'p18', 'p24', 'p30']);
  assert.deepEqual(defaultReportPhotos(photos(11)), ['p0', 'p2', 'p4', 'p6', 'p8', 'p10']);
  const ids = defaultReportPhotos(photos(7));
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.equal(ids[0], 'p0');
  assert.equal(ids.at(-1), 'p6');
});

test('moins de 6 photos : toutes ; une seule : elle ; aucune : rien', () => {
  assert.deepEqual(defaultReportPhotos(photos(4)), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(defaultReportPhotos(photos(1)), ['p0']);
  assert.deepEqual(defaultReportPhotos([]), []);
  assert.deepEqual(defaultReportPhotos(null), []);
});

test('candidates : approuvées avec vignette seulement, captured_at puis created_at', () => {
  const list = [
    { id: 'a', status: 'approved', photo_url: 'https://x/a.jpg', created_at: '2026-12-12T22:00:00Z' },
    { id: 'b', status: 'pending', photo_url: 'https://x/b.jpg', captured_at: '2026-12-12T19:00:00Z' },
    { id: 'c', status: 'approved', photo_url: 'https://x/c.mp4', captured_at: '2026-12-12T19:00:00Z' },
    { id: 'd', status: 'approved', photo_url: 'https://x/d.mp4', thumbnail_url: 'https://x/d.jpg', captured_at: '2026-12-12T21:00:00Z' },
    { id: 'e', status: 'approved', photo_url: 'http://x/e.jpg', captured_at: '2026-12-12T18:00:00Z' },
  ];
  assert.deepEqual(reportPhotoCandidates(list).map((p) => p.id), ['d', 'a']);
});

test('choix à la main : 6 au plus, retrait au second clic', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(toggleReportPhoto(six, 'g'), six);
  assert.deepEqual(toggleReportPhoto(six, 'c'), ['a', 'b', 'd', 'e', 'f']);
  assert.deepEqual(toggleReportPhoto(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleReportPhoto(undefined, 'a'), ['a']);
});

test('sélection initiale : celle en base si ses photos existent encore, sinon le choix par défaut', () => {
  const list = photos(31);
  assert.deepEqual(initialReportSelection(['p3', 'gone', 'p1'], list), ['p3', 'p1']);
  assert.deepEqual(initialReportSelection(['gone'], list), defaultReportPhotos(list));
  assert.deepEqual(initialReportSelection([], list), defaultReportPhotos(list));
});

test('messages des blocages : texte de la spec, nom de la borne', () => {
  const kiosks = [
    { label: 'Borne 2', state: 'pending', pending_uploads: 3 },
    { label: 'Borne 1', state: 'not_seen' },
  ];
  assert.deepEqual(blockerMessages(['kiosk_pending', 'kiosk_not_seen', 'no_client_email'], kiosks), [
    'La borne Borne 2 n’a pas fini d’envoyer ses photos et ses impressions. Allumez-la avec une connexion, puis actualisez le bilan.',
    'La borne Borne 1 n’a pas été connectée depuis l’événement.',
    NO_CLIENT_EMAIL,
  ]);
  assert.equal(NO_CLIENT_EMAIL, 'Ajoutez l’e-mail du client dans la fiche de l’événement.');
});

test('messages des blocages : sans borne nommée, message générique ; chaque code a un message', () => {
  assert.deepEqual(blockerMessages(['kiosk_not_seen'], []), ['La borne n’a pas été connectée depuis l’événement.']);
  for (const code of BLOCKER_CODES) assert.equal(blockerMessages([code], []).length, 1, code);
  assert.deepEqual(blockerMessages(['inconnu'], []), []);
  assert.deepEqual(blockerMessages(null), []);
});

test('erreurs : P0001 traduit, 22023 « Rien à présenter », autre message gardé', () => {
  assert.equal(reportErrorMessage({ code: '22023', message: 'build_event_report : rien a presenter' }), NOTHING_TO_REPORT);
  assert.equal(reportErrorMessage({ code: 'nothing_to_report' }), NOTHING_TO_REPORT);
  assert.equal(
    reportErrorMessage({ code: 'P0001', message: 'build_event_report : envoi bloque (no_client_email)' }),
    NO_CLIENT_EMAIL,
  );
  assert.match(
    reportErrorMessage({ code: 'blocked', blockers: ['kiosk_pending'], message: 'x' }, [{ label: 'Borne 2', state: 'pending' }]),
    /^La borne Borne 2 n’a pas fini d’envoyer/,
  );
  assert.equal(reportErrorMessage({ code: '42501' }), 'Événement introuvable.');
  assert.equal(reportErrorMessage({ message: 'Brevo a refusé' }), 'Brevo a refusé');
  assert.equal(reportErrorMessage(null), '');
});

test('« Envoyer » désactivé tant qu’une borne a des envois en attente, avec le message', () => {
  const prepared = {
    report: { id: 'r', token: TOKEN, status: 'draft' },
    kiosks: [{ label: 'Borne 2', state: 'pending', pending_uploads: 2 }],
    blockers: ['kiosk_pending'],
  };
  const s = sendState(prepared);
  assert.equal(s.canSend, false);
  assert.deepEqual(s.reasons, ['La borne Borne 2 n’a pas fini d’envoyer ses photos et ses impressions. Allumez-la avec une connexion, puis actualisez le bilan.']);
});

test('« Envoyer » : actif sans blocage, désactivé pendant un envoi ou avant préparation', () => {
  const prepared = { report: { id: 'r', token: TOKEN }, kiosks: [{ label: 'Borne 1', state: 'ok' }], blockers: [] };
  assert.deepEqual(sendState(prepared), { canSend: true, reasons: [] });
  assert.equal(sendState(prepared, { busy: true }).canSend, false);
  assert.deepEqual(sendState(null), { canSend: false, reasons: [] });
  assert.equal(sendState({ ...prepared, blockers: ['no_client_email'] }).canSend, false);
});

test('état des bornes : une ligne lisible par état', () => {
  const lines = kioskStatusLines([
    { label: 'Borne 1', state: 'ok', last_seen_at: '2026-12-13T10:05:00Z' },
    { label: 'Borne 2', state: 'pending', pending_uploads: 1 },
    { label: 'Borne 3', state: 'pending', pending_uploads: 4 },
    { label: '', state: 'unknown' },
    { label: 'Borne 5', state: 'not_seen' },
  ]);
  assert.equal(lines[0].text, 'Tout est envoyé, vue le 13 décembre à 11:05');
  assert.equal(lines[1].text, '1 élément en attente');
  assert.equal(lines[2].text, '4 éléments en attente');
  assert.equal(lines[3].label, 'Borne');
  assert.equal(lines[4].text, 'Pas connectée depuis l’événement');
  assert.deepEqual(kioskStatusLines(null), []);
});

test('statut : envoyé avec « Bilan arrêté au », révoqué, brouillon', () => {
  const sent = reportStatus({ status: 'sent', sent_at: '2026-12-19T09:31:00Z', frozen_at: '2026-12-19T09:30:00Z', expires_at: '2027-12-19T09:30:00Z' });
  assert.equal(sent.label, 'Envoyé');
  assert.equal(sent.detail, 'Envoyé le 19 décembre 2026 · Bilan arrêté au 19 décembre 2026 · lien valable jusqu’au 19 décembre 2027');
  assert.equal(reportStatus({ status: 'revoked' }).label, 'Lien coupé');
  assert.equal(reportStatus({ status: 'draft' }).label, 'Brouillon');
  assert.equal(reportStatus(null).tone, 'none');
});

test('aperçu : photos choisies dans l’ordre choisi, au format de la RPC', () => {
  const list = photos(3);
  const report = { name: 'Soirée', photos: [], token: TOKEN };
  const preview = previewReport(report, list, ['p2', 'gone', 'p0']);
  assert.deepEqual(preview.photos, [
    { id: 'p2', url: 'https://cdn.example.com/p2.jpg', thumbnail_url: 'https://cdn.example.com/p2_thumb.jpg' },
    { id: 'p0', url: 'https://cdn.example.com/p0.jpg', thumbnail_url: 'https://cdn.example.com/p0_thumb.jpg' },
  ]);
  assert.equal(preview.name, 'Soirée');
  assert.equal(previewReport(null, list, []), null);
});

test('lien : /rapport/{token}', () => {
  assert.equal(reportLink(`${APP}/`, TOKEN), `${APP}/rapport/${TOKEN}`);
  assert.equal(reportLink(APP, null), '');
});

test('réglage default_for : défaut professionnel, valeurs de la contrainte CHECK', () => {
  assert.deepEqual(DEFAULT_FOR_VALUES, ['professionnel', 'tous', 'aucun']);
  assert.equal(eventReportDefaultFor(null), 'professionnel');
  assert.equal(eventReportDefaultFor({ event_report: { default_for: 'tous' } }), 'tous');
  assert.equal(eventReportDefaultFor({ event_report: { default_for: 'n/a' } }), 'professionnel');
});

test('proposé d’office : comme la RPC (pro par défaut, sans lead = non)', () => {
  assert.equal(isReportProposed('professionnel', 'professionnel'), true);
  assert.equal(isReportProposed('professionnel', 'particulier'), false);
  assert.equal(isReportProposed('professionnel', null), false);
  assert.equal(isReportProposed('tous', null), true);
  assert.equal(isReportProposed('aucun', 'professionnel'), false);
});
