// Revue LAB-123 : cas limites du suivi des emails Brevo (ordre d'arrivée, même seconde,
// webhooks concurrents, rejeu, lots), contrôles statiques de la migration, de config.toml et de
// l'inventaire des envois journalisés.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBrevoEvents, foldEmailState, groupByMessageId, parseStatisticsEvents, parseWebhookBody,
  type BrevoEventInput,
} from './email-tracking.ts';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const MID = '<202610271414.67460013699@smtp-relay.mailin.fr>';
const T0 = Date.parse('2026-10-27T14:14:00Z') / 1000;
const NOW = '2026-10-27T15:00:00.000Z';

const hook = (event: string, offsetS: number, extra: Record<string, unknown> = {}) =>
  ({ event, 'message-id': MID, ts_event: T0 + offsetS, ...extra });
const at = (event: string, offsetS: number, reason: string | null = null) =>
  ({ event, occurredAt: new Date((T0 + offsetS) * 1000).toISOString(), reason });

// ── Faux client supabase-js, avec un point d'interception avant chaque UPDATE ──

interface Row { [k: string]: unknown }

class FakeDb {
  logs: Row[];
  events: Row[] = [];
  /** Appelé avant d'appliquer un UPDATE email_logs : simule un autre webhook qui s'intercale. */
  beforeUpdate: (() => Promise<void>) | null = null;
  updates = 0;
  constructor(logs: Row[]) { this.logs = logs; }

  from(table: string) {
    const db = this;
    return {
      select(_cols: string) {
        return {
          in(col: string, vals: unknown[]) {
            return Promise.resolve({ data: db.logs.filter((r) => vals.includes(r[col])).map((r) => ({ id: r.id })), error: null });
          },
          eq(col: string, val: unknown) {
            // Ordre de lecture non garanti (pas d'ORDER BY) : on renvoie l'historique à l'envers
            // de l'ordre d'insertion pour vérifier que le calcul n'en dépend pas.
            return Promise.resolve({ data: db.events.filter((r) => r[col] === val).map((r) => ({ ...r })).reverse(), error: null });
          },
        };
      },
      upsert(rows: Row[], opts: { onConflict: string; ignoreDuplicates: boolean }) {
        const cols = opts.onConflict.split(',');
        const key = (r: Row) => cols.map((c) => (c === 'occurred_at' ? Date.parse(String(r[c])) : r[c])).join('|');
        for (const r of rows) if (!db.events.some((e) => key(e) === key(r))) db.events.push({ ...r });
        return Promise.resolve({ error: null });
      },
      update(patch: Row) {
        return {
          async eq(col: string, val: unknown) {
            const hookFn = db.beforeUpdate;
            db.beforeUpdate = null;
            if (hookFn) await hookFn();
            db.updates++;
            for (const r of db.logs) if (r[col] === val) Object.assign(r, patch);
            return { error: null };
          },
        };
      },
    };
  }
}

const newDb = () => new FakeDb([{ id: 'log-1', provider_message_id: MID, status: 'sent', open_count: 0, click_count: 0 }]);

async function deliver(db: FakeDb, body: unknown) {
  const { events } = parseWebhookBody(body);
  for (const [mid, list] of groupByMessageId(events)) await applyBrevoEvents(db, mid, list, 'webhook', NOW);
}

// ── Webhooks concurrents ─────────────────────────────────────────────────────

test('webhooks concurrents : un recalcul fait sur un historique périmé n\'écrase pas le plus récent', async () => {
  // Brevo envoie `delivered` et `opened` (ouverture par proxy Apple) par deux appels HTTP quasi
  // simultanés. A lit l'historique (delivered seul) ; B insère `opened`, recalcule et écrit
  // « opened » ; puis l'UPDATE de A, calculé sur l'historique périmé, arrive en dernier.
  const db = newDb();
  db.beforeUpdate = () => deliver(db, hook('opened', 5));
  await deliver(db, hook('delivered', 0));

  assert.equal(db.events.length, 2);
  const log = db.logs[0];
  assert.equal(log.status, 'opened', 'le statut doit refléter tout l\'historique');
  assert.equal(log.open_count, 1);
  assert.equal(log.delivered_at, '2026-10-27T14:14:00.000Z');
  assert.equal(log.opened_at, '2026-10-27T14:14:05.000Z');
  assert.equal(log.last_event, 'opened');
});

test('webhooks concurrents : sans événement intercalé, un seul UPDATE par ligne', async () => {
  const db = newDb();
  await deliver(db, hook('delivered', 0));
  assert.equal(db.updates, 1);
});

// ── Ordre d'arrivée et même seconde ──────────────────────────────────────────

