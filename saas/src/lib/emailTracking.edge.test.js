// LAB-124 (agent Test) : cas limites de la page Emails — recherche, échappement PostgREST,
// période en heure de Paris, frise, liens cliqués, libellés de tous les types journalisés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  EMAIL_STATUS, PROBLEM_STATUSES,
  applyEmailLogPlan, bookingRefScope, buildEmailTimeline, emailLogQueryPlan, emailTypeLabel, escapeLike,
  isBookingRefSearch, isProblemStatus, noTrackingMessage, resolveLeadLink, syncErrorMessage,
} from './emailTracking.js';

const BOOKING = { modules: new Set(['booking']) };

function fakeQuery() {
  const calls = [];
  const q = new Proxy({}, {
    get(_target, method) {
      if (method === 'calls') return calls;
      return (...args) => { calls.push([method, ...args]); return q; };
    },
  });
  return q;
}

const callOf = (q, method) => q.calls.find((c) => c[0] === method);

// ── Recherche : destinataire ou n° de réservation ────────────────────────────

test('recherche : une adresse contenant « pola » reste une recherche de destinataire', () => {
  for (const term of ['contact@studiopola.fr', 'studiopola', 'pola.dupont@gmail.com', 'POLA', 'POLA-']) {
    const plan = emailLogQueryPlan({ search: term }, BOOKING);
    assert.equal(plan.bookingRef, null, term);
    assert.equal(plan.recipient, term, term);
    assert.equal(isBookingRefSearch(term), false, term);
  }
});

test('recherche : n° POLA-XXXX normalisé, avec ou sans tiret, partiel', () => {
  assert.equal(emailLogQueryPlan({ search: 'POLA-7K3M' }, BOOKING).bookingRef, 'POLA-7K3M');
  assert.equal(emailLogQueryPlan({ search: 'pola-7k3m' }, BOOKING).bookingRef, 'POLA-7K3M');
  assert.equal(emailLogQueryPlan({ search: 'pola 7k3m' }, BOOKING).bookingRef, 'POLA-7K3M');
  assert.equal(emailLogQueryPlan({ search: 'POLA7K3M' }, BOOKING).bookingRef, 'POLA-7K3M');
  assert.equal(emailLogQueryPlan({ search: 'POLA-7K' }, BOOKING).bookingRef, 'POLA-7K');
  assert.equal(emailLogQueryPlan({ search: 'POLA-7K3M' }, BOOKING).recipient, null);
});

test('recherche : caractères spéciaux jamais envoyés dans la recherche de réservation', () => {
  for (const term of ['POLA-7K,(', 'POLA-%', 'POLA-*', 'POLA-7K)']) {
    const plan = emailLogQueryPlan({ search: term }, BOOKING);
    assert.equal(plan.bookingRef, null, term);
    assert.equal(plan.recipient, term, term);
  }
});

test('recherche destinataire : % et _ échappés, * neutralisé (alias de % pour PostgREST)', () => {
  const ilike = (search) => callOf(applyEmailLogPlan(fakeQuery(), emailLogQueryPlan({ search })), 'ilike');
  assert.deepEqual(ilike('a*b'), ['ilike', 'recipient', '%a_b%']);
  assert.deepEqual(ilike('*'), ['ilike', 'recipient', '%_%']);
  assert.deepEqual(ilike('50%'), ['ilike', 'recipient', '%50\\%%']);
  // Hors de or() : virgule et parenthèses n'ont pas de sens pour PostgREST dans ilike.
  assert.deepEqual(ilike('a,b(c)'), ['ilike', 'recipient', '%a,b(c)%']);
  assert.equal(escapeLike('x*y'), 'x_y');
});

test('recherche destinataire : aucun or() (la saisie ne peut pas élargir la requête)', () => {
  const q = applyEmailLogPlan(fakeQuery(), emailLogQueryPlan({ search: 'a),status.eq.sent,recipient.ilike.(*' }));
  assert.equal(callOf(q, 'or'), undefined);
});

test('portée de réservation : or() ne contient que les identifiants', () => {
  const scope = bookingRefScope([
    { id: '11111111-1111-1111-1111-111111111111', converted_event_id: null },
  ]);
  assert.deepEqual(scope.eventIds, []);
  const q = applyEmailLogPlan(fakeQuery(), emailLogQueryPlan({ search: 'POLA-7K3M' }, BOOKING), scope);
  assert.deepEqual(callOf(q, 'or'), ['or', 'lead_id.in.(11111111-1111-1111-1111-111111111111)']);
  assert.equal(callOf(q, 'ilike'), undefined);
});

// ── Période : jours civils de Paris, quel que soit le fuseau du navigateur ────

function withTimeZone(tz, fn) {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
}

