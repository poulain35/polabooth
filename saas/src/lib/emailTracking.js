// Suivi des emails (LAB-124) : libellés des statuts, types et événements Brevo, construction des
// filtres de la page Emails et frise d'un email. Sans import Vite ni Supabase : testé sous `node --test`.
// Noms d'événements : ceux normalisés par supabase/functions/_shared/email-tracking.ts.

import { retryHint } from './httpErrors.js';

const GRAY = { cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
const RED = { cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' };
const AMBER = { cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' };

export const EMAIL_STATUS = {
  sent:         { label: 'Envoyé',            ...GRAY },
  delivered:    { label: 'Reçu',              cls: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  opened:       { label: 'Ouvert',            cls: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500' },
  clicked:      { label: 'Cliqué',            cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  soft_bounce:  { label: 'Rebond temporaire', ...AMBER },
  hard_bounce:  { label: 'Rebond définitif',  ...RED },
  blocked:      { label: 'Bloqué',            ...RED },
  spam:         { label: 'Signalé spam',      ...RED },
  invalid:      { label: 'Adresse invalide',  ...RED },
  error:        { label: 'Erreur',            ...RED },
  unsubscribed: { label: 'Désinscrit',        ...AMBER },
};

export const EMAIL_STATUS_KEYS = Object.keys(EMAIL_STATUS);

/** Statuts mis en évidence et retenus par « Problèmes seulement ». */
export const PROBLEM_STATUSES = ['soft_bounce', 'hard_bounce', 'blocked', 'spam', 'invalid', 'error', 'unsubscribed'];

export const isProblemStatus = (status) => PROBLEM_STATUSES.includes(status);

/** Statut inconnu (ajouté côté serveur après ce code) : libellé brut, badge gris. */
export function emailStatusMeta(status) {
  const known = EMAIL_STATUS[status];
  if (known) return { ...known, problem: isProblemStatus(status) };
  return { label: status ? String(status) : 'Inconnu', ...GRAY, problem: false };
}

// ── Fournisseur d'envoi (open core étape 2, lot S2) ──────────────────────────
// Variable de build VITE_EMAIL_PROVIDER, absente = Brevo. À aligner sur EMAIL_PROVIDER des edge
// functions : en SMTP, aucun événement de réception, d'ouverture ni de clic n'arrive.

export const SMTP_TRACKING_LABEL = 'Suivi indisponible avec SMTP';

/** « smtp » seulement si la valeur le dit, sinon « brevo » (comportement d'avant S2). */
export const emailProviderOf = (value) => (String(value ?? '').trim().toLowerCase() === 'smtp' ? 'smtp' : 'brevo');

export const EMAIL_PROVIDER = emailProviderOf(import.meta.env?.VITE_EMAIL_PROVIDER);

/** Suivi des emails disponible (Brevo seulement). */
export const isTrackingAvailable = (provider = EMAIL_PROVIDER) => provider === 'brevo';

/**
 * Pastille d'un email. Sans suivi (SMTP) : « Suivi indisponible avec SMTP », sauf un refus à l'envoi
 * (statut `error`), qui vient de l'envoi et non du suivi.
 */
export function emailBadgeMeta(status, provider = EMAIL_PROVIDER) {
  if (isTrackingAvailable(provider) || status === 'error') return emailStatusMeta(status);
  return { label: SMTP_TRACKING_LABEL, ...GRAY, problem: false };
}

// ── Types (email_logs.type, écrits par les edge functions) ───────────────────

export const EMAIL_TYPE_LABELS = {
  access_code:               'Code d\'accès',
  delivery:                  'Livraison des photos',
  design_approved:           'Design validé',
  design_rejected:           'Design refusé',
  booking_request_received:  'Demande reçue',
  booking_new_request_admin: 'Nouvelle demande (alerte admin)',
  booking_recap_link:        'Lien de réservation',
  booking_refused:           'Demande refusée',
  booking_deadline_extended: 'Échéance prolongée',
  booking_reactivation:      'Réservation réactivée',
  booking_expired:           'Réservation expirée',
  booking_last_booths:       'Dernières bornes disponibles',
  booking_deposit_invoice:   'Facture d\'acompte',
  booking_deposit_request:   'Facture d\'acompte (à la demande)',
  booking_deposit_reminder:  'Relance acompte',
  booking_deposit_extended:  'Acompte prolongé',
  booking_confirmed:         'Réservation confirmée',
  booking_withdrawal_ack:    'Accusé de rétractation',
  booking_slot_confirmed:    'Créneau confirmé',
  booking_slot_cancelled:    'Créneau annulé',
  booking_pickup_reminder:   'Rappel de retrait',
  booking_return_reminder:   'Rappel de retour',
  balance_invoice:           'Facture de solde',
  balance_reminder:          'Relance solde',
  final_invoice:             'Facture finale',
  media_expiry_reminder:     'Rappel avant expiration des galeries',
  prospect_formules:         'Formules (prospect du salon)',
  prospect_follow_up:        'Relance prospect (J+10)',
};

/** Types suffixés par un nombre de jours variable (`…_j3`, `…_j14`). */
export const EMAIL_TYPE_PATTERNS = [
  { prefix: 'quote_reminder_j',          family: 'Relance devis',            label: (n) => `Relance devis (J+${n})` },
  { prefix: 'booking_recap_reminder_j',  family: 'Relance devis en ligne',   label: (n) => `Relance devis en ligne (J+${n})` },
  { prefix: 'design_reminder_j',         family: 'Relance design',           label: (n) => `Relance design (J-${n})` },
  { prefix: 'booking_slot_reminder_j',   family: 'Rappel créneaux',          label: (n) => `Rappel créneaux (J-${n})` },
];

export function emailTypeLabel(type) {
  if (!type) return 'Email';
  if (EMAIL_TYPE_LABELS[type]) return EMAIL_TYPE_LABELS[type];
  for (const p of EMAIL_TYPE_PATTERNS) {
    if (type.startsWith(p.prefix)) {
      const n = type.slice(p.prefix.length);
      if (/^\d+$/.test(n)) return p.label(n);
    }
  }
  return type;
}

/** Options du filtre « Type » : une entrée par famille à suffixe, puis les types fixes. */
export const EMAIL_TYPE_FILTERS = [
  ...EMAIL_TYPE_PATTERNS.map((p) => ({ key: `${p.prefix}*`, label: `${p.family} (toutes)`, prefix: p.prefix })),
  ...Object.entries(EMAIL_TYPE_LABELS).map(([key, label]) => ({ key, label, eq: key })),
].sort((a, b) => a.label.localeCompare(b.label, 'fr'));

// ── Événements (email_events.event) ──────────────────────────────────────────

export const EMAIL_EVENT_LABELS = {
  request:      'Envoyé',
  delivered:    'Reçu',
  deferred:     'Remise différée',
  opened:       'Ouvert',
  proxy_open:   'Ouvert (proxy de messagerie)',
  click:        'Cliqué',
  soft_bounce:  'Rebond temporaire',
  hard_bounce:  'Rebond définitif',
  blocked:      'Bloqué',
  spam:         'Signalé spam',
  invalid:      'Adresse invalide',
  error:        'Erreur',
  unsubscribed: 'Désinscription',
};

export const emailEventLabel = (event) => EMAIL_EVENT_LABELS[event] ?? (event ? String(event) : 'Événement');

/** Dernière activité connue : dernier événement Brevo, sinon l'envoi. */
export function lastActivity(log) {
  if (log?.last_event && log.last_event_at) return { label: emailEventLabel(log.last_event), at: log.last_event_at };
  return { label: 'Envoyé', at: log?.sent_at ?? null };
}

// ── Modules privés (open core, LAB-274) ──────────────────────────────────────
// Les tables `leads` (module booking) et `prospects` (module prospects) n'existent que si le
// module est installé. `modules` : ids des modules présents dans le build (INSTALLED_MODULES de
// src/features/modules.js), passé par l'appelant : ce fichier reste sans import Vite.

const NO_MODULES = new Set();

export const EMAIL_LOG_COLUMNS = 'id, lead_id, event_id, prospect_id, recipient, type, subject, sent_at, status, provider_message_id, '
  + 'delivered_at, opened_at, clicked_at, bounced_at, open_count, click_count, last_event, last_event_at, error_reason, updated_at';

/** Sélection de la page Emails : colonnes, puis lead, événement et prospect liés (selon les modules). */
export function emailLogSelect(modules = NO_MODULES) {
  return [
    EMAIL_LOG_COLUMNS,
    modules.has('booking') && 'lead:leads(id, client_name, booking_number, source, booking_status)',
    'event:events(id, name, client_name)',
    modules.has('prospects') && 'prospect:prospects(id, first_name, last_name)',
  ].filter(Boolean).join(', ');
}

/**
 * Fiche concernée par un email : demande du tunnel, devis legacy (modale de la page Devis),
 * événement ou prospect du salon. Libellé générique si la relation embarquée est absente (non lisible sous RLS).
 * Sans le module de la fiche, pas de lien vers sa page (absente) : l'email pointe vers son événement s'il en a un.
 */
export function emailContextLink(log, modules = NO_MODULES) {
  if (log?.lead_id && modules.has('booking')) {
    const lead = log.lead;
    const label = [lead?.booking_number, lead?.client_name].filter(Boolean).join(' · ') || 'Devis';
    const to = lead?.source === 'booking' && lead?.booking_status
      ? `/admin/demandes/${log.lead_id}`
      : `/admin/leads?lead=${log.lead_id}`;
    return { to, label, kind: 'lead' };
  }
  if (log?.event_id) {
    const ev = log.event;
    const label = ev?.name || ev?.client_name || 'Événement';
    return { to: `/admin/events/${log.event_id}`, label, kind: 'event' };
  }
  if (log?.prospect_id && modules.has('prospects')) {
    const pr = log.prospect;
    const label = [pr?.first_name, pr?.last_name].filter(Boolean).join(' ') || 'Prospect';
    return { to: `/admin/prospects/${log.prospect_id}`, label, kind: 'prospect' };
  }
  return null;
}

export function formatEmailDate(iso, withYear = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit',
  });
}

// ── Filtres de la page Emails ────────────────────────────────────────────────

export const EMAIL_PAGE_SIZE = 25;

/**
 * Échappe `%`, `_` et `\` pour un motif LIKE / ILIKE (échappement par défaut de Postgres). PostgREST
 * lit `*` comme un alias de `%` et ne permet pas de l'échapper : il devient `_` (un caractère).
 */
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_');

/** N° de réservation saisi (« POLA-7K3M », « pola 7k3m », « POLA-7K ») normalisé, sinon null. */
export function bookingRefOf(term) {
  const m = /^POLA([A-Z0-9]{1,4})$/.exec(String(term ?? '').toUpperCase().replace(/[\s-]+/g, ''));
  return m ? `POLA-${m[1]}` : null;
}

/** La recherche vise un n° de réservation (leads.booking_number) et non un destinataire. */
export const isBookingRefSearch = (term) => bookingRefOf(term) !== null;

const PARIS_OFFSET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Décalage de Paris (ms) à l'instant `ms`. */
function parisOffsetMs(ms) {
  const p = Object.fromEntries(PARIS_OFFSET.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60_000) * 60_000;
}

/** Minuit, heure de Paris, du jour AAAA-MM-JJ (+ addDays), en ISO UTC ; null si date invalide. */
function parisDayIso(ymd, addDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!m) return null;
  const civil = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (civil.getUTCMonth() !== +m[2] - 1 || civil.getUTCDate() !== +m[3]) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3] + addDays);
  // Les changements d'heure de Paris ont lieu à 2 h ou 3 h : le décalage à minuit est sans ambiguïté.
  const first = guess - parisOffsetMs(guess);
  return new Date(guess - parisOffsetMs(first)).toISOString();
}

/**
 * Traduit les filtres de l'interface en plan de requête :
 * { status, type, from, to (AAAA-MM-JJ inclus, jours civils de Paris), search, problemsOnly, page }.
 * `empty` : aucune ligne possible (filtres incompatibles), la requête est évitée.
 * Recherche par n° de réservation seulement avec le module booking (`modules`), sinon par destinataire.
 */
export function emailLogQueryPlan(filters = {}, { pageSize = EMAIL_PAGE_SIZE, modules = NO_MODULES } = {}) {
  const page = Math.max(0, Number.parseInt(filters.page, 10) || 0);
  const plan = {
    empty: false,
    statuses: null,
    type: null,
    sentFrom: parisDayIso(filters.from),
    sentBefore: parisDayIso(filters.to, 1),
    recipient: null,
    bookingRef: null,
    rangeFrom: page * pageSize,
    rangeTo: page * pageSize + pageSize - 1,
  };

  let statuses = filters.status && filters.status !== 'all' ? [filters.status] : null;
  if (filters.problemsOnly) statuses = statuses ? statuses.filter(isProblemStatus) : [...PROBLEM_STATUSES];
  plan.statuses = statuses;
  if (statuses && statuses.length === 0) plan.empty = true;

  if (filters.type && filters.type !== 'all') {
    const option = EMAIL_TYPE_FILTERS.find((o) => o.key === filters.type);
    if (option?.prefix) plan.type = { like: `${escapeLike(option.prefix)}%` };
    else plan.type = { eq: option?.eq ?? filters.type };
  }

  if (plan.sentFrom && plan.sentBefore && plan.sentFrom >= plan.sentBefore) plan.empty = true;

  const term = (filters.search ?? '').trim();
  if (term) {
    plan.bookingRef = modules.has('booking') ? bookingRefOf(term) : null;
    if (!plan.bookingRef) plan.recipient = term;
  }
  return plan;
}

/**
 * Emails rattachés aux réservations trouvées : le lead lui-même et l'événement issu de sa
 * conversion (code d'accès, livraison… sont rattachés à l'événement).
 */
export function bookingRefScope(leads) {
  const leadIds = [...new Set((leads ?? []).map((l) => l.id).filter(Boolean))];
  const eventIds = [...new Set((leads ?? []).map((l) => l.converted_event_id).filter(Boolean))];
  return { leadIds, eventIds };
}

/** Applique le plan à une requête supabase-js `from('email_logs').select(…)` : filtres, tri, page. */
export function applyEmailLogPlan(query, plan, refScope = null) {
  let q = query;
  if (plan.statuses) q = plan.statuses.length === 1 ? q.eq('status', plan.statuses[0]) : q.in('status', plan.statuses);
  if (plan.type?.eq) q = q.eq('type', plan.type.eq);
  if (plan.type?.like) q = q.like('type', plan.type.like);
  if (plan.sentFrom) q = q.gte('sent_at', plan.sentFrom);
  if (plan.sentBefore) q = q.lt('sent_at', plan.sentBefore);
  if (plan.recipient) q = q.ilike('recipient', `%${escapeLike(plan.recipient)}%`);
  if (refScope) {
    const parts = [];
    if (refScope.leadIds.length) parts.push(`lead_id.in.(${refScope.leadIds.join(',')})`);
    if (refScope.eventIds.length) parts.push(`event_id.in.(${refScope.eventIds.join(',')})`);
    q = q.or(parts.join(','));
  }
  return q
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .range(plan.rangeFrom, plan.rangeTo);
}

// ── Détail d'un email ────────────────────────────────────────────────────────

// Brevo date à la seconde : à égalité, ordre logique (même table que _shared/email-tracking.ts).
const SAME_SECOND_ORDER = {
  request: 0, deferred: 1, soft_bounce: 2, delivered: 3, proxy_open: 4, opened: 5, click: 6,
  hard_bounce: 7, blocked: 8, invalid: 9, error: 10, spam: 11, unsubscribed: 12,
};

/** URL cliquable seulement en http(s) : un lien `javascript:` ou `data:` reste du texte. */
export function safeHttpUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Frise d'un email : l'envoi (email_logs.sent_at), puis l'historique Brevo dans l'ordre. Les
 * ouvertures sont regroupées (« Ouvert ×N ») ; l'événement `request` double l'envoi, il est omis.
 * Item : { key, kind, label, at, detail?, link? (texte), href? (http(s) seulement), problem? }.
 */
export function buildEmailTimeline(log, events = []) {
  const items = [];
  if (log?.sent_at) items.push({ key: 'sent', kind: 'sent', label: 'Envoyé', at: log.sent_at });

  const sorted = [...(events ?? [])]
    .filter((e) => e?.event && e.event !== 'request' && e.occurred_at)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)
      || (SAME_SECOND_ORDER[a.event] ?? 99) - (SAME_SECOND_ORDER[b.event] ?? 99));

  let opens = null;
  for (const e of sorted) {
    if (e.event === 'opened' || e.event === 'proxy_open') {
      if (!opens) {
        opens = { key: `open-${e.occurred_at}`, kind: 'opened', label: 'Ouvert', at: e.occurred_at, count: 0, proxyCount: 0, lastAt: e.occurred_at };
        items.push(opens);
      }
      opens.count++;
      if (e.event === 'proxy_open') opens.proxyCount++;
      opens.lastAt = e.occurred_at;
      continue;
    }
    const problem = isProblemStatus(e.event) || e.event === 'deferred';
    items.push({
      key: `${e.event}-${e.occurred_at}-${e.id ?? items.length}`,
      kind: e.event,
      label: emailEventLabel(e.event),
      at: e.occurred_at,
      detail: e.reason ?? null,
      link: e.event === 'click' ? e.link ?? null : null,
      href: e.event === 'click' ? safeHttpUrl(e.link) : null,
      problem,
    });
  }

  if (opens) {
    opens.label = opens.count > 1 ? `Ouvert ×${opens.count}` : 'Ouvert';
    if (opens.proxyCount) {
      opens.detail = opens.proxyCount === opens.count
        ? 'Ouverture par un proxy de messagerie (peut être automatique)'
        : `Dont ${opens.proxyCount} par un proxy de messagerie`;
    }
  }
  return items;
}

