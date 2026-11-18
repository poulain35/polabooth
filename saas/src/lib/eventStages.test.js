import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_STAGES, eventInStage, eventStage, eventStatusKey, eventSteps, nextEventAction, stageFromParams,
} from './eventStages.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

const unplanned = { id: 'u' };
const soon = { id: 's', start_date: day(3), end_date: day(3.5) };
const later = { id: 'l', start_date: day(20), end_date: day(21) };
const ongoing = { id: 'o', start_date: day(-0.1), end_date: day(0.2) };
const finished = { id: 'f', start_date: day(-5), end_date: day(-4) };
const archived = { id: 'a', status: 'archived', start_date: day(-50) };

const approved = [{ status: 'approved' }];
const submitted = [{ status: 'submitted' }];
const ready = (ev) => ({ ...ev, photobooth_id: 'pb-1' });
const done = (steps) => Object.fromEntries(steps.map((s) => [s.id, s.done]));
const ids = (steps) => steps.map((s) => s.id);

test('eventStatusKey : statuts de la liste', () => {
  assert.equal(eventStatusKey(unplanned, NOW), 'unplanned');
  assert.equal(eventStatusKey(soon, NOW), 'upcoming');
  assert.equal(eventStatusKey(ongoing, NOW), 'ongoing');
  assert.equal(eventStatusKey({ start_date: day(-1) }, NOW), 'ongoing'); // sans fin
  assert.equal(eventStatusKey(finished, NOW), 'finished');
  assert.equal(eventStatusKey(archived, NOW), 'archived');
});

test('eventSteps : étapes masquées sans leur fonctionnalité', () => {
  assert.deepEqual(ids(eventSteps(soon, { now: NOW })), ['reserve', 'acompte', 'cadres', 'borne', 'jour-j', 'livre']);
  const open = (f) => f === 'core';
  assert.deepEqual(ids(eventSteps(soon, { now: NOW, isAvailable: open })), ['borne', 'jour-j', 'livre']);
  const noBooking = (f) => f !== 'booking';
  assert.deepEqual(ids(eventSteps(soon, { now: NOW, isAvailable: noBooking })), ['cadres', 'borne', 'jour-j', 'livre']);
});

test('eventSteps : réservation et acompte', () => {
  const steps = (ev) => done(eventSteps(ev, { now: NOW }));
  assert.equal(steps(soon).reserve, true); // créé sans devis
  assert.equal(steps({ ...soon, quote_status: 'envoye' }).reserve, false);
  assert.equal(steps({ ...soon, quote_status: 'refuse' }).reserve, false);
  assert.equal(steps({ ...soon, quote_status: 'signe', deposit_amount: 120, deposit_status: 'attendu' }).acompte, false);
  assert.equal(steps({ ...soon, quote_status: 'signe', deposit_amount: 120, deposit_status: 'regle' }).acompte, true);
  assert.equal(steps({ ...soon, quote_status: 'signe', deposit_amount: 0 }).acompte, true); // pro à 0 %
  assert.equal(steps({ ...soon, quote_status: 'envoye' }).acompte, false); // pas encore réservé
});

test('cas 1 : aucun cadre', () => {
  const ctx = { now: NOW, frames: [] };
  const steps = done(eventSteps(soon, ctx));
  assert.equal(steps.cadres, false);
  assert.equal(steps.borne, false);
  assert.equal(eventStage(soon, ctx), 'a-preparer');
  const action = nextEventAction(soon, ctx);
  assert.equal(action.label, 'Faire créer le cadre par le client');
  assert.equal(action.to, '?tab=creation');
});

test('cas 2 : cadre envoyé par le client', () => {
  const ctx = { now: NOW, frames: submitted };
  assert.equal(done(eventSteps(soon, ctx)).cadres, false);
  assert.equal(eventStage(ready(soon), ctx), 'a-preparer');
  const action = nextEventAction(ready(soon), ctx);
  assert.equal(action.label, 'Valider le cadre envoyé par le client');
  assert.equal(action.to, '?tab=creation');
  // Un cadre envoyé passe avant tout, même après l'événement.
  assert.equal(nextEventAction(finished, ctx).to, '?tab=creation');
  // Écran d'accueil envoyé.
  assert.equal(nextEventAction(ready(soon), { now: NOW, frames: approved, homePending: true }).to, '?tab=creation#ecran-accueil');
});