test('période : minuit à Paris, jour de fin inclus, navigateur hors de France', () => {
  for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC', 'Europe/Paris']) {
    withTimeZone(tz, () => {
      const summer = emailLogQueryPlan({ from: '2026-10-01', to: '2026-10-01' });
      assert.equal(summer.sentFrom, '2026-09-30T22:00:00.000Z', tz);
      assert.equal(summer.sentBefore, '2026-10-01T22:00:00.000Z', tz);
      // 25 octobre 2026 : passage à l'heure d'hiver, la journée dure 25 h.
      const dst = emailLogQueryPlan({ from: '2026-10-25', to: '2026-10-25' });
      assert.equal(dst.sentFrom, '2026-10-24T22:00:00.000Z', tz);
      assert.equal(dst.sentBefore, '2026-10-25T23:00:00.000Z', tz);
      const winter = emailLogQueryPlan({ from: '2026-12-31', to: '2026-12-31' });
      assert.equal(winter.sentFrom, '2026-12-30T23:00:00.000Z', tz);
      assert.equal(winter.sentBefore, '2026-12-31T23:00:00.000Z', tz);
      // 29 mars 2026 : passage à l'heure d'été.
      assert.equal(emailLogQueryPlan({ to: '2026-03-28' }).sentBefore, '2026-03-28T23:00:00.000Z', tz);
      assert.equal(emailLogQueryPlan({ from: '2026-03-30' }).sentFrom, '2026-03-29T22:00:00.000Z', tz);
    });
  }
});

test('période : dates invalides ignorées, début après fin = aucune ligne', () => {
  assert.equal(emailLogQueryPlan({ from: '2026-13-45' }).sentFrom, null);
  assert.equal(emailLogQueryPlan({ to: '' }).sentBefore, null);
  assert.equal(emailLogQueryPlan({ from: '2026-10-28', to: '2026-10-27' }).empty, true);
  assert.equal(emailLogQueryPlan({ from: '2026-10-27', to: '2026-10-27' }).empty, false);
});

// ── « Problèmes seulement » et pagination ────────────────────────────────────

test('« Problèmes seulement » : rebonds, blocage et erreur inclus, statuts positifs exclus', () => {
  for (const s of ['soft_bounce', 'hard_bounce', 'blocked', 'error', 'spam', 'invalid']) {
    assert.ok(PROBLEM_STATUSES.includes(s), s);
  }
  for (const s of ['sent', 'delivered', 'opened', 'clicked']) assert.equal(isProblemStatus(s), false, s);
  const q = applyEmailLogPlan(fakeQuery(), emailLogQueryPlan({ problemsOnly: true, status: 'error' }));
  assert.deepEqual(callOf(q, 'eq'), ['eq', 'status', 'error']);
});

test('pagination : plage de la dernière page partielle', () => {
  const plan = emailLogQueryPlan({ page: 3 });
  assert.equal(plan.rangeFrom, 75);
  assert.equal(plan.rangeTo, 99);
  assert.equal(emailLogQueryPlan({ page: '1' }).rangeFrom, 25);
});

// ── Frise ────────────────────────────────────────────────────────────────────

test('frise : événements de la même seconde dans l\'ordre logique (reçu, ouvert, cliqué)', () => {
  const at = '2026-10-01T08:00:05Z';
  const items = buildEmailTimeline({ sent_at: '2026-10-01T08:00:00Z' }, [
    { id: 'c', event: 'click', occurred_at: at, link: 'https://exemple.fr' },
    { id: 'p', event: 'proxy_open', occurred_at: at },
    { id: 'd', event: 'delivered', occurred_at: at },
  ]);
  assert.deepEqual(items.map((i) => i.kind), ['sent', 'delivered', 'opened', 'click']);
});

test('frise : lien cliqué non http(s) affiché sans lien actif', () => {
  const items = buildEmailTimeline({ sent_at: '2026-10-01T08:00:00Z' }, [
    { event: 'click', occurred_at: '2026-10-01T09:00:00Z', link: 'javascript:alert(1)' },
    { event: 'click', occurred_at: '2026-10-01T09:01:00Z', link: ' JaVaScRiPt:alert(1)' },
    { event: 'click', occurred_at: '2026-10-01T09:02:00Z', link: 'data:text/html,<script>alert(1)</script>' },
    { event: 'click', occurred_at: '2026-10-01T09:03:00Z', link: 'https://exemple.fr/devis?x=1' },
    { event: 'click', occurred_at: '2026-10-01T09:04:00Z', link: null },
  ]).filter((i) => i.kind === 'click');
  assert.deepEqual(items.map((i) => i.href), [null, null, null, 'https://exemple.fr/devis?x=1', null]);
  assert.equal(items[0].link, 'javascript:alert(1)');
  assert.equal(items[4].link, null);
});

