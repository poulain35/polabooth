// LAB-245 : envoyer l'événement sur la borne depuis le SaaS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_PUSH_OFFLINE_MESSAGE,
  EVENT_PUSH_SOON_MESSAGE,
  canCancelEventPush,
  defaultPushKiosk,
  eventPushHint,
  eventPushMessage,
  eventPushStatus,
  eventPushStatusFor,
  isEventPushable,
  isKioskOffline,
  kioskChoices,
  pushableEvents,
  pushableKiosks,
} from './kioskEventPush.js';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const TZ = 'Europe/Paris';
const lic = (over = {}) => ({
  id: 'k1',
  label: 'Borne 1',
  org_id: 'o1',
  is_active: true,
  retired_at: null,
  last_seen_at: '2026-11-05T09:58:00Z',
  event_push_id: 'e1',
  event_push_requested_at: '2026-11-05T09:55:00.123456+00:00',
  event_push_received_at: null,
  event_push_applied_at: null,
  event_push_error: null,
  ...over,
});

test('eventPushStatus : aucun envoi', () => {
  assert.equal(eventPushStatus(lic({ event_push_id: null }), NOW).state, 'none');
  assert.equal(eventPushStatus(lic({ event_push_requested_at: null }), NOW).state, 'none');
  assert.equal(eventPushStatus(null, NOW).state, 'none');
});

test('eventPushStatus : envoyé, reçu, affiché, échec', () => {
  assert.equal(eventPushStatus(lic(), NOW).state, 'requested');
  assert.equal(eventPushStatus(lic({ event_push_received_at: '2026-11-05T09:56:00Z' }), NOW).state, 'received');
  const applied = eventPushStatus(lic({
    event_push_received_at: '2026-11-05T09:56:00Z',
    event_push_applied_at: '2026-11-05T09:56:30Z',
  }), NOW);
  assert.equal(applied.state, 'applied');
  const failed = eventPushStatus(lic({ event_push_received_at: '2026-11-05T09:56:00Z', event_push_error: 'Pas de design' }), NOW);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'Pas de design');
});

test('isKioskOffline : plus de 10 min sans signal, ou jamais vue', () => {
  assert.equal(isKioskOffline(lic(), NOW), false);
  assert.equal(isKioskOffline(lic({ last_seen_at: '2026-11-05T09:50:00Z' }), NOW), false);
  assert.equal(isKioskOffline(lic({ last_seen_at: '2026-11-05T09:49:59Z' }), NOW), true);
  assert.equal(isKioskOffline(lic({ last_seen_at: null }), NOW), true);
  assert.equal(eventPushStatus(lic({ last_seen_at: null }), NOW).offline, true);
});

test('eventPushMessage : textes de la spec, heure HH:MM', () => {
  assert.equal(eventPushMessage(eventPushStatus(lic(), NOW), TZ), 'Envoyé à 10:55 — en attente de la borne');
  assert.equal(
    eventPushMessage(eventPushStatus(lic({ event_push_received_at: '2026-11-05T09:56:00Z' }), NOW), TZ),
    'Reçu par la borne à 10:56',
  );
  assert.equal(
    eventPushMessage(eventPushStatus(lic({ event_push_applied_at: '2026-11-05T09:57:00Z' }), NOW), TZ),
    'Affiché sur la borne à 10:57 ✓',
  );
  assert.equal(
    eventPushMessage(eventPushStatus(lic({ event_push_error: 'aucun design approuvé' }), NOW), TZ),
    "La borne n'a pas pu charger l'événement : aucun design approuvé",
  );
  assert.equal(eventPushMessage({ state: 'none' }, TZ), null);
  assert.equal(EVENT_PUSH_OFFLINE_MESSAGE, "Borne hors ligne : l'événement sera chargé à son prochain démarrage.");
});

test('eventPushHint : borne en ligne, chargé dans les prochaines secondes (LAB-246)', () => {
  assert.equal(EVENT_PUSH_SOON_MESSAGE, 'La borne va le charger dans les prochaines secondes');
  assert.equal(eventPushHint(eventPushStatus(lic(), NOW)), EVENT_PUSH_SOON_MESSAGE);
  // Reçu par une borne en ligne : elle attend la fin de la séance invité.
  assert.equal(eventPushHint(eventPushStatus(lic({ event_push_received_at: '2026-11-05T09:56:00Z' }), NOW)), null);
});

test('eventPushHint : borne hors ligne, chargé au prochain démarrage', () => {
  const offline = { last_seen_at: '2026-11-05T09:40:00Z' };
  assert.equal(eventPushHint(eventPushStatus(lic(offline), NOW)), EVENT_PUSH_OFFLINE_MESSAGE);
  assert.equal(
    eventPushHint(eventPushStatus(lic({ ...offline, event_push_received_at: '2026-11-05T09:56:00Z' }), NOW)),
    EVENT_PUSH_OFFLINE_MESSAGE,
  );
  assert.equal(eventPushHint(eventPushStatus(lic({ last_seen_at: null }), NOW)), EVENT_PUSH_OFFLINE_MESSAGE);
});

