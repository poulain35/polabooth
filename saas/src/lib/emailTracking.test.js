import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_PROVIDER, EMAIL_STATUS, EMAIL_TYPE_FILTERS, PROBLEM_STATUSES, SMTP_TRACKING_LABEL,
  EMAIL_LOG_COLUMNS, applyEmailLogPlan, bookingRefScope, buildEmailTimeline, emailBadgeMeta, emailContextLink, emailLogQueryPlan,
  emailLogSelect,
  emailProviderOf, emailStatusMeta, emailTypeLabel, escapeLike, isProblemStatus, isTrackingAvailable, lastActivity,
  syncErrorMessage,
} from './emailTracking.js';

// Modules privés de l'instance (src/modules/index.js) ; la version ouverte n'en a aucun.
const PRIVATE = new Set(['booking', 'invoicing', 'prospects', 'audio_guestbook']);

// ── Libellés ─────────────────────────────────────────────────────────────────

test('emailTypeLabel : types fixes', () => {
  assert.equal(emailTypeLabel('access_code'), 'Code d\'accès');
  assert.equal(emailTypeLabel('booking_deposit_invoice'), 'Facture d\'acompte');
  assert.equal(emailTypeLabel('booking_deposit_request'), 'Facture d\'acompte (à la demande)');
  assert.equal(emailTypeLabel('final_invoice'), 'Facture finale');
});

test('emailTypeLabel : familles à nombre de jours variable', () => {
  assert.equal(emailTypeLabel('quote_reminder_j3'), 'Relance devis (J+3)');
  assert.equal(emailTypeLabel('quote_reminder_j10'), 'Relance devis (J+10)');
  assert.equal(emailTypeLabel('booking_recap_reminder_j7'), 'Relance devis en ligne (J+7)');
  assert.equal(emailTypeLabel('design_reminder_j5'), 'Relance cadre photo (J-5)');
  assert.equal(emailTypeLabel('booking_slot_reminder_j14'), 'Rappel créneaux (J-14)');
  assert.equal(emailTypeLabel('booking_slot_reminder_j7'), 'Rappel créneaux (J-7)');
});

test('emailTypeLabel : suffixe non numérique, type inconnu, vide', () => {
  assert.equal(emailTypeLabel('quote_reminder_jx'), 'quote_reminder_jx');
  assert.equal(emailTypeLabel('quote_reminder_j'), 'quote_reminder_j');
  assert.equal(emailTypeLabel('nouveau_type'), 'nouveau_type');
  assert.equal(emailTypeLabel(null), 'Email');
  assert.equal(emailTypeLabel(''), 'Email');
});

test('EMAIL_TYPE_FILTERS : une entrée par famille, triées, clés uniques', () => {
  const families = EMAIL_TYPE_FILTERS.filter((o) => o.prefix);
  assert.equal(families.length, 4);
  assert.ok(families.every((o) => o.label.endsWith('(toutes)')));
  const keys = EMAIL_TYPE_FILTERS.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length);
  const labels = EMAIL_TYPE_FILTERS.map((o) => o.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'fr')));
});

test('emailStatusMeta : connu, problème, inconnu, vide', () => {
  assert.equal(emailStatusMeta('delivered').label, 'Reçu');
  assert.equal(emailStatusMeta('delivered').problem, false);
  assert.equal(emailStatusMeta('hard_bounce').label, 'Rebond définitif');
  assert.equal(emailStatusMeta('hard_bounce').problem, true);
  const unknown = emailStatusMeta('queued');
  assert.equal(unknown.label, 'queued');
  assert.equal(unknown.problem, false);
  assert.equal(unknown.tone, EMAIL_STATUS.sent.tone);
  assert.equal(emailStatusMeta('hard_bounce').tone, 'red');
  assert.equal(emailStatusMeta(null).label, 'Inconnu');
  assert.equal(emailStatusMeta(undefined).label, 'Inconnu');
});

test('statuts problématiques : tous ont un libellé, les autres non', () => {
  for (const s of PROBLEM_STATUSES) assert.ok(EMAIL_STATUS[s], s);
  assert.equal(isProblemStatus('opened'), false);
  assert.equal(isProblemStatus('unsubscribed'), true);
  assert.equal(isProblemStatus('soft_bounce'), true);
});

