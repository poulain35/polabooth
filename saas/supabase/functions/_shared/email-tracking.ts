// Suivi des emails Brevo (LAB-123) : logique commune au webhook brevo-webhook et à la resynchro
// email-sync. Normalisation des événements (webhook ET API statistics/events n'ont pas le même
// vocabulaire), dédoublonnage, calcul de l'état d'une ligne email_logs depuis son historique.
// Sans import Deno/esm.sh : testé par email-tracking.test.ts sous `node --test`.

import { timingSafeEqual } from './signed-link.ts';

/** Nom normalisé stocké dans email_events.event (le nom brut Brevo reste dans payload.raw_event). */
export type TrackedEvent =
  | 'request' | 'delivered' | 'deferred' | 'opened' | 'proxy_open' | 'click'
  | 'soft_bounce' | 'hard_bounce' | 'blocked' | 'spam' | 'invalid' | 'error' | 'unsubscribed';

type EmailStatus =
  | 'sent' | 'delivered' | 'opened' | 'clicked'
  | 'soft_bounce' | 'hard_bounce' | 'blocked' | 'spam' | 'invalid' | 'error' | 'unsubscribed';

type FailureStatus = Exclude<EmailStatus, 'sent' | 'delivered' | 'opened' | 'clicked'>;

// Webhook transactionnel (champ `event`) puis API GET /v3/smtp/statistics/events (champ `event`).
// `unique_opened` et `opened` d'une même ouverture partagent leur horodatage : normalisés en
// `opened`, la clé de dédoublonnage n'en garde qu'un.
const EVENT_ALIASES: Record<string, TrackedEvent> = {
  request: 'request', requests: 'request', sent: 'request',
  delivered: 'delivered',
  deferred: 'deferred',
  opened: 'opened', unique_opened: 'opened', uniqueopened: 'opened',
  proxy_open: 'proxy_open', unique_proxy_open: 'proxy_open', loadedbyproxy: 'proxy_open',
  click: 'click', clicks: 'click', clicked: 'click',
  soft_bounce: 'soft_bounce', softbounce: 'soft_bounce', softbounces: 'soft_bounce',
  hard_bounce: 'hard_bounce', hardbounce: 'hard_bounce', hardbounces: 'hard_bounce',
  blocked: 'blocked',
  spam: 'spam',
  invalid: 'invalid', invalid_email: 'invalid',
  error: 'error',
  unsubscribed: 'unsubscribed',
};

export function normalizeBrevoEvent(raw: unknown): TrackedEvent | null {
  if (typeof raw !== 'string') return null;
  return EVENT_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** Statut porté par un événement ; null : l'événement est historisé sans changer le statut. */
const STATUS_OF_EVENT: Record<TrackedEvent, EmailStatus | null> = {
  request: 'sent',
  delivered: 'delivered',
  deferred: null,
  opened: 'opened',
  proxy_open: 'opened',
  click: 'clicked',
  soft_bounce: 'soft_bounce',
  hard_bounce: 'hard_bounce',
  blocked: 'blocked',
  spam: 'spam',
  invalid: 'invalid',
  error: 'error',
  unsubscribed: 'unsubscribed',
};

const POSITIVE_RANK = { sent: 0, delivered: 1, opened: 2, clicked: 3 } as const;
const POSITIVE_BY_RANK: EmailStatus[] = ['sent', 'delivered', 'opened', 'clicked'];

/** Motif affiché quand Brevo n'en fournit pas. */
const DEFAULT_FAILURE_REASON: Record<FailureStatus, string> = {
  soft_bounce: 'Rebond temporaire',
  hard_bounce: 'Rebond définitif',
  blocked: 'Envoi bloqué par Brevo',
  spam: 'Signalé comme spam par le destinataire',
  invalid: 'Adresse email invalide',
  error: 'Erreur Brevo',
  unsubscribed: 'Désinscription du destinataire',
};

const MAX_TEXT = 500;
const clip = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, MAX_TEXT) : null;
};

