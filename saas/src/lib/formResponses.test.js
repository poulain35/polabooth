// LAB-217 : les consentements photo de la borne ne sont ni des réponses client ni des statistiques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KIOSK_CONSENT_TYPE, NOT_KIOSK_CONSENT_FILTER, isKioskConsentRow, withoutKioskConsents, latestResponsePerEvent,
  FORM_DISABLED_MESSAGE, FORM_GENERIC_MESSAGE, FORM_INVALID_MESSAGE, FORM_RATE_LIMITED_MESSAGE,
  FORM_UNKNOWN_EVENT_MESSAGE, formSubmitErrorMessage, isFormRateLimited,
} from './formResponses.js';

const consent = (id, eventId, at) => ({
  id, event_id: eventId, submitted_at: at,
  answers: { type: 'rgpd_consent', accepted: true, timestamp: at },
});
const client = (id, eventId, at, answers = { q_event_type: 'Mariage' }) => ({ id, event_id: eventId, submitted_at: at, answers });

test('isKioskConsentRow : vrai seulement pour answers.type = rgpd_consent', () => {
  assert.equal(KIOSK_CONSENT_TYPE, 'rgpd_consent');
  assert.equal(isKioskConsentRow(consent('c', 'e', '2026-11-01T10:00:00Z')), true);
  assert.equal(isKioskConsentRow({ answers: { type: 'rgpd_consent', accepted: false } }), true);
  assert.equal(isKioskConsentRow(client('r', 'e', '2026-11-01T10:00:00Z')), false);
  assert.equal(isKioskConsentRow({ answers: { type: 'autre' } }), false);
  assert.equal(isKioskConsentRow({ answers: {} }), false);
  assert.equal(isKioskConsentRow({ answers: null }), false);
  assert.equal(isKioskConsentRow({}), false);
  assert.equal(isKioskConsentRow(null), false);
});

test('withoutKioskConsents : garde les vraies réponses, dans le même ordre', () => {
  const rows = [
    consent('c1', 'e1', '2026-11-03T10:00:00Z'),
    client('r1', 'e1', '2026-11-02T10:00:00Z'),
    consent('c2', 'e1', '2026-11-01T10:00:00Z'),
    client('r2', 'e2', '2026-10-30T10:00:00Z'),
  ];
  assert.deepEqual(withoutKioskConsents(rows).map((r) => r.id), ['r1', 'r2']);
  assert.equal(rows.length, 4, 'ne modifie pas le tableau reçu');
  assert.deepEqual(withoutKioskConsents(null), []);
  assert.deepEqual(withoutKioskConsents([]), []);
});

test('latestResponsePerEvent : un consentement plus récent ne masque pas la réponse du client', () => {
  const rows = [
    consent('c1', 'e1', '2026-11-03T20:00:00Z'),
    client('r-old', 'e1', '2026-10-01T10:00:00Z', { q_event_type: 'Anniversaire' }),
    client('r-new', 'e1', '2026-10-15T10:00:00Z', { q_event_type: 'Mariage' }),
    consent('c2', 'e2', '2026-11-02T20:00:00Z'),
    client('r-e3', 'e3', '2026-10-20T10:00:00Z'),
  ];
  const latest = latestResponsePerEvent(rows);
  assert.deepEqual(latest.map((r) => r.id), ['r-e3', 'r-new']);
  assert.equal(latest.find((r) => r.event_id === 'e1').answers.q_event_type, 'Mariage');
  assert.equal(latest.some((r) => r.event_id === 'e2'), false, 'un événement sans réponse client ne compte pas');
  assert.equal(rows[0].id, 'c1', 'ne trie pas le tableau reçu');
});

test('latestResponsePerEvent : vide sans réponse client', () => {
  assert.deepEqual(latestResponsePerEvent([consent('c', 'e', '2026-11-01T10:00:00Z')]), []);
  assert.deepEqual(latestResponsePerEvent(null), []);
});

test('filtre PostgREST : garde les lignes sans type, exclut rgpd_consent', () => {
  assert.equal(NOT_KIOSK_CONSENT_FILTER, 'answers->>type.is.null,answers->>type.neq.rgpd_consent');
});