// ── Plan de requête ──────────────────────────────────────────────────────────

test('emailLogQueryPlan : sans filtre, première page', () => {
  const plan = emailLogQueryPlan({});
  assert.equal(plan.empty, false);
  assert.equal(plan.statuses, null);
  assert.equal(plan.type, null);
  assert.equal(plan.sentFrom, null);
  assert.equal(plan.sentBefore, null);
  assert.equal(plan.recipient, null);
  assert.equal(plan.bookingRef, null);
  assert.equal(plan.rangeFrom, 0);
  assert.equal(plan.rangeTo, 24);
});

test('emailLogQueryPlan : pagination', () => {
  const plan = emailLogQueryPlan({ page: 2 }, { pageSize: 10 });
  assert.equal(plan.rangeFrom, 20);
  assert.equal(plan.rangeTo, 29);
  assert.equal(emailLogQueryPlan({ page: -3 }).rangeFrom, 0);
  assert.equal(emailLogQueryPlan({ page: 'abc' }).rangeFrom, 0);
});

test('emailLogQueryPlan : statut et « Problèmes seulement »', () => {
  assert.deepEqual(emailLogQueryPlan({ status: 'opened' }).statuses, ['opened']);
  assert.equal(emailLogQueryPlan({ status: 'all' }).statuses, null);
  assert.deepEqual(emailLogQueryPlan({ problemsOnly: true }).statuses, PROBLEM_STATUSES);
  assert.deepEqual(emailLogQueryPlan({ status: 'blocked', problemsOnly: true }).statuses, ['blocked']);
  const none = emailLogQueryPlan({ status: 'delivered', problemsOnly: true });
  assert.deepEqual(none.statuses, []);
  assert.equal(none.empty, true);
});

test('emailLogQueryPlan : type exact ou famille (motif LIKE échappé)', () => {
  assert.deepEqual(emailLogQueryPlan({ type: 'delivery' }).type, { eq: 'delivery' });
  assert.deepEqual(emailLogQueryPlan({ type: 'quote_reminder_j*' }).type, { like: 'quote\\_reminder\\_j%' });
  assert.deepEqual(emailLogQueryPlan({ type: 'booking_slot_reminder_j*' }).type, { like: 'booking\\_slot\\_reminder\\_j%' });
  assert.deepEqual(emailLogQueryPlan({ type: 'type_inconnu' }).type, { eq: 'type_inconnu' });
  assert.equal(emailLogQueryPlan({ type: 'all' }).type, null);
});