function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

test('fold : même seconde, le résultat ne dépend pas de l\'ordre de lecture de l\'historique', () => {
  const sets = [
    [at('delivered', 0), at('proxy_open', 0)],
    [at('request', 0), at('delivered', 0), at('opened', 0), at('click', 0)],
    [at('soft_bounce', 0), at('delivered', 0)],
    [at('request', 0), at('blocked', 0)],
    [at('delivered', 0), at('hard_bounce', 0)],
  ];
  for (const set of sets) {
    const states = permutations(set).map((p) => JSON.stringify(foldEmailState(p)));
    assert.equal(new Set(states).size, 1, set.map((e) => e.event).join('+'));
  }
});

test('fold : même seconde, les étapes sont ordonnées dans le cycle de vie (dernier événement = le plus avancé)', () => {
  assert.equal(foldEmailState([at('proxy_open', 0), at('delivered', 0)]).last_event, 'proxy_open');
  assert.equal(foldEmailState([at('click', 0), at('opened', 0), at('request', 0)]).last_event, 'click');
  assert.equal(foldEmailState([at('blocked', 0), at('request', 0)]).status, 'blocked');
  // Rebond temporaire puis remise dans la même seconde : la remise lève le rebond.
  assert.equal(foldEmailState([at('delivered', 0), at('soft_bounce', 0)]).status, 'delivered');
});

test('fold : `opened` horodaté avant `delivered` : opened, les deux dates remplies', () => {
  const s = foldEmailState([at('opened', 0), at('delivered', 3)]);
  assert.equal(s.status, 'opened');
  assert.equal(s.opened_at, '2026-10-27T14:14:00.000Z');
  assert.equal(s.delivered_at, '2026-10-27T14:14:03.000Z');
  assert.equal(s.last_event, 'delivered');
});

test('fold : `click` sans `opened` : clicked, aucune ouverture comptée ni datée', () => {
  const s = foldEmailState([at('delivered', 0), at('click', 60)]);
  assert.equal(s.status, 'clicked');
  assert.equal(s.open_count, 0);
  assert.equal(s.opened_at, null);
  assert.equal(s.click_count, 1);
});

test('fold : hard_bounce puis opened : reste hard_bounce, l\'ouverture est quand même comptée', () => {
  const s = foldEmailState([at('delivered', 0), at('hard_bounce', 10, '550 unknown'), at('opened', 60)]);
  assert.equal(s.status, 'hard_bounce');
  assert.equal(s.error_reason, '550 unknown');
  assert.equal(s.open_count, 1);
});

test('fold : soft_bounce, deferred, puis delivered : delivered, motif effacé, deferred sans effet', () => {
  const s = foldEmailState([at('request', 0), at('soft_bounce', 1), at('deferred', 2), at('delivered', 600)]);
  assert.equal(s.status, 'delivered');
  assert.equal(s.error_reason, null);
  assert.equal(foldEmailState([at('request', 0), at('soft_bounce', 1), at('deferred', 2)]).status, 'soft_bounce');
});

test('fold : soft_bounce suivi d\'une simple requête (request) reste soft_bounce', () => {
  assert.equal(foldEmailState([at('soft_bounce', 0), at('request', 5)]).status, 'soft_bounce');
});

test('fold : unique_opened + opened à la même seconde = une ouverture', () => {
  assert.equal(foldEmailState([at('unique_opened', 0), at('opened', 0)]).open_count, 1);
});

test('fold : deux vraies ouvertures dans la même seconde sont fusionnées (limite connue du dédoublonnage)', () => {
  // La clé (event, occurred_at à la seconde) ne distingue pas deux ouvertures de la même seconde :
  // open_count sous-estime d'une unité. Perte assumée, sans effet sur le statut ni les dates.
  const s = foldEmailState([at('opened', 0), at('opened', 0)]);
  assert.equal(s.open_count, 1);
  assert.equal(s.status, 'opened');
});

test('fold : proxy_open compte comme une ouverture, et s\'ajoute à une ouverture réelle', () => {
  const s = foldEmailState([at('delivered', 0), at('proxy_open', 1), at('opened', 120)]);
  assert.equal(s.status, 'opened');
  assert.equal(s.open_count, 2);
  assert.equal(s.opened_at, '2026-10-27T14:14:01.000Z');
});

test('fold : événements inconnus ou dates illisibles de l\'historique ignorés', () => {
  const s = foldEmailState([at('delivered', 0), { event: 'list_addition', occurredAt: NOW }, { event: 'opened', occurredAt: 'pas une date' }]);
  assert.equal(s.status, 'delivered');
  assert.equal(s.open_count, 0);
});