test('cas 3 : prêt', () => {
  const ctx = { now: NOW, frames: approved };
  assert.equal(nextEventAction(soon, ctx).label, 'Assigner une borne');
  const steps = done(eventSteps(ready(soon), ctx));
  assert.deepEqual(steps, { reserve: true, acompte: true, cadres: true, borne: true, 'jour-j': false, livre: false });
  assert.equal(eventStage(ready(soon), ctx), 'prets');
  const action = nextEventAction(ready(soon), ctx);
  assert.equal(action.label, 'Tout est prêt');
  assert.equal(action.to, '?tab=borne');
  // Pendant l'événement.
  assert.equal(eventStage(ready(ongoing), ctx), 'en-cours');
  assert.equal(nextEventAction(ready(ongoing), ctx).to, '?tab=jour-j');
});

test('cas 4 : terminé, à livrer puis livré', () => {
  const ctx = { now: NOW, frames: approved };
  const ev = ready(finished);
  assert.equal(done(eventSteps(ev, ctx))['jour-j'], true);
  assert.equal(done(eventSteps(ev, ctx)).livre, false);
  assert.equal(eventStage(ev, ctx), 'a-livrer');
  const action = nextEventAction(ev, ctx);
  assert.equal(action.label, 'Livrer les photos au client');
  assert.equal(action.to, '?tab=livraison&partie=envoi');
  const delivered = { ...ctx, deliverySent: true };
  assert.equal(done(eventSteps(ev, delivered)).livre, true);
  assert.equal(eventStage(ev, delivered), 'livre');
  assert.equal(nextEventAction(ev, delivered).action, 'archive');
  assert.equal(eventStage(archived, ctx), 'archives');
  assert.equal(nextEventAction(archived, ctx), null);
});

test('nextEventAction : date, devis et acompte', () => {
  assert.equal(nextEventAction(unplanned, { now: NOW, frames: approved }).to, '?tab=resume#mise-a-disposition');
  const quote = { ...ready(soon), quote_status: 'relance' };
  assert.equal(nextEventAction(quote, { now: NOW, frames: approved }).to, '/admin/ventes?tab=devis');
  const deposit = { ...ready(soon), quote_status: 'signe', deposit_amount: 80, deposit_status: 'attendu' };
  assert.equal(nextEventAction(deposit, { now: NOW, frames: approved }).label, 'Encaisser l’acompte');
  // Sans booking, le devis et l'acompte ne bloquent rien.
  const noBooking = { now: NOW, frames: approved, isAvailable: (f) => f !== 'booking' };
  assert.equal(nextEventAction(deposit, noBooking).label, 'Tout est prêt');
  assert.equal(eventStage(deposit, noBooking), 'prets');
});

test('eventInStage : filtres de la liste, même calcul que la fiche', () => {
  const all = [unplanned, soon, ready(later), ongoing, finished, ready(finished), archived];
  all[2] = { ...all[2], id: 'l' };
  all[5] = { ...all[5], id: 'd' };
  const ctxs = {
    u: {}, s: {}, l: { frames: approved }, o: {}, f: {}, d: { frames: approved, deliverySent: true }, a: { frames: submitted },
  };
  const pick = (stage, extra = {}) => all
    .filter((ev) => eventInStage(ev, stage, { ...ctxs[ev.id], ...(extra[ev.id] ?? {}), now: NOW }))
    .map((ev) => ev.id);
  assert.deepEqual(pick('a-preparer'), ['u', 's']);
  assert.deepEqual(pick('a-preparer', { l: { homePending: true } }), ['u', 's', 'l']); // écran à valider
  assert.deepEqual(pick('a-preparer', { o: { frames: submitted } }), ['u', 's', 'o']); // cadre à valider pendant l'événement
  assert.deepEqual(pick('prets'), ['l']);
  assert.deepEqual(pick('semaine'), ['s', 'o']);
  assert.deepEqual(pick('a-livrer'), ['f']);
  assert.deepEqual(pick('archives'), ['a']); // archivé exclu d'« À préparer » même avec un cadre envoyé
  assert.deepEqual(pick(null), all.map((ev) => ev.id));
});

test('stageFromParams : étape ou tous', () => {
  const p = (qs) => new URLSearchParams(qs);
  for (const { id } of EVENT_STAGES) assert.equal(stageFromParams(p(`etape=${id}`)), id);
  assert.equal(stageFromParams(p('filter=pending')), null); // ancien filtre : plus traduit
  assert.equal(stageFromParams(p('etape=inconnue')), null);
  assert.equal(stageFromParams(p('')), null);
  assert.equal(stageFromParams(null), null);
});