test('eventPushHint : rien une fois affiché, en échec ou sans envoi', () => {
  assert.equal(eventPushHint(eventPushStatus(lic({ event_push_applied_at: '2026-11-05T09:57:00Z' }), NOW)), null);
  assert.equal(
    eventPushHint(eventPushStatus(lic({ event_push_applied_at: '2026-11-05T09:57:00Z', last_seen_at: null }), NOW)),
    null,
  );
  assert.equal(eventPushHint(eventPushStatus(lic({ event_push_error: 'x' }), NOW)), null);
  assert.equal(eventPushHint(eventPushStatus(lic({ event_push_id: null }), NOW)), null);
  assert.equal(eventPushHint(null), null);
});

test('canCancelEventPush : jusqu\'à l\'affichage', () => {
  assert.equal(canCancelEventPush(eventPushStatus(lic(), NOW)), true);
  assert.equal(canCancelEventPush(eventPushStatus(lic({ event_push_received_at: '2026-11-05T09:56:00Z' }), NOW)), true);
  assert.equal(canCancelEventPush(eventPushStatus(lic({ event_push_error: 'x' }), NOW)), true);
  assert.equal(canCancelEventPush(eventPushStatus(lic({ event_push_applied_at: '2026-11-05T09:57:00Z' }), NOW)), false);
  assert.equal(canCancelEventPush({ state: 'none' }), false);
});

test('eventPushStatusFor : autre événement en attente sur la borne', () => {
  assert.equal(eventPushStatusFor(lic(), 'e1', NOW).state, 'requested');
  const other = eventPushStatusFor(lic(), 'e2', NOW);
  assert.equal(other.state, 'none');
  assert.equal(other.otherPending, true);
  const otherDone = eventPushStatusFor(lic({ event_push_applied_at: '2026-11-05T09:57:00Z' }), 'e2', NOW);
  assert.equal(otherDone.otherPending, false);
  assert.equal(eventPushStatusFor(lic({ event_push_id: null }), 'e2', NOW).otherPending, false);
});

test('kioskChoices : borne retirée gardée seulement si elle est assignée', () => {
  const list = [lic(), lic({ id: 'k2', label: 'Ancienne', retired_at: '2026-10-01T00:00:00Z' })];
  assert.deepEqual(kioskChoices(list, 'k1').map((c) => c.id), ['k1']);
  const withRetired = kioskChoices(list, 'k2');
  assert.deepEqual(withRetired.map((c) => c.label), ['Borne 1', 'Ancienne (retirée)']);
  assert.equal(withRetired[1].retired, true);
  assert.deepEqual(kioskChoices(undefined, null), []);
});

test('pushableKiosks : actives, non retirées, du compte', () => {
  const list = [
    lic(),
    lic({ id: 'k2', retired_at: '2026-10-01T00:00:00Z' }),
    lic({ id: 'k3', is_active: false }),
    lic({ id: 'k4', org_id: 'o2' }),
  ];
  assert.deepEqual(pushableKiosks(list, 'o1').map((k) => k.id), ['k1']);
});

test('defaultPushKiosk : borne assignée, sinon la seule borne', () => {
  const kiosks = [{ id: 'k1' }, { id: 'k2' }];
  assert.equal(defaultPushKiosk(kiosks, 'k2'), 'k2');
  assert.equal(defaultPushKiosk(kiosks, 'k9'), '');
  assert.equal(defaultPushKiosk([{ id: 'k1' }], null), 'k1');
  assert.equal(defaultPushKiosk([], null), '');
});

test('pushableEvents : même compte, en cours, ceux de la borne d\'abord puis par date', () => {
  const events = [
    { id: 'a', org_id: 'o1', status: 'active', start_date: '2026-11-10', photobooth_id: null },
    { id: 'b', org_id: 'o1', status: 'submitted', start_date: '2026-11-08', photobooth_id: null },
    { id: 'c', org_id: 'o1', status: 'active', start_date: '2026-12-01', photobooth_id: 'k1' },
    { id: 'd', org_id: 'o1', status: 'archived', start_date: '2026-11-01', photobooth_id: 'k1' },
    { id: 'e', org_id: 'o2', status: 'active', start_date: '2026-11-01', photobooth_id: null },
    { id: 'f', org_id: 'o1', status: 'active', start_date: null, photobooth_id: null },
  ];
  assert.deepEqual(pushableEvents(events, 'o1', 'k1').map((e) => e.id), ['c', 'b', 'a', 'f']);
  assert.equal(isEventPushable({ status: 'archived' }), false);
  assert.equal(isEventPushable({ status: 'submitted' }), true);
});