test('supabase.js : les lectures admin filtrent côté requête et côté client', () => {
  const src = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
  for (const fn of ['getFormResponses', 'getAllFormResponses']) {
    const body = src.slice(src.indexOf(`export async function ${fn}(`)).split(/\nexport /)[0];
    assert.match(body, /\.or\(NOT_KIOSK_CONSENT_FILTER\)/, fn);
    assert.match(body, /return withoutKioskConsents\(data\);/, fn);
  }
});

test('get-event : la réponse précédente du client ignore les consentements de la borne', () => {
  const src = readFileSync(new URL('../../supabase/functions/get-event/index.ts', import.meta.url), 'utf8');
  const query = src.slice(src.indexOf(".from('event_form_responses')")).split('.maybeSingle()')[0];
  assert.ok(query.includes(`.or('${NOT_KIOSK_CONSENT_FILTER}')`), 'même filtre que src/lib/formResponses.js');
  assert.match(query, /\.limit\(1\)/);
});

// ── LAB-277 : envoi par la RPC submit_form_response ─────────────────────────────────────────

test("formSubmitErrorMessage : limite d'envois reconnue par code, indice ou statut HTTP", () => {
  assert.equal(FORM_RATE_LIMITED_MESSAGE, "Trop d'envois, réessayez dans quelques minutes.");
  for (const error of [{ code: 'PT429' }, { hint: 'trop_de_requetes' }, { status: 429 }, { code: 'PT429', message: "Trop d'envois depuis cette adresse." }]) {
    assert.equal(isFormRateLimited(error), true, JSON.stringify(error));
    assert.equal(formSubmitErrorMessage(error), FORM_RATE_LIMITED_MESSAGE, JSON.stringify(error));
  }
  for (const error of [null, undefined, {}, { code: '22023' }, { status: 401 }]) assert.equal(isFormRateLimited(error), false);
});

test('formSubmitErrorMessage : formulaire ou fonctionnalité désactivés, réponses invalides, autre erreur', () => {
  assert.equal(formSubmitErrorMessage({ code: 'PT404', message: 'fonctionnalite_desactivee' }), FORM_DISABLED_MESSAGE);
  assert.equal(formSubmitErrorMessage({ code: 'P0001', message: 'formulaire_desactive' }), FORM_DISABLED_MESSAGE);
  assert.equal(formSubmitErrorMessage({ code: '22023', message: 'submit_form_response : reponses invalides' }), FORM_INVALID_MESSAGE);
  for (const error of [{ code: '42501' }, { message: 'Failed to fetch' }, null]) {
    assert.equal(formSubmitErrorMessage(error), FORM_GENERIC_MESSAGE);
  }
  // Aucun message technique (code SQL, nom de fonction) montré au client.
  for (const m of [FORM_RATE_LIMITED_MESSAGE, FORM_DISABLED_MESSAGE, FORM_INVALID_MESSAGE, FORM_GENERIC_MESSAGE, FORM_UNKNOWN_EVENT_MESSAGE]) {
    assert.doesNotMatch(m, /submit_form_response|PT\d{3}|22023|_/);
  }
});

test('submitFormResponse : RPC submit_form_response avec le code, plus aucun INSERT direct', () => {
  const src = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function submitFormResponse'), src.indexOf('export async function reviewDesign'));
  assert.match(fn, /export async function submitFormResponse\(\{ code, answers \}\)/);
  assert.match(fn, /supabase\.rpc\('submit_form_response', \{ p_code: code, p_answers: answers \}\)/);
  assert.match(fn, /throw new Error\(formSubmitErrorMessage\(error\)\)/);
  // false : code inconnu ou événement inactif (la RPC ne lève pas, pour compter l'échec).
  assert.match(fn, /if \(data !== true\) throw new Error\(FORM_UNKNOWN_EVENT_MESSAGE\)/);
  assert.doesNotMatch(src, /from\(\s*'event_form_responses'\s*\)\s*\.insert\(/);

  const form = readFileSync(new URL('../components/ClientForm.jsx', import.meta.url), 'utf8');
  assert.match(form, /export default function ClientForm\(\{ code, event,/);
  assert.match(form, /await submitFormResponse\(\{ code, answers \}\);/);
  const page = readFileSync(new URL('../pages/EditorPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<ClientForm\s+code=\{code\}/);
});
