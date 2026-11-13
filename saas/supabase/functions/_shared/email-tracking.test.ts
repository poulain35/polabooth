// Tests du suivi des emails Brevo (LAB-123) : authentification du webhook, normalisation,
// calcul du statut, dédoublonnage et écriture via un faux client supabase-js.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBrevoEvents, authorizeWebhook, dedupeEvents, emailEventRow, foldEmailState, groupByMessageId,
  messageIdVariants, normalizeBrevoEvent, parseStatisticsEvents, parseWebhookBody, toSecondIso,
  type BrevoEventInput,
} from './email-tracking.ts';

const MID = '<202610271414.67460013699@smtp-relay.mailin.fr>';
const T0 = Date.parse('2026-10-27T14:14:00Z') / 1000;

function hook(event: string, offsetS: number, extra: Record<string, unknown> = {}) {
  return {
    event, email: 'client@example.com', id: 123, 'message-id': MID, ts_event: T0 + offsetS,
    date: '2026-10-27 15:14:00', subject: 'Votre demande', user_agent: 'Mozilla/5.0', sending_ip: '1.2.3.4',
    ...extra,
  };
}

// ── Faux client supabase-js : juste ce qu'utilise applyBrevoEvents ──────────

interface Row { [k: string]: unknown }

class FakeDb {
  logs: Row[];
  events: Row[] = [];
  failOn: string | null = null;
  constructor(logs: Row[]) { this.logs = logs; }

  from(table: string) {
    const db = this;
    const err = () => (db.failOn === table ? { message: 'boom' } : null);
    return {
      select(_cols: string) {
        return {
          in(col: string, vals: unknown[]) {
            return Promise.resolve({ data: err() ? null : db.logs.filter((r) => vals.includes(r[col])).map((r) => ({ id: r.id })), error: err() });
          },
          eq(col: string, val: unknown) {
            const rows = db.events.filter((r) => r[col] === val);
            return Promise.resolve({ data: err() ? null : rows, error: err() });
          },
        };
      },
      upsert(rows: Row[], opts: { onConflict: string; ignoreDuplicates: boolean }) {
        assert.equal(table, 'email_events');
        assert.equal(opts.ignoreDuplicates, true);
        const cols = opts.onConflict.split(',');
        const key = (r: Row) => cols.map((c) => (c === 'occurred_at' ? Date.parse(String(r[c])) : r[c])).join('|');
        if (!err()) {
          for (const r of rows) if (!db.events.some((e) => key(e) === key(r))) db.events.push({ ...r });
        }
        return Promise.resolve({ error: err() });
      },
      update(patch: Row) {
        return {
          eq(col: string, val: unknown) {
            if (!err()) for (const r of db.logs) if (r[col] === val) Object.assign(r, patch);
            return Promise.resolve({ error: err() });
          },
        };
      },
    };
  }
}

const NOW = '2026-10-27T15:00:00.000Z';
const newDb = () => new FakeDb([{ id: 'log-1', provider_message_id: MID, status: 'sent', open_count: 0, click_count: 0 }]);

async function deliver(db: FakeDb, body: unknown) {
  const { events } = parseWebhookBody(body);
  for (const [mid, list] of groupByMessageId(events)) await applyBrevoEvents(db, mid, list, 'webhook', NOW);
}

// ── Authentification ─────────────────────────────────────────────────────────

test('webhook : jeton absent ou faux → unauthorized (401), bon jeton → ok', () => {
  assert.equal(authorizeWebhook(null, 's3cret-token'), 'unauthorized');
  assert.equal(authorizeWebhook('', 's3cret-token'), 'unauthorized');
  assert.equal(authorizeWebhook('s3cret-tokem', 's3cret-token'), 'unauthorized');
  assert.equal(authorizeWebhook('s3cret', 's3cret-token'), 'unauthorized');
  assert.equal(authorizeWebhook('s3cret-token', 's3cret-token'), 'ok');
});

test('webhook : secret non configuré → misconfigured, même avec un jeton', () => {
  assert.equal(authorizeWebhook('x', undefined), 'misconfigured');
  assert.equal(authorizeWebhook('', ''), 'misconfigured');
});

