// Rappel « Contacts à exporter » (LAB-224).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportReminderBadge, exportReminderDetail, exportReminderText, guestExportReminder,
  guestExportReminders, parisDaysUntil, URGENT_DAYS,
} from './guestExportReminder.js';

const NOW = new Date('2026-11-10T10:00:00Z');

const EVENT = {
  id: 'ev1',
  name: 'Salon des vins',
  start_date: '2026-11-07T08:00:00Z',
  end_date: '2026-11-08T17:00:00Z',
  guest_responses_exported_at: null,
};
const SUMMARY = {
  event_id: 'ev1',
  response_count: 12,
  consent_count: 5,
  last_received_at: '2026-11-08T18:00:00Z',
  purge_at: '2026-12-08T17:00:00Z',
};

test('événement terminé jamais exporté : rappel avec la date de suppression (Paris)', () => {
  const r = guestExportReminder(SUMMARY, EVENT, NOW);
  assert.deepEqual(r, {
    eventId: 'ev1',
    eventName: 'Salon des vins',
    responseCount: 12,
    purgeAt: '2026-12-08T17:00:00Z',
    purgeDate: '08/12/2026',
    daysLeft: 28,
    urgent: false,
    newSinceExport: false,
  });
});

test('pas de rappel sans réponse ni résumé', () => {
  assert.equal(guestExportReminder(null, EVENT, NOW), null);
  assert.equal(guestExportReminder({ ...SUMMARY, response_count: 0 }, EVENT, NOW), null);
  assert.equal(guestExportReminder(SUMMARY, null, NOW), null);
  assert.equal(guestExportReminder({ ...SUMMARY, purge_at: null }, EVENT, NOW), null);
});

test('response_count en chaîne (bigint) accepté', () => {
  assert.equal(guestExportReminder({ ...SUMMARY, response_count: '3' }, EVENT, NOW).responseCount, 3);
});

test('événement pas encore terminé : pas de rappel', () => {
  const ongoing = { ...EVENT, end_date: '2026-11-10T20:00:00Z' };
  assert.equal(guestExportReminder(SUMMARY, ongoing, NOW), null);
});

test('sans end_date, start_date fait foi ; sans aucune date, rappel affiché', () => {
  const startOnlyPast = { ...EVENT, end_date: null, start_date: '2026-11-09T08:00:00Z' };
  assert.ok(guestExportReminder(SUMMARY, startOnlyPast, NOW));
  const startOnlyFuture = { ...EVENT, end_date: null, start_date: '2026-11-11T08:00:00Z' };
  assert.equal(guestExportReminder(SUMMARY, startOnlyFuture, NOW), null);
  const noDates = { ...EVENT, end_date: null, start_date: null };
  assert.ok(guestExportReminder(SUMMARY, noDates, NOW));
});

test('exporté après la dernière réponse : plus de rappel', () => {
  const exported = { ...EVENT, guest_responses_exported_at: '2026-11-09T09:00:00Z' };
  assert.equal(guestExportReminder(SUMMARY, exported, NOW), null);
});

test('réponses reçues après le dernier export : rappel de nouveau', () => {
  const exported = { ...EVENT, guest_responses_exported_at: '2026-11-08T17:30:00Z' };
  const r = guestExportReminder(SUMMARY, exported, NOW);
  assert.ok(r);
  assert.equal(r.newSinceExport, true);
});

test('urgent quand il reste moins de 7 jours calendaires (Paris)', () => {
  // purge le 08/12 à 18:00 Paris
  assert.equal(guestExportReminder(SUMMARY, EVENT, new Date('2026-12-01T10:00:00Z')).urgent, false);
  const r = guestExportReminder(SUMMARY, EVENT, new Date('2026-12-02T10:00:00Z'));
  assert.equal(r.daysLeft, URGENT_DAYS - 1);
  assert.equal(r.urgent, true);
  // purge déjà passée mais lignes pas encore supprimées par le job : toujours affiché, urgent
  const late = guestExportReminder(SUMMARY, EVENT, new Date('2026-12-09T01:00:00Z'));
  assert.equal(late.daysLeft, -1);
  assert.equal(late.urgent, true);
});

test('parisDaysUntil : jour de Paris, pas d\'UTC', () => {
  // 23:30 UTC le 04/12 = 00:30 le 05/12 à Paris
  assert.equal(parisDaysUntil('2026-12-04T23:30:00Z', new Date('2026-12-04T12:00:00Z')), 1);
  assert.equal(parisDaysUntil('2026-12-04T22:30:00Z', new Date('2026-12-04T00:30:00Z')), 0);
  // passage à l'heure d'été (29/03/2026) : toujours 1 jour
  assert.equal(parisDaysUntil('2026-03-29T22:30:00Z', new Date('2026-03-28T23:30:00Z')), 1);
});

test('texte de la carte et du bandeau', () => {
  const r = guestExportReminder(SUMMARY, EVENT, NOW);
  assert.equal(exportReminderDetail(r), 'Contacts à exporter · 12 réponses · suppression à partir du 08/12/2026');
  assert.equal(exportReminderText(r), 'Salon des vins · Contacts à exporter · 12 réponses · suppression à partir du 08/12/2026');
  const one = guestExportReminder({ ...SUMMARY, response_count: 1 }, { ...EVENT, name: '' }, NOW);
  assert.equal(exportReminderText(one), 'Événement sans nom · Contacts à exporter · 1 réponse · suppression à partir du 08/12/2026');
});

test('badge : délai affiché seulement quand c\'est urgent', () => {
  const base = guestExportReminder(SUMMARY, EVENT, NOW);
  assert.equal(exportReminderBadge(base), 'Contacts');
  assert.equal(exportReminderBadge({ ...base, urgent: true, daysLeft: 3 }), 'J-3');
  assert.equal(exportReminderBadge({ ...base, urgent: true, daysLeft: 1 }), 'Demain');
  assert.equal(exportReminderBadge({ ...base, urgent: true, daysLeft: 0 }), 'Aujourd\'hui');
  assert.equal(exportReminderBadge({ ...base, urgent: true, daysLeft: -1 }), 'Aujourd\'hui');
});

test('guestExportReminders : filtre et trie par date de suppression', () => {
  const events = [
    EVENT,
    { ...EVENT, id: 'ev2', name: 'Gala', end_date: '2026-11-01T22:00:00Z' },
    { ...EVENT, id: 'ev3', name: 'Exporté', guest_responses_exported_at: '2026-11-09T09:00:00Z' },
  ];
  const summaries = [
    SUMMARY,
    { ...SUMMARY, event_id: 'ev2', purge_at: '2026-12-01T22:00:00Z' },
    { ...SUMMARY, event_id: 'ev3' },
    { ...SUMMARY, event_id: 'inconnu' },
  ];
  assert.deepEqual(guestExportReminders(summaries, events, NOW).map((r) => r.eventId), ['ev2', 'ev1']);
  assert.deepEqual(guestExportReminders([], [], NOW), []);
  assert.deepEqual(guestExportReminders(null, null, NOW), []);
});