// ── De bout en bout sur le faux client ───────────────────────────────────────

test('critère : delivered, opened ×2, click arrivés dans le désordre : même état qu\'en ordre', async () => {
  const ordered = newDb();
  for (const h of [hook('delivered', 0), hook('opened', 60), hook('opened', 600), hook('click', 660)]) await deliver(ordered, h);
  const shuffled = newDb();
  for (const h of [hook('click', 660), hook('opened', 600), hook('delivered', 0), hook('opened', 60)]) await deliver(shuffled, h);
  assert.deepEqual(shuffled.logs[0], ordered.logs[0]);
  assert.equal(ordered.logs[0].status, 'clicked');
  assert.equal(ordered.logs[0].open_count, 2);
  assert.equal(ordered.events.length, 4);
});

test('rejeu complet de la suite (webhook relivré en lot) : ni doublon ni changement d\'état', async () => {
  const db = newDb();
  const seq = [hook('delivered', 0), hook('unique_opened', 60), hook('opened', 60), hook('click', 90)];
  await deliver(db, seq);
  const first = { ...db.logs[0] };
  const count = db.events.length;
  await deliver(db, seq);
  await deliver(db, [...seq].reverse());
  assert.equal(db.events.length, count);
  assert.equal(count, 3);
  assert.deepEqual(db.logs[0], first);
});

test('lot batched : message-id connu et inconnu mêlés, seul le connu est historisé', async () => {
  const db = newDb();
  const { events } = parseWebhookBody([hook('delivered', 0), hook('delivered', 0, { 'message-id': '<inconnu@relay>' })]);
  let matched = 0;
  for (const [mid, list] of groupByMessageId(events)) matched += (await applyBrevoEvents(db, mid, list, 'webhook', NOW)).matched;
  assert.equal(matched, 1);
  assert.equal(db.events.length, 1);
  assert.equal(db.logs[0].status, 'delivered');
});

test('webhook : ts_event transmis en chaîne numérique accepté', () => {
  const [e] = parseWebhookBody(hook('delivered', 0, { ts_event: String(T0) })).events;
  assert.equal(e.occurredAt, '2026-10-27T14:14:00Z');
});

test('resynchro sans nouvel événement : rien inséré, l\'état est recalculé depuis l\'historique existant', async () => {
  const db = newDb();
  await deliver(db, hook('delivered', 0));
  db.logs[0].status = 'sent'; // état corrompu à la main
  const res = await applyBrevoEvents(db, MID, [], 'sync', NOW);
  assert.deepEqual(res, { matched: 1, updated: 1 });
  assert.equal(db.logs[0].status, 'delivered');
  assert.equal(db.events.length, 1);
});

test('resynchro API puis webhook de la même seconde (millisecondes différentes) : pas de doublon', async () => {
  const db = newDb();
  const synced: BrevoEventInput[] = parseStatisticsEvents({ events: [
    { event: 'delivered', messageId: MID, date: '2026-10-27T15:14:00.870+01:00' },
  ] });
  await applyBrevoEvents(db, MID, synced, 'sync', NOW);
  await deliver(db, hook('delivered', 0));
  assert.equal(db.events.length, 1);
});

// ── Contrôles statiques : migration, config.toml, inventaire des envois ──────

const FUNCTIONS = fileURLToPath(new URL('../', import.meta.url));
const MIGRATION = fileURLToPath(new URL('../../migrations/20261111000000_email_tracking.sql', import.meta.url));
const stripSql = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

test('migration : DROP du CHECK, puis conversion bounced → hard_bounce, puis nouveau CHECK sans bounced', { skip: PRIVATE_HISTORY }, () => {
  const sql = stripSql(readFileSync(MIGRATION, 'utf8'));
  const drop = sql.indexOf('DROP CONSTRAINT IF EXISTS email_logs_status_check');
  const update = sql.search(/UPDATE public\.email_logs[\s\S]*?WHERE status = 'bounced'/);
  const add = sql.indexOf('ADD CONSTRAINT email_logs_status_check');
  assert.ok(drop >= 0 && update > drop && add > update, 'ordre DROP < UPDATE < ADD');
  const check = sql.slice(add, sql.indexOf(';', add));
  assert.ok(!check.includes("'bounced'"));
  for (const s of ['sent', 'delivered', 'opened', 'clicked', 'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'invalid', 'error', 'unsubscribed']) {
    assert.ok(check.includes(`'${s}'`), s);
  }
});

test('migration : rejouable (IF NOT EXISTS / IF EXISTS partout), ne touche pas email_logs_scope_chk', { skip: PRIVATE_HISTORY }, () => {
  const sql = stripSql(readFileSync(MIGRATION, 'utf8'));
  for (const m of sql.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/g)) assert.fail(`ADD COLUMN sans IF NOT EXISTS à ${m.index}`);
  assert.ok(!/CREATE TABLE (?!IF NOT EXISTS)/.test(sql));
  assert.ok(!/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/.test(sql));
  assert.match(sql, /DROP POLICY IF EXISTS email_events_owner_select/);
  assert.ok(!sql.includes('email_logs_scope_chk'));
  assert.ok(!/num_nonnulls/.test(sql));
  // Colonnes NOT NULL ajoutées avec une valeur par défaut (table déjà remplie).
  for (const m of sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+[^,;]*NOT NULL[^,;]*/g)) assert.match(m[0], /DEFAULT/, m[1]);
});