// ── Normalisation ────────────────────────────────────────────────────────────

test('normalisation : vocabulaires webhook et API statistics ramenés au même nom', () => {
  const cases: Array<[string, string | null]> = [
    ['request', 'request'], ['requests', 'request'],
    ['delivered', 'delivered'],
    ['opened', 'opened'], ['unique_opened', 'opened'],
    ['proxy_open', 'proxy_open'], ['unique_proxy_open', 'proxy_open'], ['loadedByProxy', 'proxy_open'],
    ['click', 'click'], ['clicks', 'click'],
    ['soft_bounce', 'soft_bounce'], ['softBounces', 'soft_bounce'],
    ['hard_bounce', 'hard_bounce'], ['hardBounces', 'hard_bounce'],
    ['blocked', 'blocked'], ['spam', 'spam'],
    ['invalid_email', 'invalid'], ['invalid', 'invalid'],
    ['error', 'error'], ['unsubscribed', 'unsubscribed'], ['deferred', 'deferred'],
    ['bounces', null], ['list_addition', null], ['', null],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeBrevoEvent(raw), want, raw);
  assert.equal(normalizeBrevoEvent(42), null);
});

test('parseWebhookBody : objet seul ou lot (tableau), éléments inexploitables ignorés', () => {
  assert.equal(parseWebhookBody(hook('delivered', 0)).events.length, 1);
  const batch = parseWebhookBody([
    hook('delivered', 0), hook('opened', 60),
    { event: 'delivered', ts_event: T0 }, // sans message-id
    hook('list_addition', 0), // événement non suivi
    null, 'texte',
  ]);
  assert.equal(batch.events.length, 2);
  assert.equal(batch.ignored, 4);
});

test('parseWebhookBody : horodatage UTC depuis ts_event, sinon ts_epoch (ms ou s)', () => {
  const [a] = parseWebhookBody(hook('delivered', 0)).events;
  assert.equal(a.occurredAt, '2026-10-27T14:14:00Z');
  const [b] = parseWebhookBody({ event: 'opened', 'message-id': MID, ts_epoch: T0 * 1000 + 789 }).events;
  assert.equal(b.occurredAt, '2026-10-27T14:14:00Z');
  const [c] = parseWebhookBody({ event: 'opened', 'message-id': MID, ts_epoch: T0 + 5 }).events;
  assert.equal(c.occurredAt, '2026-10-27T14:14:05Z');
  // `date` sans fuseau (heure de Paris) n'est pas exploitable seule.
  assert.equal(parseWebhookBody({ event: 'opened', 'message-id': MID, date: '2026-10-27 15:14:00' }).events.length, 0);
});

test('emailEventRow : payload minimal, ni IP, ni user-agent, ni adresse', () => {
  const [e] = parseWebhookBody(hook('click', 0, { link: 'https://exemple.fr/r', tags: ['booking'], template_id: 12 })).events;
  const row = emailEventRow('log-1', e, 'webhook');
  assert.deepEqual(row.payload, { source: 'webhook', raw_event: 'click', tag: 'booking', template_id: 12 });
  assert.equal(row.link, 'https://exemple.fr/r');
  const flat = JSON.stringify(row);
  assert.ok(!flat.includes('1.2.3.4') && !flat.includes('Mozilla') && !flat.includes('client@example.com'));
});

test('parseStatisticsEvents : réponse de GET /v3/smtp/statistics/events', () => {
  const events = parseStatisticsEvents({
    events: [
      { email: 'c@x.fr', date: '2026-10-27T14:14:00.000Z', messageId: MID, event: 'delivered', ip: '1.2.3.4' },
      { email: 'c@x.fr', date: '2026-10-27T14:20:00.120+00:00', messageId: MID, event: 'opened' },
      { email: 'c@x.fr', date: '2026-10-27T14:21:00Z', messageId: MID, event: 'hardBounces', reason: 'mailbox full' },
      { email: 'c@x.fr', date: '2026-10-27T14:21:00Z', messageId: MID, event: 'bounces' },
      { email: 'c@x.fr', messageId: MID, event: 'opened' },
    ],
  });
  assert.deepEqual(events.map((e) => [e.event, e.occurredAt]), [
    ['delivered', '2026-10-27T14:14:00Z'],
    ['opened', '2026-10-27T14:20:00Z'],
    ['hard_bounce', '2026-10-27T14:21:00Z'],
  ]);
  assert.equal(events[2].reason, 'mailbox full');
  assert.deepEqual(parseStatisticsEvents({}), []);
  assert.deepEqual(parseStatisticsEvents(null), []);
});