/** Événement Brevo prêt à historiser (horodatage à la seconde, UTC). */
export interface BrevoEventInput {
  messageId: string;
  event: TrackedEvent;
  rawEvent: string;
  occurredAt: string;
  reason: string | null;
  link: string | null;
  tag: string | null;
  templateId: number | null;
}

/**
 * ISO UTC à la seconde : le webhook donne des secondes (ts_event), l'API une date ISO parfois en
 * millisecondes. Tronquer aligne les deux sources sur la même clé de dédoublonnage.
 */
export function toSecondIso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function epochMs(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  // ts_epoch est documenté en millisecondes, parfois envoyé en secondes.
  return n > 1e12 ? n : n * 1000;
}

function dateMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  // « 2020-10-09 00:00:00 » sans fuseau (webhook, heure de Paris) : non fiable, ignoré.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(v.trim())) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function tagOf(v: unknown): string | null {
  if (Array.isArray(v)) return clip(v.filter((t) => typeof t === 'string').join(','));
  return clip(v);
}

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

function webhookEvent(item: unknown): BrevoEventInput | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const o = item as Json;
  const event = normalizeBrevoEvent(o.event);
  const messageId = clip(o['message-id'] ?? o.messageId ?? o.message_id);
  if (!event || !messageId) return null;
  const ms = epochMs(o.ts_event) ?? epochMs(o.ts_epoch) ?? epochMs(o.ts) ?? dateMs(o.date);
  if (ms === null) return null;
  return {
    messageId, event, rawEvent: String(o.event), occurredAt: toSecondIso(ms),
    reason: clip(o.reason), link: clip(o.link), tag: tagOf(o.tags ?? o.tag),
    templateId: Number.isInteger(o.template_id) ? o.template_id : null,
  };
}

/**
 * Corps du webhook transactionnel : un objet, ou un tableau si le webhook est créé en `batched`.
 * `ignored` : éléments non suivis (SMS, événement inconnu, message-id ou horodatage absent).
 */
export function parseWebhookBody(body: unknown): { events: BrevoEventInput[]; ignored: number } {
  const items = Array.isArray(body) ? body : [body];
  const events: BrevoEventInput[] = [];
  for (const item of items) {
    const e = webhookEvent(item);
    if (e) events.push(e);
  }
  return { events, ignored: items.length - events.length };
}

/** Réponse de GET /v3/smtp/statistics/events : { events: [{ event, date, messageId, reason, link, tag, templateId }] }. */
export function parseStatisticsEvents(body: unknown): BrevoEventInput[] {
  const list = (body as Json)?.events;
  if (!Array.isArray(list)) return [];
  const out: BrevoEventInput[] = [];
  for (const o of list as Json[]) {
    const event = normalizeBrevoEvent(o?.event);
    const messageId = clip(o?.messageId);
    const ms = dateMs(o?.date);
    if (!event || !messageId || ms === null) continue;
    out.push({
      messageId, event, rawEvent: String(o.event), occurredAt: toSecondIso(ms),
      reason: clip(o.reason), link: clip(o.link), tag: clip(o.tag),
      templateId: Number.isInteger(o.templateId) ? o.templateId : null,
    });
  }
  return out;
}

/** L'API d'envoi renvoie `<id@relay>` (stocké tel quel) ; le webhook peut l'envoyer sans chevrons. */
export function messageIdVariants(id: string): string[] {
  const bare = id.trim().replace(/^<|>$/g, '');
  return [`<${bare}>`, bare];
}

const eventKey = (e: { event: string; occurredAt: string }) => `${e.event}|${Date.parse(e.occurredAt)}`;