/** Email sans message-id Brevo : refusé à l'envoi (statut error, motif éventuel) ou antérieur au suivi. */
export function noTrackingMessage(log) {
  if (log?.status === 'error') {
    const reason = typeof log.error_reason === 'string' ? log.error_reason.trim() : '';
    return `Refusé par Brevo à l'envoi : aucun suivi possible.${reason ? ` Motif : ${reason}` : ''}`;
  }
  return 'Email envoyé avant la mise en place du suivi : aucun identifiant Brevo n\'a été enregistré. '
    + 'Son statut ne peut être ni suivi ni resynchronisé.';
}

/**
 * Lien ?lead=… (page Emails vers la page Devis) : `pendingId` est le paramètre pas encore consommé
 * (null une fois traité). `consumed` : retirer le paramètre de l'URL et oublier le drapeau.
 */
export function resolveLeadLink(pendingId, leads) {
  if (!pendingId) return { lead: null, consumed: false };
  return { lead: (leads ?? []).find((l) => l.id === pendingId) ?? null, consumed: true };
}

/** Message affiché quand la resynchronisation échoue (erreur levée par syncEmailLog). */
export function syncErrorMessage(err) {
  switch (err?.status) {
    case 422: return 'Cet email n\'a pas d\'identifiant Brevo : il ne peut pas être resynchronisé.';
    case 403: return 'Vous n\'avez pas accès à cet email.';
    case 401: return 'Session expirée : reconnectez-vous.';
    case 404: return 'Cet email n\'existe plus.';
    case 429: return `Trop de resynchronisations (20 par tranche de 10 minutes). ${err.retryAfter ? retryHint(err.retryAfter) : 'Réessayez dans quelques minutes.'}`;
    case 502:
    case 503: return 'Brevo ne répond pas pour le moment. Réessayez plus tard.';
    default: return err?.message || 'La resynchronisation a échoué.';
  }
}

/** Libellé du type de fiche liée à un email (résumé de la modale de détail). */
export const EMAIL_CONTEXT_KIND_LABELS = { lead: 'Devis', event: 'Événement', prospect: 'Prospect' };