test('messageIdVariants : avec et sans chevrons', () => {
  assert.deepEqual(messageIdVariants(MID), [MID, MID.slice(1, -1)]);
  assert.deepEqual(messageIdVariants(MID.slice(1, -1)), [MID, MID.slice(1, -1)]);
});

test('toSecondIso : tronque à la seconde', () => {
  assert.equal(toSecondIso(Date.parse('2026-10-27T14:14:00.999Z')), '2026-10-27T14:14:00Z');
});

// ── Calcul du statut ─────────────────────────────────────────────────────────

const ev = (event: string, min: number, reason: string | null = null) =>
  ({ event, occurredAt: new Date((T0 + min * 60) * 1000).toISOString(), reason });

test('fold : le statut ne fait que monter, même si les webhooks arrivent dans le désordre', () => {
  assert.equal(foldEmailState([ev('click', 3), ev('delivered', 0), ev('opened', 1)]).status, 'clicked');
  assert.equal(foldEmailState([ev('request', 0), ev('delivered', 1), ev('request', 2)]).status, 'delivered');
  assert.equal(foldEmailState([ev('request', 0)]).status, 'sent');
  assert.equal(foldEmailState([]).status, 'sent');
  assert.equal(foldEmailState([ev('delivered', 0), ev('deferred', 1)]).status, 'delivered');
});

test('fold : soft_bounce puis delivered → delivered ; delivered puis soft_bounce → soft_bounce', () => {
  const healed = foldEmailState([ev('request', 0), ev('soft_bounce', 1, 'boîte pleine'), ev('delivered', 30)]);
  assert.equal(healed.status, 'delivered');
  assert.equal(healed.error_reason, null);
  assert.ok(healed.bounced_at);
  const bounced = foldEmailState([ev('delivered', 0), ev('soft_bounce', 1)]);
  assert.equal(bounced.status, 'soft_bounce');
  assert.equal(bounced.error_reason, 'Rebond temporaire');
});

test('fold : un échec définitif s\'applique toujours, même suivi d\'une ouverture', () => {
  assert.equal(foldEmailState([ev('hard_bounce', 0), ev('opened', 5)]).status, 'hard_bounce');
  assert.equal(foldEmailState([ev('opened', 0), ev('spam', 5)]).status, 'spam');
  assert.equal(foldEmailState([ev('clicked', 0), ev('unsubscribed', 5)]).status, 'unsubscribed');
  assert.equal(foldEmailState([ev('request', 0), ev('blocked', 0)]).status, 'blocked');
  assert.equal(foldEmailState([ev('invalid_email', 0)]).error_reason, 'Adresse email invalide');
});

test('fold : unique_opened et opened d\'une même ouverture comptent pour une', () => {
  const s = foldEmailState([ev('opened', 1), ev('unique_opened', 1), ev('opened', 9)]);
  assert.equal(s.open_count, 2);
});

// ── Critères d'acceptation, de bout en bout sur le faux client ──────────────

test('delivered → opened → opened → click : clicked, 2 ouvertures, dates renseignées, 4 événements', async () => {
  const db = newDb();
  await deliver(db, hook('delivered', 0));
  await deliver(db, hook('opened', 60));
  await deliver(db, hook('opened', 600));
  await deliver(db, hook('click', 660, { link: 'https://exemple.fr/reserver' }));

  const log = db.logs[0];
  assert.equal(log.status, 'clicked');
  assert.equal(log.open_count, 2);
  assert.equal(log.click_count, 1);
  assert.equal(log.delivered_at, '2026-10-27T14:14:00.000Z');
  assert.equal(log.opened_at, '2026-10-27T14:15:00.000Z');
  assert.equal(log.clicked_at, '2026-10-27T14:25:00.000Z');
  assert.equal(log.last_event, 'click');
  assert.equal(log.last_event_at, '2026-10-27T14:25:00.000Z');
  assert.equal(log.error_reason, null);
  assert.equal(log.updated_at, NOW);
  assert.equal(db.events.length, 4);
});