test('migration : email_events sous RLS, lecture seule pour authenticated, rien pour anon, ni IP ni user-agent', { skip: PRIVATE_HISTORY }, () => {
  const sql = stripSql(readFileSync(MIGRATION, 'utf8'));
  assert.match(sql, /ALTER TABLE public\.email_events ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.email_events FROM anon/);
  assert.match(sql, /REVOKE ALL ON public\.email_events FROM authenticated/);
  assert.ok(!/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*email_events TO (anon|authenticated)/i.test(sql));
  assert.ok(!/GRANT[^;]*email_events TO anon/i.test(sql));
  const policies = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
  assert.ok(policies.length >= 1);
  for (const p of policies) assert.match(p, /FOR SELECT TO authenticated/);
  assert.match(sql, /CONSTRAINT email_events_dedup_key UNIQUE \(email_log_id, event, occurred_at\)/);
  const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.email_events'), sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS public.email_events')));
  assert.ok(!/\b(ip|user_agent|sending_ip|email)\b/i.test(table.replace(/email_log_id|email_logs|email_events/g, '')));
});

test('config.toml : brevo-webhook sans JWT, email-sync avec JWT', () => {
  const toml = readFileSync(fileURLToPath(new URL('../../config.toml', import.meta.url)), 'utf8');
  assert.match(toml, /\[functions\.brevo-webhook\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.email-sync\]\s*\nverify_jwt = true/);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

// Emails internes, volontairement non journalisés (alertes, notifications admin, photos kiosk).
const INTERNAL_SENDERS = new Set([
  'check-cron-alerts/index.ts', 'check-kiosk-alerts/index.ts', 'send-kiosk-photo/index.ts',
  'submit-design/index.ts', 'submit-support-message/index.ts',
]);
// Envoi par une dépendance injectée (deps.sendEmail) : la journalisation (prospect_id) est faite par
// l'appelant, booking-decision/index.ts via _shared/prospect-email.ts.
const NO_SCOPE_SENDERS = new Set(['booking-decision/prospect.ts']);
const CLIENT_SEND =/\b(sendBookingEmail|sendAccessCodeEmail|sendApprovalEmail|sendRejectionEmail|sendDesignReminderEmail|sendDeliveryEmail|deps\.sendEmail)\(/;

test('inventaire : tout fichier qui envoie un email client le journalise', () => {
  const missing: string[] = [];
  for (const file of sourceFiles(FUNCTIONS)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/');
    if (rel === '_shared/email.ts' || INTERNAL_SENDERS.has(rel) || NO_SCOPE_SENDERS.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    if (!CLIENT_SEND.test(src)) continue;
    if (!/\b(logEmail|recordEmailLog)\(/.test(src)) missing.push(rel);
  }
  assert.deepEqual(missing, []);
});

test('inventaire : chaque résultat SentEmail est transmis à recordEmailLog', () => {
  const sentEmailFns = /await (sendAccessCodeEmail|sendApprovalEmail|sendRejectionEmail|sendDesignReminderEmail|sendDeliveryEmail)\(/g;
  for (const file of sourceFiles(FUNCTIONS)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/');
    if (rel.startsWith('_shared/')) continue;
    const src = readFileSync(file, 'utf8');
    const calls = [...src.matchAll(sentEmailFns)].length;
    if (!calls) continue;
    assert.match(src, /recordEmailLog\(db, \{[\s\S]*?\.\.\.sentEmail/, rel);
    // Aucun appel dont le résultat serait ignoré (`await sendXxx(` en début d'instruction).
    assert.ok(!/^\s*await (sendAccessCodeEmail|sendApprovalEmail|sendRejectionEmail|sendDesignReminderEmail|sendDeliveryEmail)\(/m.test(src), rel);
  }
});