test('frise : le motif d\'un rebond est conservé en texte brut', () => {
  const [, bounce] = buildEmailTimeline({ sent_at: '2026-10-01T08:00:00Z' }, [
    { event: 'hard_bounce', occurred_at: '2026-10-01T09:00:00Z', reason: '<img src=x onerror=alert(1)>' },
  ]);
  assert.equal(bounce.detail, '<img src=x onerror=alert(1)>');
  assert.equal(bounce.problem, true);
});

// ── Resynchronisation ────────────────────────────────────────────────────────

test('syncErrorMessage : 401, 404 et 502 en français', () => {
  assert.match(syncErrorMessage({ status: 401 }), /reconnectez-vous/);
  assert.match(syncErrorMessage({ status: 404 }), /n'existe plus/);
  assert.match(syncErrorMessage({ status: 502, message: 'Brevo indisponible (500)' }), /Brevo ne répond pas/);
  assert.match(syncErrorMessage({ status: 429, retryAfter: 30 }), /20 par tranche de 10 minutes\)\. Réessayez dans 30 secondes\./);
});

// ── Libellés : tous les types écrits par les edge functions ──────────────────
// Relevé du 2026-10-27 : grep recordEmailLog / logEmail / logType dans supabase/functions.

const LOGGED_TYPES = [
  'access_code', 'delivery', 'design_approved', 'design_rejected', 'home_design_approved', 'home_design_rejected', 'design_reminder_j7', 'design_reminder_j3',
  'quote_reminder_j3', 'quote_reminder_j10',
  'booking_new_request_admin', 'booking_request_received', 'booking_recap_link', 'booking_refused',
  'booking_deadline_extended', 'booking_reactivation', 'booking_recap_reminder_j3', 'booking_recap_reminder_j14',
  'booking_recap_reminder_j25', 'booking_expired', 'booking_deposit_reminder', 'booking_deposit_extended',
  'booking_last_booths', 'booking_confirmed', 'booking_withdrawal_ack', 'booking_slot_confirmed',
  'booking_slot_cancelled', 'booking_pickup_reminder', 'booking_return_reminder', 'booking_slot_reminder_j14',
  'booking_slot_reminder_j7', 'booking_deposit_invoice', 'booking_deposit_request', 'balance_invoice', 'balance_reminder', 'final_invoice',
  'media_expiry_reminder', 'prospect_formules', 'prospect_follow_up',
];

test('emailTypeLabel : chaque type journalisé a un libellé français', () => {
  for (const type of LOGGED_TYPES) {
    const label = emailTypeLabel(type);
    assert.notEqual(label, type, type);
    assert.doesNotMatch(label, /_/, type);
  }
});

test('statuts : chaque valeur de la contrainte email_logs_status_check a un libellé', () => {
  const allowed = ['sent', 'delivered', 'opened', 'clicked', 'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'invalid', 'error', 'unsubscribed'];
  assert.deepEqual(Object.keys(EMAIL_STATUS).sort(), [...allowed].sort());
});

// ── Lien ?lead=… (AdminLeads) ────────────────────────────────────────────────

test('resolveLeadLink : ouvre le lead une seule fois, puis plus rien', () => {
  const leads = [{ id: 'l1' }, { id: 'l2' }];
  assert.deepEqual(resolveLeadLink('l2', leads), { lead: { id: 'l2' }, consumed: true });
  // Après consommation, le drapeau vaut null : un load() ultérieur ne rouvre rien.
  assert.deepEqual(resolveLeadLink(null, leads), { lead: null, consumed: false });
  assert.deepEqual(resolveLeadLink(undefined, leads), { lead: null, consumed: false });
});

test('resolveLeadLink : lead absent ou liste vide, paramètre quand même consommé', () => {
  assert.deepEqual(resolveLeadLink('inconnu', [{ id: 'l1' }]), { lead: null, consumed: true });
  assert.deepEqual(resolveLeadLink('l1', null), { lead: null, consumed: true });
});

// ── Email sans message-id ────────────────────────────────────────────────────

test('noTrackingMessage : refusé par Brevo à l\'envoi, avec ou sans motif', () => {
  assert.equal(
    noTrackingMessage({ status: 'error', error_reason: 'Adresse invalide' }),
    'Refusé par Brevo à l\'envoi : aucun suivi possible. Motif : Adresse invalide',
  );
  assert.equal(noTrackingMessage({ status: 'error', error_reason: null }), 'Refusé par Brevo à l\'envoi : aucun suivi possible.');
  assert.equal(noTrackingMessage({ status: 'error', error_reason: '   ' }), 'Refusé par Brevo à l\'envoi : aucun suivi possible.');
});

test('noTrackingMessage : email antérieur au suivi', () => {
  assert.match(noTrackingMessage({ status: 'sent' }), /avant la mise en place du suivi/);
  assert.match(noTrackingMessage(null), /avant la mise en place du suivi/);
});