test('hard_bounce après delivered : hard_bounce avec error_reason (motif Brevo ou libellé par défaut)', async () => {
  const db = newDb();
  await deliver(db, hook('delivered', 0));
  await deliver(db, hook('hard_bounce', 30, { reason: '550 5.1.1 User unknown' }));
  assert.equal(db.logs[0].status, 'hard_bounce');
  assert.equal(db.logs[0].error_reason, '550 5.1.1 User unknown');
  assert.equal(db.logs[0].bounced_at, '2026-10-27T14:14:30.000Z');

  const db2 = newDb();
  await deliver(db2, [hook('delivered', 0), hook('hard_bounce', 30)]);
  assert.equal(db2.logs[0].status, 'hard_bounce');
  assert.equal(db2.logs[0].error_reason, 'Rebond définitif');
});

test('événement rejoué (webhook relivré, puis resynchro API) : aucun doublon', async () => {
  const db = newDb();
  await deliver(db, hook('delivered', 0));
  await deliver(db, hook('opened', 60));
  await deliver(db, hook('opened', 60)); // relivraison Brevo
  await deliver(db, [hook('opened', 60), hook('unique_opened', 60)]);
  // Même ouverture vue par l'API statistics (date ISO avec millisecondes).
  const synced = parseStatisticsEvents({ events: [
    { event: 'opened', messageId: MID, date: '2026-10-27T14:15:00.450Z' },
    { event: 'delivered', messageId: MID, date: '2026-10-27T14:14:00.000Z' },
  ] });
  await applyBrevoEvents(db, MID, synced, 'sync', NOW);

  assert.equal(db.events.length, 2);
  assert.equal(db.logs[0].open_count, 1);
  assert.equal(db.logs[0].status, 'opened');
});

test('lot mêlant plusieurs emails : chaque ligne email_logs reçoit ses événements', async () => {
  const other = '<202610271500.1@smtp-relay.mailin.fr>';
  const db = new FakeDb([
    { id: 'log-1', provider_message_id: MID },
    { id: 'log-2', provider_message_id: other },
  ]);
  await deliver(db, [hook('delivered', 0), hook('delivered', 0, { 'message-id': other }), hook('click', 5, { 'message-id': other })]);
  assert.equal(db.logs[0].status, 'delivered');
  assert.equal(db.logs[1].status, 'clicked');
  assert.equal(db.events.length, 3);
});

test('message-id sans chevrons dans le webhook : retrouve la ligne stockée avec chevrons', async () => {
  const db = newDb();
  await deliver(db, hook('delivered', 0, { 'message-id': MID.slice(1, -1) }));
  assert.equal(db.logs[0].status, 'delivered');
});

test('message-id inconnu : rien écrit, matched = 0 (le webhook répond quand même 200)', async () => {
  const db = newDb();
  const [e] = parseWebhookBody(hook('delivered', 0, { 'message-id': '<inconnu@relay>' })).events;
  const res = await applyBrevoEvents(db, e.messageId, [e], 'webhook', NOW);
  assert.deepEqual(res, { matched: 0, updated: 0 });
  assert.equal(db.events.length, 0);
  assert.equal(db.logs[0].status, 'sent');
});

test('erreur base : remontée (le webhook répond 500 pour que Brevo réessaie)', async () => {
  const db = newDb();
  db.failOn = 'email_events';
  const { events } = parseWebhookBody(hook('delivered', 0));
  await assert.rejects(applyBrevoEvents(db, MID, events, 'webhook', NOW), /email_events/);
});

test('dedupeEvents : garde la première occurrence', () => {
  const list: BrevoEventInput[] = parseWebhookBody([hook('opened', 0), hook('unique_opened', 0), hook('opened', 1)]).events;
  assert.deepEqual(dedupeEvents(list).map((e) => e.rawEvent), ['opened', 'opened']);
});