/** Dédoublonne sur (event, occurred_at), même clé que la contrainte email_events_dedup_key. */
export function dedupeEvents<T extends { event: string; occurredAt: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const k = eventKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Authentification du webhook : jeton `?token=` comparé à BREVO_WEBHOOK_SECRET en temps constant. */
export function authorizeWebhook(token: string | null | undefined, secret: string | null | undefined): 'ok' | 'unauthorized' | 'misconfigured' {
  if (!secret) return 'misconfigured';
  if (!token) return 'unauthorized';
  return timingSafeEqual(token, secret) ? 'ok' : 'unauthorized';
}

// ── État d'une ligne email_logs ──────────────────────────────────────────────

export interface StoredEvent {
  event: string;
  occurredAt: string;
  reason?: string | null;
}

export interface EmailState {
  status: EmailStatus;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  open_count: number;
  click_count: number;
  last_event: string | null;
  last_event_at: string | null;
  error_reason: string | null;
}

const isFailure = (s: EmailStatus): s is FailureStatus => !(s in POSITIVE_RANK);
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Ordre de deux événements horodatés à la même seconde (l'historique est lu sans ORDER BY) : celui
 * du cycle de vie d'un email. Le calcul ne dépend ainsi que de l'ensemble des événements.
 */
const SAME_SECOND_ORDER: Record<TrackedEvent, number> = {
  request: 0, deferred: 1, soft_bounce: 2, delivered: 3, proxy_open: 4, opened: 5, click: 6,
  hard_bounce: 7, blocked: 8, invalid: 9, error: 10, spam: 11, unsubscribed: 12,
};

/**
 * État recalculé depuis tout l'historique (indépendant de l'ordre d'arrivée des webhooks) :
 * - le statut ne fait que monter : sent < delivered < opened < clicked ;
 * - un état d'échec s'applique toujours ; seul un soft_bounce est levé par une remise ou une
 *   ouverture ultérieure (Brevo réessaie après un rebond temporaire) ;
 * - dates = première occurrence ; compteurs = événements distincts.
 */
export function foldEmailState(events: StoredEvent[]): EmailState {
  const sorted = dedupeEvents(
    events
      .map((e) => ({ ...e, event: normalizeBrevoEvent(e.event), ms: Date.parse(e.occurredAt) }))
      .filter((e): e is StoredEvent & { event: TrackedEvent; ms: number } => e.event !== null && !Number.isNaN(e.ms)),
  ).sort((a, b) => a.ms - b.ms || SAME_SECOND_ORDER[a.event] - SAME_SECOND_ORDER[b.event]);

  let best = 0;
  let failure: { status: FailureStatus; reason: string | null } | null = null;
  const state: EmailState = {
    status: 'sent', delivered_at: null, opened_at: null, clicked_at: null, bounced_at: null,
    open_count: 0, click_count: 0, last_event: null, last_event_at: null, error_reason: null,
  };

  for (const e of sorted) {
    const event = e.event;
    state.last_event = event;
    state.last_event_at = iso(e.ms);

    const status = STATUS_OF_EVENT[event];
    if (status && isFailure(status)) {
      failure = { status, reason: e.reason ?? null };
    } else if (status) {
      const rank = POSITIVE_RANK[status as keyof typeof POSITIVE_RANK];
      best = Math.max(best, rank);
      if (failure?.status === 'soft_bounce' && rank >= POSITIVE_RANK.delivered) failure = null;
    }

    if (event === 'delivered') state.delivered_at ??= iso(e.ms);
    if (event === 'opened' || event === 'proxy_open') {
      state.opened_at ??= iso(e.ms);
      state.open_count++;
    }
    if (event === 'click') {
      state.clicked_at ??= iso(e.ms);
      state.click_count++;
    }
    if (event === 'soft_bounce' || event === 'hard_bounce') state.bounced_at ??= iso(e.ms);
  }

  if (failure) {
    state.status = failure.status;
    state.error_reason = failure.reason ?? DEFAULT_FAILURE_REASON[failure.status];
  } else {
    state.status = POSITIVE_BY_RANK[best];
  }
  return state;
}

// ── Écriture (client supabase-js injecté) ────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface TrackingDb { from(table: string): any }

/** Ligne email_events : payload minimal, ni IP ni user-agent ni adresse du destinataire. */
export function emailEventRow(emailLogId: string, e: BrevoEventInput, source: 'webhook' | 'sync') {
  const payload: Record<string, unknown> = { source, raw_event: e.rawEvent };
  if (e.tag) payload.tag = e.tag;
  if (e.templateId !== null) payload.template_id = e.templateId;
  return {
    email_log_id: emailLogId, event: e.event, occurred_at: e.occurredAt,
    reason: e.reason, link: e.link, payload,
  };
}

export interface ApplyResult {
  matched: number;
  updated: number;
}

/**
 * Historise les événements d'un message puis recalcule les lignes email_logs correspondantes.
 * Doublons ignorés par la contrainte (ON CONFLICT DO NOTHING). Message-id inconnu : matched = 0.
 */
export async function applyBrevoEvents(
  db: TrackingDb,
  messageId: string,
  events: BrevoEventInput[],
  source: 'webhook' | 'sync',
  nowIso: string,
): Promise<ApplyResult> {
  const { data: logs, error } = await db.from('email_logs').select('id')
    .in('provider_message_id', messageIdVariants(messageId));
  if (error) throw new Error(`email_logs : ${error.message}`);
  const unique = dedupeEvents(events);
  let updated = 0;
  for (const log of (logs ?? []) as Array<{ id: string }>) {
    if (unique.length) {
      const { error: insErr } = await db.from('email_events')
        .upsert(unique.map((e) => emailEventRow(log.id, e, source)), {
          onConflict: 'email_log_id,event,occurred_at', ignoreDuplicates: true,
        });
      if (insErr) throw new Error(`email_events : ${insErr.message}`);
    }
    let rows = await readHistory(db, log.id);
    if (!rows.length) continue;
    // Webhooks concurrents (delivered et opened arrivent souvent à quelques ms d'écart) : un UPDATE
    // calculé sur un historique déjà périmé peut passer après celui d'un appel plus récent. Après
    // l'écriture, on relit l'historique (qui ne fait que grandir) ; s'il a grandi, on recalcule.
    // Le dernier UPDATE exécuté repose ainsi toujours sur l'historique complet.
    for (let pass = 0; ; pass++) {
      const state = foldEmailState(rows.map((r) => ({ event: r.event, occurredAt: r.occurred_at, reason: r.reason })));
      const { error: upErr } = await db.from('email_logs').update({ ...state, updated_at: nowIso }).eq('id', log.id);
      if (upErr) throw new Error(`email_logs : ${upErr.message}`);
      if (pass >= MAX_RECOMPUTE) break;
      const fresh = await readHistory(db, log.id);
      if (fresh.length === rows.length) break;
      rows = fresh;
    }
    updated++;
  }
  return { matched: logs?.length ?? 0, updated };
}

/** Relectures maximales de l'historique après écriture (webhooks concurrents). */
const MAX_RECOMPUTE = 3;

type HistoryRow = { event: string; occurred_at: string; reason: string | null };

async function readHistory(db: TrackingDb, emailLogId: string): Promise<HistoryRow[]> {
  const { data, error } = await db.from('email_events')
    .select('event, occurred_at, reason').eq('email_log_id', emailLogId);
  if (error) throw new Error(`email_events : ${error.message}`);
  return (data ?? []) as HistoryRow[];
}

/** Regroupe un lot par message-id (un webhook `batched` peut mêler plusieurs emails). */
export function groupByMessageId(events: BrevoEventInput[]): Map<string, BrevoEventInput[]> {
  const groups = new Map<string, BrevoEventInput[]>();
  for (const e of events) {
    const key = messageIdVariants(e.messageId)[0];
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  return groups;
}