test('emailLogQueryPlan : période en jours de Paris, borne de fin incluse', () => {
  const plan = emailLogQueryPlan({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(plan.sentFrom, '2026-09-30T22:00:00.000Z');
  assert.equal(plan.sentBefore, '2026-10-31T23:00:00.000Z');
  assert.equal(plan.empty, false);
  const sameDay = emailLogQueryPlan({ from: '2026-10-27', to: '2026-10-27' });
  assert.equal(sameDay.empty, false);
  assert.equal(sameDay.sentBefore, '2026-10-27T23:00:00.000Z');
  assert.equal(emailLogQueryPlan({ from: '2026-10-28', to: '2026-10-27' }).empty, true);
  assert.equal(emailLogQueryPlan({ from: 'pas une date' }).sentFrom, null);
});

test('emailLogQueryPlan : recherche destinataire ou n° de réservation', () => {
  const byMail = emailLogQueryPlan({ search: '  marie@exemple.fr ' });
  assert.equal(byMail.recipient, 'marie@exemple.fr');
  assert.equal(byMail.bookingRef, null);
  const byRef = emailLogQueryPlan({ search: 'pola-ab 3k' }, { modules: PRIVATE });
  assert.equal(byRef.bookingRef, 'POLA-AB3K');
  assert.equal(byRef.recipient, null);
  assert.equal(emailLogQueryPlan({ search: '   ' }).recipient, null);
});

test('escapeLike : %, _ et \\', () => {
  assert.equal(escapeLike('a_b%c\\d'), 'a\\_b\\%c\\\\d');
});

// Faux constructeur de requête : enregistre les appels chaînés.
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

test('applyEmailLogPlan : filtres, tri puis page', () => {
  const plan = emailLogQueryPlan({
    status: 'all', problemsOnly: true, type: 'design_reminder_j*',
    from: '2026-10-01', to: '2026-10-02', search: 'jean_%', page: 1,
  });
  const q = applyEmailLogPlan(fakeQuery(), plan);
  assert.deepEqual(q.calls, [
    ['in', 'status', PROBLEM_STATUSES],
    ['like', 'type', 'design\\_reminder\\_j%'],
    ['gte', 'sent_at', '2026-09-30T22:00:00.000Z'],
    ['lt', 'sent_at', '2026-10-02T22:00:00.000Z'],
    ['ilike', 'recipient', '%jean\\_\\%%'],
    ['order', 'sent_at', { ascending: false }],
    ['order', 'id', { ascending: false }],
    ['range', 25, 49],
  ]);
});

test('applyEmailLogPlan : un seul statut en égalité, portée des réservations', () => {
  const plan = emailLogQueryPlan({ status: 'opened', type: 'delivery', search: 'POLA-AB3K' }, { modules: PRIVATE });
  const q = applyEmailLogPlan(fakeQuery(), plan, { leadIds: ['l1', 'l2'], eventIds: ['e1'] });
  assert.deepEqual(q.calls.slice(0, 3), [
    ['eq', 'status', 'opened'],
    ['eq', 'type', 'delivery'],
    ['or', 'lead_id.in.(l1,l2),event_id.in.(e1)'],
  ]);
  const onlyLeads = applyEmailLogPlan(fakeQuery(), emailLogQueryPlan({}), { leadIds: ['l1'], eventIds: [] });
  assert.deepEqual(onlyLeads.calls[0], ['or', 'lead_id.in.(l1)']);
});

test('bookingRefScope : leads et événements convertis, sans doublon', () => {
  assert.deepEqual(
    bookingRefScope([
      { id: 'l1', converted_event_id: 'e1' },
      { id: 'l2', converted_event_id: null },
      { id: 'l1', converted_event_id: 'e1' },
    ]),
    { leadIds: ['l1', 'l2'], eventIds: ['e1'] },
  );
  assert.deepEqual(bookingRefScope(null), { leadIds: [], eventIds: [] });
});

// ── Détail ───────────────────────────────────────────────────────────────────

test('buildEmailTimeline : envoi, ouvertures regroupées, clic, rebond', () => {
  const log = { sent_at: '2026-10-01T08:00:00Z' };
  const items = buildEmailTimeline(log, [
    { id: 1, event: 'request', occurred_at: '2026-10-01T08:00:01Z' },
    { id: 5, event: 'click', occurred_at: '2026-10-01T10:00:00Z', link: 'https://exemple.fr/a' },
    { id: 2, event: 'delivered', occurred_at: '2026-10-01T08:00:05Z' },
    { id: 3, event: 'opened', occurred_at: '2026-10-01T09:00:00Z' },
    { id: 4, event: 'proxy_open', occurred_at: '2026-10-01T09:30:00Z' },
    { id: 6, event: 'opened', occurred_at: '2026-10-02T09:00:00Z' },
    { id: 7, event: 'soft_bounce', occurred_at: '2026-10-03T09:00:00Z', reason: 'Boîte pleine' },
  ]);
  assert.deepEqual(items.map((i) => i.kind), ['sent', 'delivered', 'opened', 'click', 'soft_bounce']);
  const opened = items[2];
  assert.equal(opened.label, 'Ouvert ×3');
  assert.equal(opened.count, 3);
  assert.equal(opened.proxyCount, 1);
  assert.equal(opened.at, '2026-10-01T09:00:00Z');
  assert.equal(opened.lastAt, '2026-10-02T09:00:00Z');
  assert.equal(opened.detail, 'Dont 1 par un proxy de messagerie');
  assert.equal(items[3].link, 'https://exemple.fr/a');
  assert.equal(items[3].problem, false);
  assert.equal(items[4].detail, 'Boîte pleine');
  assert.equal(items[4].problem, true);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});

test('buildEmailTimeline : une seule ouverture, aucun événement', () => {
  const single = buildEmailTimeline({ sent_at: '2026-10-01T08:00:00Z' }, [
    { event: 'opened', occurred_at: '2026-10-01T09:00:00Z' },
  ]);
  assert.equal(single[1].label, 'Ouvert');
  assert.deepEqual(buildEmailTimeline({ sent_at: '2026-10-01T08:00:00Z' }, []).map((i) => i.kind), ['sent']);
  assert.deepEqual(buildEmailTimeline(null, null), []);
});

test('lastActivity : dernier événement, sinon envoi', () => {
  assert.deepEqual(
    lastActivity({ sent_at: 'a', last_event: 'click', last_event_at: 'b' }),
    { label: 'Cliqué', at: 'b' },
  );
  assert.deepEqual(lastActivity({ sent_at: 'a', last_event: null }), { label: 'Envoyé', at: 'a' });
});

test('syncErrorMessage : messages selon le code', () => {
  assert.match(syncErrorMessage({ status: 422 }), /identifiant Brevo/);
  assert.match(syncErrorMessage({ status: 403 }), /pas accès/);
  assert.match(syncErrorMessage({ status: 429, retryAfter: 120 }), /Réessayez dans 2 minutes\./);
  assert.match(syncErrorMessage({ status: 429 }), /Réessayez dans quelques minutes\./);
  assert.match(syncErrorMessage({ status: 503 }), /Brevo ne répond pas/);
  assert.equal(syncErrorMessage({ status: 500, message: 'Panne' }), 'Panne');
  assert.equal(syncErrorMessage(null), 'La resynchronisation a échoué.');
});

test('emailContextLink : demande du tunnel, devis legacy, événement', () => {
  assert.deepEqual(
    emailContextLink({ lead_id: 'l1', lead: { source: 'booking', booking_status: 'pending', booking_number: 'POLA-AB3K', client_name: 'Marie' } }, PRIVATE),
    { to: '/admin/demandes/l1', label: 'POLA-AB3K · Marie', kind: 'lead' },
  );
  assert.deepEqual(
    emailContextLink({ lead_id: 'l2', lead: { source: 'legacy', client_name: 'Paul' } }, PRIVATE),
    { to: '/admin/ventes?tab=devis&lead=l2', label: 'Paul', kind: 'lead' },
  );
  assert.deepEqual(emailContextLink({ lead_id: 'l3', lead: null }, PRIVATE), { to: '/admin/ventes?tab=devis&lead=l3', label: 'Devis', kind: 'lead' });
  assert.deepEqual(
    emailContextLink({ event_id: 'e1', event: { name: 'Mariage Dupont' } }),
    { to: '/admin/events/e1', label: 'Mariage Dupont', kind: 'event' },
  );
  assert.deepEqual(
    emailContextLink({ prospect_id: 'p1', prospect: { first_name: 'Camille', last_name: 'Martin' } }, PRIVATE),
    { to: '/admin/prospects/p1', label: 'Camille Martin', kind: 'prospect' },
  );
  assert.deepEqual(emailContextLink({ prospect_id: 'p2', prospect: null }, PRIVATE), { to: '/admin/prospects/p2', label: 'Prospect', kind: 'prospect' });
  assert.equal(emailContextLink({}), null);
});

// ── Fournisseur d'envoi (lot S2) ─────────────────────────────────────────────

test("emailProviderOf : « smtp » seulement s'il est demandé, Brevo sinon (variable absente)", () => {
  assert.equal(emailProviderOf(undefined), 'brevo');
  assert.equal(emailProviderOf(''), 'brevo');
  assert.equal(emailProviderOf('brevo'), 'brevo');
  assert.equal(emailProviderOf(' SMTP '), 'smtp');
  assert.equal(emailProviderOf('autre'), 'brevo');
  // Sans VITE_EMAIL_PROVIDER (hors Vite) : Brevo, suivi disponible.
  assert.equal(EMAIL_PROVIDER, 'brevo');
  assert.equal(isTrackingAvailable(), true);
  assert.equal(isTrackingAvailable('smtp'), false);
});

test('emailBadgeMeta : Brevo → pastilles de suivi inchangées', () => {
  for (const status of ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'error', undefined]) {
    assert.deepEqual(emailBadgeMeta(status, 'brevo'), emailStatusMeta(status));
  }
  assert.deepEqual(emailBadgeMeta('opened'), emailStatusMeta('opened'));
});

test("emailBadgeMeta : SMTP → « Suivi indisponible avec SMTP », sauf un refus à l'envoi", () => {
  for (const status of ['sent', 'delivered', 'opened', 'clicked', 'bounced']) {
    const meta = emailBadgeMeta(status, 'smtp');
    assert.equal(meta.label, SMTP_TRACKING_LABEL);
    assert.equal(meta.label, 'Suivi indisponible avec SMTP');
    assert.equal(meta.problem, false);
  }
  assert.deepEqual(emailBadgeMeta('error', 'smtp'), emailStatusMeta('error'));
});

// ── Modules privés absents (open core, LAB-274) ──────────────────────────────
// Version ouverte (VITE_PRIVATE_MODULES=none ou registre vide) : INSTALLED_MODULES est vide, les
// tables leads et prospects n'existent pas. fetchEmailLogs ne lit `leads` que si plan.bookingRef.

const OPEN_BUILDS = [['registre vide', new Set()], ['paramètre omis', undefined]];

test('emailLogSelect : avec les modules, sélection identique à celle d\'avant LAB-274', () => {
  assert.equal(
    emailLogSelect(PRIVATE),
    `${EMAIL_LOG_COLUMNS}, `
      + 'lead:leads(id, client_name, booking_number, source, booking_status), event:events(id, name, client_name), '
      + 'prospect:prospects(id, first_name, last_name)',
  );
});

test('emailLogSelect : sans les modules, aucune jointure sur leads ni prospects', () => {
  for (const [name, modules] of OPEN_BUILDS) {
    const select = emailLogSelect(modules);
    assert.equal(select, `${EMAIL_LOG_COLUMNS}, event:events(id, name, client_name)`, name);
    assert.doesNotMatch(select, /leads|prospects/, name);
  }
  assert.doesNotMatch(emailLogSelect(new Set(['booking'])), /prospects/);
  assert.match(emailLogSelect(new Set(['booking'])), /lead:leads\(/);
  assert.doesNotMatch(emailLogSelect(new Set(['prospects'])), /leads/);
  assert.match(emailLogSelect(new Set(['prospects'])), /prospect:prospects\(/);
});

test('emailLogQueryPlan : sans le module booking, un n° POLA-XXXX est cherché dans le destinataire', () => {
  for (const [name, modules] of [...OPEN_BUILDS, ['prospects seul', new Set(['prospects'])]]) {
    const plan = emailLogQueryPlan({ search: 'POLA-7K3M' }, { modules });
    assert.equal(plan.bookingRef, null, name);
    assert.equal(plan.recipient, 'POLA-7K3M', name);
    const q = applyEmailLogPlan(fakeQuery(), plan);
    assert.deepEqual(q.calls.find((c) => c[0] === 'ilike'), ['ilike', 'recipient', '%POLA-7K3M%'], name);
    assert.equal(q.calls.find((c) => c[0] === 'or'), undefined, name);
  }
});

test('emailLogQueryPlan : avec le module booking, recherche par n° de réservation inchangée', () => {
  const plan = emailLogQueryPlan({ search: 'POLA-7K3M' }, { modules: PRIVATE });
  assert.equal(plan.bookingRef, 'POLA-7K3M');
  assert.equal(plan.recipient, null);
});

test('emailContextLink : sans module, pas de lien vers devis, demandes ni prospects', () => {
  const lead = { lead_id: 'l1', lead: { source: 'booking', booking_status: 'pending', booking_number: 'POLA-AB3K' } };
  for (const [name, modules] of OPEN_BUILDS) {
    assert.equal(emailContextLink(lead, modules), null, name);
    assert.equal(emailContextLink({ lead_id: 'l2' }, modules), null, name);
    assert.equal(emailContextLink({ prospect_id: 'p1' }, modules), null, name);
    assert.deepEqual(
      emailContextLink({ lead_id: 'l3', event_id: 'e1', event: { name: 'Mariage Dupont' } }, modules),
      { to: '/admin/events/e1', label: 'Mariage Dupont', kind: 'event' },
      name,
    );
  }
  assert.equal(emailContextLink({ prospect_id: 'p1' }, new Set(['booking'])), null);
  assert.equal(emailContextLink({ lead_id: 'l1' }, new Set(['prospects'])), null);
});
