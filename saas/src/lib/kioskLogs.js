// Journaux des bornes (LAB-327) : logique pure du panneau `components/admin/KioskLogsPanel.jsx`.
// Aucun appel réseau ici : filtres PostgREST, attribution des journaux à une borne, libellés,
// regroupement, pagination, messages clairs et export texte. Testé dans kioskLogs.test.js.
import { countLabel } from './format.js';

export const LOG_PAGE_SIZE = 100;
export const LOG_EXPORT_MAX = 5000;
export const LOG_EXPORT_CHUNK = 1000;
// Nouveaux journaux lus d'un coup (temps réel ou relecture périodique) ; au-delà, on recharge.
export const LOG_REFRESH_MAX = 500;
export const LOG_COLUMNS =
  'id, machine_id, level, context, message, stack_trace, app_version, occurred_at, created_at, event_id, session_id';

const TIME_ZONE = 'Europe/Paris';

export const LEVELS = {
  error:   { label: 'Erreur' },
  warning: { label: 'Alerte' },
  info:    { label: 'Info' },
};

// Contextes écrits par la borne (LogErrorAsync / LogWarningAsync / LogInfoAsync), rangés par type.
// « Application » prend tout le reste, contexte vide compris.
export const CONTEXT_GROUPS = [
  { id: 'camera', label: 'Caméra', contexts: ['camera', 'camera-evf', 'camera-evt', 'capture', 'composite'] },
  { id: 'print', label: 'Impression', contexts: ['print'] },
  {
    id: 'upload', label: 'Envoi',
    contexts: ['photo_upload', 'email', 'sync-print-logs', 'guest_responses', 'photo_consents',
      'sync-guest-responses', 'sync-photo-consents', 'sync-kiosk-logs'],
  },
  {
    id: 'sync', label: 'Synchro',
    contexts: ['sync', 'sync-background', 'sync-design', 'sync-logo', 'sync-home', 'sync-pola', 'pola-history',
      'screens', 'event-setup', 'event-push', 'frames', 'home'],
  },
  { id: 'app', label: 'Application', contexts: null },
];

const GROUPED_CONTEXTS = CONTEXT_GROUPS.flatMap((g) => g.contexts ?? []);

/** Type d'un contexte : 'camera' | 'print' | 'upload' | 'sync' | 'app'. */
export function contextGroup(context) {
  const c = String(context ?? '').trim();
  return CONTEXT_GROUPS.find((g) => g.contexts?.includes(c))?.id ?? 'app';
}

export const PERIODS = [
  { id: '24h', label: '24 h', hours: 24 },
  { id: '7d', label: '7 jours', hours: 24 * 7 },
  { id: '30d', label: '30 jours', hours: 24 * 30 },
  { id: 'all', label: 'Tout', hours: null },
];

/** Début de la période (ISO), ou null pour « Tout ». */
export function periodStart(period, now = Date.now()) {
  const p = PERIODS.find((x) => x.id === period);
  if (!p?.hours) return null;
  return new Date(now - p.hours * 3600 * 1000).toISOString();
}

// ── Valeurs PostgREST ───────────────────────────────────────────────────────────────────────

/** Valeur entre guillemets pour un filtre `or=(…)` (virgules, parenthèses, deux-points permis). */
export function pgQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Texte cherché : jokers retirés, espaces resserrés, 100 caractères au plus. */
export function cleanSearch(text) {
  return String(text ?? '').replace(/[*%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const joinAnd = (parts) => (parts.length === 1 ? parts[0] : `and(${parts.join(',')})`);

// ── Bornes : fenêtres d'historique et attribution ───────────────────────────────────────────

const toMs = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
};

/** Nom d'une borne : son nom donné, sinon le nom du PC. */
export function kioskName(license) {
  return license?.label || license?.machine_name || 'Borne sans nom';
}

/**
 * Fenêtres « tel PC sous telle borne » d'après kiosk_license_machines, comme kiosk_log_visible :
 * un journal appartient à la fenêtre qui contient sa date de réception (created_at). La fenêtre
 * commence à l'association seulement si le PC a d'abord servi sous une autre borne (sinon les
 * journaux d'avant l'association restent à elle) ; elle finit au remplacement du PC.
 * Sans historique lisible : une fenêtre ouverte par borne qui a un PC.
 */
export function kioskWindows(licenses = [], history = null) {
  const byId = new Map(licenses.map((l) => [l.id, l]));
  const rows = (history ?? []).filter((h) => h?.machine_id && h?.license_id);
  const windows = rows.map((h) => {
    const at = toMs(h.associated_at);
    const takenOver = at != null && rows.some((p) =>
      p.machine_id === h.machine_id && p.license_id !== h.license_id && (toMs(p.associated_at) ?? Infinity) < at);
    return {
      licenseId: h.license_id,
      machineId: h.machine_id,
      machineName: h.machine_name ?? null,
      start: takenOver ? h.associated_at : null,
      end: h.replaced_at ?? null,
    };
  });
  const withHistory = new Set(rows.map((h) => h.license_id));
  for (const l of licenses) {
    if (l.machine_id && !withHistory.has(l.id)) {
      windows.push({ licenseId: l.id, machineId: l.machine_id, machineName: l.machine_name ?? null, start: null, end: null });
    }
  }
  return windows.map((w) => ({ ...w, license: byId.get(w.licenseId) ?? null }));
}

function windowContains(w, t) {
  if (t == null) return w.end == null;
  if (w.start != null && t < toMs(w.start)) return false;
  if (w.end != null && t >= toMs(w.end)) return false;
  return true;
}

/**
 * Borne d'un journal : { key, licenseId, name, color, machineName, machineId, known, retired }.
 * PC sans borne connue : « PC inconnu » et le début de son identifiant.
 */
export function resolveKiosk(log, windows = []) {
  const machineId = log?.machine_id ?? '';
  const t = toMs(log?.created_at ?? log?.occurred_at);
  const match = windows
    .filter((w) => w.machineId === machineId && w.license && windowContains(w, t))
    .sort((a, b) => (toMs(b.start) ?? -Infinity) - (toMs(a.start) ?? -Infinity))[0];
  if (!match) {
    return {
      key: `machine:${machineId}`, licenseId: null, name: 'PC inconnu', color: null,
      machineName: null, machineId, shortId: machineId.slice(0, 8), known: false, retired: false,
    };
  }
  const lic = match.license;
  return {
    key: `lic:${lic.id}`, licenseId: lic.id, name: kioskName(lic), color: lic.color || null,
    machineName: match.machineName || lic.machine_name || null, machineId,
    shortId: machineId.slice(0, 8), known: true, retired: Boolean(lic.retired_at),
  };
}

/** « LOCAL (PC SALLE-1) », « PC inconnu b2c56bac ». */
export function kioskText(kiosk) {
  if (!kiosk.known) return `PC inconnu ${kiosk.shortId}`.trim();
  const pc = kiosk.machineName && kiosk.machineName !== kiosk.name ? ` (PC ${kiosk.machineName})` : '';
  return `${kiosk.name}${pc}${kiosk.retired ? ' · retirée' : ''}`;
}

/**
 * Choix du filtre « Borne » : chaque borne de la liste (retirées comprises, après les autres),
 * puis les PC inconnus vus dans les journaux chargés.
 */
export function kioskOptions(licenses = [], logs = [], windows = []) {
  const options = [...licenses]
    .sort((a, b) => Number(Boolean(a.retired_at)) - Number(Boolean(b.retired_at))
      || kioskName(a).localeCompare(kioskName(b), 'fr'))
    .map((l) => ({
      value: `lic:${l.id}`, label: kioskName(l), color: l.color || null,
      machineName: l.machine_name || null, retired: Boolean(l.retired_at),
    }));
  const seen = new Set();
  for (const log of logs) {
    const k = resolveKiosk(log, windows);
    if (k.known || seen.has(k.key)) continue;
    seen.add(k.key);
    options.push({ value: k.key, label: `PC inconnu ${k.shortId}`, color: null, machineName: null, retired: false });
  }
  return options;
}

function kioskClause(kiosk, windows) {
  if (!kiosk || kiosk === 'all') return null;
  if (kiosk.startsWith('machine:')) return `machine_id.eq.${pgQuote(kiosk.slice(8))}`;
  if (!kiosk.startsWith('lic:')) return null;
  const id = kiosk.slice(4);
  const parts = windows.filter((w) => w.licenseId === id).map((w) => joinAnd([
    `machine_id.eq.${pgQuote(w.machineId)}`,
    ...(w.start ? [`created_at.gte.${pgQuote(w.start)}`] : []),
    ...(w.end ? [`created_at.lt.${pgQuote(w.end)}`] : []),
  ]));
  // Borne qui n'a jamais eu de PC : aucun journal (l'id n'est jamais nul).
  if (parts.length === 0) return 'id.is.null';
  return parts.length === 1 ? parts[0] : `or(${parts.join(',')})`;
}

// ── Filtres ─────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS = {
  kiosk: 'all', event: 'all', session: null, period: 'all', group: 'all', level: 'all', search: '',
};

/**
 * Filtres serveur : { eq: [[col, val]], is: [[col, null]], in: [[col, vals]], gte: [[col, val]],
 * or: string|null } (contenu de `or=(…)`, les conditions à plusieurs branches étant réunies par un
 * `and(…)`). `eventId` (prop du panneau) fixe l'événement.
 */
export function buildLogFilters(filters = {}, { windows = [], now = Date.now(), eventId = null } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const out = { eq: [], is: [], in: [], gte: [], branches: [], or: null };
  const branches = [];

  const kiosk = kioskClause(f.kiosk, windows);
  if (kiosk) branches.push(kiosk);

  const event = eventId || f.event;
  if (event === 'none') out.is.push(['event_id', null]);
  else if (event && event !== 'all') out.eq.push(['event_id', event]);

  if (f.session) out.eq.push(['session_id', f.session]);
  if (f.level && f.level !== 'all') out.eq.push(['level', f.level]);

  const start = periodStart(f.period, now);
  if (start) out.gte.push(['occurred_at', start]);

  const group = CONTEXT_GROUPS.find((g) => g.id === f.group);
  if (group?.contexts) out.in.push(['context', group.contexts]);
  else if (group) branches.push(`or(context.is.null,context.not.in.(${GROUPED_CONTEXTS.join(',')}))`);

  const search = cleanSearch(f.search);
  if (search) {
    const v = pgQuote(`*${search}*`);
    branches.push(`or(message.ilike.${v},context.ilike.${v})`);
  }

  out.branches = branches;
  out.or = combineBranches(branches);
  return out;
}

/** Contenu de `or=(…)` qui exige toutes les conditions données, ou null. */
export function combineBranches(branches) {
  const list = branches.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) {
    const only = list[0];
    // `or(a,b)` seul → `a,b` ; une condition simple ou un `and(…)` reste tel quel.
    return only.startsWith('or(') && only.endsWith(')') ? only.slice(3, -1) : only;
  }
  return `and(${list.join(',')})`;
}

/** Ajoute une condition à un filtre déjà construit (curseur, nouveaux journaux). */
export function withBranch(built, branch) {
  const branches = [...(built.branches ?? []), branch];
  return { ...built, branches, or: combineBranches(branches) };
}

/** Filtres actifs en clair, pour l'en-tête de l'export. */
export function describeFilters(filters = {}, { kioskLabel, eventLabel, eventId = null } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const parts = [];
  if (f.kiosk !== 'all') parts.push(`Borne ${kioskLabel ?? f.kiosk}`);
  const event = eventId || f.event;
  if (event === 'none') parts.push('Sans événement');
  else if (event !== 'all') parts.push(`Événement ${eventLabel ?? event}`);
  if (f.session) parts.push(sessionLabel(f.session));
  if (f.period !== 'all') parts.push(`Période ${PERIODS.find((p) => p.id === f.period)?.label ?? f.period}`);
  if (f.group !== 'all') parts.push(`Type ${CONTEXT_GROUPS.find((g) => g.id === f.group)?.label ?? f.group}`);
  if (f.level !== 'all') parts.push(`Niveau ${LEVELS[f.level]?.label ?? f.level}`);
  const search = cleanSearch(f.search);
  if (search) parts.push(`Recherche « ${search} »`);
  return parts.length ? parts.join(' · ') : 'aucun';
}

// ── Tri, curseur et fusion ──────────────────────────────────────────────────────────────────

/** Instant en microsecondes (Postgres en garde 6 chiffres, Date.parse 3). */
export function timeMicros(iso) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return -Infinity;
  const frac = /\.(\d+)/.exec(String(iso))?.[1] ?? '';
  return ms * 1000 + Number(frac.padEnd(6, '0').slice(3, 6));
}

/** Ordre du panneau : plus récent d'abord (occurred_at), puis id décroissant, comme la requête. */
export function compareLogs(a, b) {
  const d = timeMicros(b.occurred_at) - timeMicros(a.occurred_at);
  if (d !== 0) return d > 0 ? 1 : -1;
  return a.id === b.id ? 0 : (a.id < b.id ? 1 : -1);
}

/** Curseur de la page suivante : le dernier journal de la page. */
export function logCursor(page) {
  const last = page?.[page.length - 1];
  return last ? { occurred_at: last.occurred_at, id: last.id } : null;
}

/** Condition « plus ancien que le curseur » (même ordre que la requête). */
export function cursorBranch(cursor) {
  const t = pgQuote(cursor.occurred_at);
  return `or(occurred_at.lt.${t},and(occurred_at.eq.${t},id.lt.${pgQuote(cursor.id)}))`;
}

/** Plus grande date de réception chargée : point de départ des nouveaux journaux. */
export function latestCreatedAt(logs) {
  let best = null;
  for (const l of logs) if (l.created_at && (best == null || timeMicros(l.created_at) > timeMicros(best))) best = l.created_at;
  return best;
}

/**
 * Fusionne des journaux reçus (temps réel, relecture) dans la liste : sans doublon, triés. Tant
 * qu'il reste des pages (`hasMore`), un journal plus ancien que le curseur est laissé à « Voir
 * plus » (sinon il apparaîtrait deux fois ou dans le désordre).
 */
export function mergeLogs(existing, incoming, { cursor = null, hasMore = false } = {}) {
  const byId = new Map(existing.map((l) => [l.id, l]));
  for (const l of incoming) {
    if (hasMore && cursor && compareLogs(l, cursor) > 0) continue;
    byId.set(l.id, l);
  }
  return [...byId.values()].sort(compareLogs);
}

// ── Événement, séance, dates ────────────────────────────────────────────────────────────────

export const EVENT_OTHER_ORG = "Événement d'une autre organisation";
export const EVENT_DELETED = 'Événement supprimé';
export const EVENT_HIDDEN = "Événement d'une autre organisation ou supprimé";

/**
 * Nom de l'événement d'un journal. `events` : { [id]: { state, name, client_name } } avec
 * state 'visible' | 'other_org' | 'deleted' | 'hidden' (RPC absente : nom illisible, cause inconnue).
 * Null : pas d'événement, ou pas encore lu.
 */
export function eventLabel(eventId, events = {}) {
  if (!eventId) return null;
  const e = events[eventId];
  if (!e) return null;
  if (e.state === 'deleted') return EVENT_DELETED;
  if (e.state === 'other_org') return EVENT_OTHER_ORG;
  if (e.state === 'hidden') return EVENT_HIDDEN;
  return (e.name || '').trim() || (e.client_name || '').trim() || 'Événement sans nom';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Paramètre `?event=` de la page Kiosks (lien des alertes « Erreurs sur la borne », LAB-329) :
 * l'id en minuscules, ou null s'il n'a pas la forme d'un uuid.
 */
export function parseEventParam(value) {
  const v = String(value ?? '').trim();
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * L'événement du lien est-il connu ? Oui si `kiosk_log_events` l'a renvoyé (un journal lisible le
 * cite) ; la lecture de secours (RPC absente) ne connaît que les événements lisibles.
 */
export function acceptLinkedEvent(eventId, found = {}) {
  const e = eventId ? found[eventId] : null;
  return Boolean(e && e.state !== 'hidden');
}

/** « séance 3f2a ». */
export function sessionLabel(sessionId) {
  return sessionId ? `séance ${String(sessionId).slice(0, 4)}` : null;
}

/** Ids d'événements à lire : ceux des journaux chargés qui ne sont pas encore connus. */
export function missingEventIds(logs, events = {}) {
  return [...new Set(logs.map((l) => l.event_id).filter((id) => id && !events[id]))];
}

/**
 * Choix du filtre « Événement » : événements vus dans les journaux puis événements récents de
 * l'organisation, sans doublon. `recent` : [{ id, name, client_name, start_date }].
 */
export function eventOptions(logs = [], events = {}, recent = []) {
  const options = [];
  const seen = new Set();
  for (const id of logs.map((l) => l.event_id)) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ value: id, label: eventLabel(id, events) ?? `Événement ${id.slice(0, 8)}` });
  }
  for (const e of recent) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    options.push({ value: e.id, label: eventLabel(e.id, { [e.id]: { state: 'visible', ...e } }) });
  }
  return options;
}

const exactFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** « 15/11/2026 14:03:27 » (heure de Paris). */
export function formatExactTime(iso) {
  const t = toMs(iso);
  return t == null ? '' : exactFormat.format(new Date(t)).replace(',', '');
}

/** « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 j ». */
export function timeAgo(iso, now = Date.now()) {
  const t = toMs(iso);
  if (t == null) return '';
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

// ── Regroupement ────────────────────────────────────────────────────────────────────────────

/**
 * Journaux consécutifs identiques (même PC, niveau, contexte et message) réunis en une entrée :
 * { key, log (le plus récent), logs, count, first, last }. `logs` doit être trié (compareLogs).
 */
export function groupLogs(logs) {
  const groups = [];
  for (const log of logs) {
    const prev = groups[groups.length - 1];
    if (prev && sameEntry(prev.log, log)) {
      prev.logs.push(log);
      prev.count += 1;
      prev.first = log.occurred_at;
      continue;
    }
    groups.push({ key: log.id, log, logs: [log], count: 1, first: log.occurred_at, last: log.occurred_at });
  }
  return groups;
}

/**
 * Journaux d'un événement rangés par séance (fiche de l'événement, LAB-328) :
 * [{ key, sessionId, logs, groups, count, errors, warnings, first, last, machineIds }], séance la
 * plus récente d'abord ; les journaux sans séance forment un groupe `sessionId: null`. Dans chaque
 * séance, les journaux identiques à la suite sont réunis (groupLogs).
 */
export function groupBySession(logs) {
  const bySession = new Map();
  for (const log of [...logs].sort(compareLogs)) {
    const key = log.session_id ?? 'none';
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(log);
  }
  return [...bySession.entries()].map(([key, list]) => ({
    key,
    sessionId: key === 'none' ? null : key,
    logs: list,
    groups: groupLogs(list),
    count: list.length,
    errors: list.filter((l) => l.level === 'error').length,
    warnings: list.filter((l) => l.level === 'warning').length,
    first: list[list.length - 1].occurred_at,
    last: list[0].occurred_at,
    machineIds: [...new Set(list.map((l) => l.machine_id))],
  })).sort((a, b) => compareLogs({ occurred_at: a.last, id: a.key }, { occurred_at: b.last, id: b.key }));
}

const dayFormat = new Intl.DateTimeFormat('fr-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** « 15/11/2026 14:03:27 → 14:05:10 » (même jour à Paris), sinon les deux dates entières. */
export function formatTimeRange(first, last) {
  const a = toMs(first);
  const b = toMs(last);
  if (a == null || b == null) return formatExactTime(first ?? last);
  if (a === b) return formatExactTime(first);
  if (dayFormat.format(new Date(a)) === dayFormat.format(new Date(b))) {
    return `${formatExactTime(first)} → ${timeFormat.format(new Date(b))}`;
  }
  return `${formatExactTime(first)} → ${formatExactTime(last)}`;
}

/** « 3 erreurs », « 1 alerte », « 0 journal »… */
export function countText(n, word) {
  return countLabel(n, word, word === 'journal' ? 'journaux' : undefined);
}

/**
 * Ligne de résumé de la section repliée (fiche de l'événement) :
 * « 3 erreurs · 1 alerte · 1 borne · 42 journaux · dernière activité il y a 2 j ».
 * `summary` : résultat de fetchEventKioskLogSummary.
 */
export function eventLogsSummaryText(summary, now = Date.now()) {
  if (!summary || summary.total === 0) return 'Aucun journal reçu pour cet événement';
  const parts = [];
  if (summary.errors) parts.push(countText(summary.errors, 'erreur'));
  if (summary.warnings) parts.push(countText(summary.warnings, 'alerte'));
  if (!summary.errors && !summary.warnings) parts.push('Aucune erreur');
  const machines = summary.machines?.length ?? 0;
  if (machines) parts.push(countText(machines, 'borne'));
  parts.push(countText(summary.total, 'journal'));
  if (summary.last) parts.push(`dernière activité ${timeAgo(summary.last, now)}`);
  return parts.join(' · ');
}

function sameEntry(a, b) {
  return a.machine_id === b.machine_id && a.level === b.level
    && (a.context ?? '') === (b.context ?? '') && (a.message ?? '') === (b.message ?? '');
}

// ── Messages clairs ─────────────────────────────────────────────────────────────────────────

// Codes EDSDK (EDSDKErrors.h du kit Canon) : phrase claire et quoi faire.
const CAMERA_RESTART = "Éteignez puis rallumez l'appareil photo, vérifiez le câble USB, puis redémarrez l'application de la borne.";
const EDSDK_ERRORS = {
  0x02: { title: "Erreur interne du pilote de l'appareil photo.", advice: CAMERA_RESTART },
  0x07: { title: "L'appareil photo ne prend pas en charge ce réglage.", advice: "Vérifiez que l'appareil est un modèle pris en charge et qu'il est en mode photo (pas vidéo). Sans effet sur les photos si l'erreur ne se répète pas." },
  0x2A: { title: 'Le disque du PC est plein : la photo ne peut pas être enregistrée.', advice: "Libérez de la place sur le PC (carte « Nettoyage du PC » dans l'admin de la borne), puis reprenez." },
  0x80: { title: "L'appareil photo n'est pas détecté.", advice: "Vérifiez qu'il est allumé et branché en USB au PC, puis redémarrez l'application de la borne." },
  0x81: { title: "L'appareil photo est occupé.", advice: "Attendez quelques secondes. Si cela se répète, éteignez puis rallumez l'appareil." },
  0x84: { title: "La mémoire de l'appareil photo est pleine.", advice: "Éteignez puis rallumez l'appareil photo. Vérifiez la carte mémoire si l'appareil en a une." },
  0x87: { title: "L'appareil photo n'a pas de carte mémoire.", advice: "Insérez une carte mémoire dans l'appareil, ou réglez-le pour qu'il fonctionne sans carte." },
  0x88: { title: "La carte mémoire de l'appareil photo est en erreur.", advice: "Remplacez ou formatez la carte mémoire de l'appareil, puis rallumez-le." },
  0xC0: { title: "Le port de l'appareil photo est déjà utilisé par un autre logiciel.", advice: "Fermez les logiciels Canon (EOS Utility…) ouverts sur le PC, puis redémarrez l'application de la borne." },
  0xC1: { title: "L'appareil photo s'est déconnecté.", advice: CAMERA_RESTART },
  0xC4: { title: "Erreur du bus USB entre le PC et l'appareil photo.", advice: "Changez de câble ou de port USB (évitez les rallonges et les hubs), puis redémarrez l'application de la borne." },
  0xF4: { title: "L'appareil photo n'a pas répondu à temps.", advice: CAMERA_RESTART },
  0x2003: { title: "La liaison avec l'appareil photo n'est pas ouverte.", advice: CAMERA_RESTART },
  0x2019: { title: "L'appareil photo est occupé.", advice: "Attendez quelques secondes. Si cela se répète, éteignez puis rallumez l'appareil." },
  0x200A: { title: "L'appareil photo ne prend pas en charge ce réglage.", advice: "Vérifiez que l'appareil est un modèle pris en charge et qu'il est en mode photo (pas vidéo)." },
  0xA005: { title: "L'appareil photo a refusé l'opération.", advice: "Vérifiez que la molette est sur un mode photo et qu'aucun menu n'est ouvert sur l'appareil." },
  0xA006: { title: "Le cache de l'objectif est fermé.", advice: "Retirez le cache de l'objectif." },
  0xA101: { title: "La batterie de l'appareil photo est faible.", advice: "Branchez l'alimentation secteur de l'appareil ou changez la batterie." },
  0xA102: { title: "L'appareil photo n'est pas prêt.", advice: "Attendez quelques secondes. Si cela se répète, éteignez puis rallumez l'appareil." },
  0x8D01: { title: "L'appareil photo n'a pas réussi à faire la mise au point.", advice: "Vérifiez la lumière et qu'aucun objet ne gêne l'objectif ; au besoin, passez l'objectif en mise au point manuelle." },
  0x8D06: { title: "L'appareil photo n'a pas de carte mémoire.", advice: "Insérez une carte mémoire dans l'appareil, ou réglez-le pour qu'il fonctionne sans carte." },
  0x8D07: { title: "La carte mémoire de l'appareil photo est en erreur.", advice: "Remplacez ou formatez la carte mémoire de l'appareil, puis rallumez-le." },
  0x8D08: { title: "La carte mémoire de l'appareil photo est protégée en écriture.", advice: "Déverrouillez la carte mémoire (petit taquet sur le côté)." },
  0x8D0A: { title: "Le flash de l'appareil photo n'est pas encore chargé.", advice: "Attendez quelques secondes entre deux photos ; vérifiez la batterie ou l'alimentation du flash." },
  0x8D0B: { title: "Aucun objectif n'est monté sur l'appareil photo.", advice: "Montez l'objectif, puis rallumez l'appareil." },
  0x8D0E: { title: "L'appareil photo est en mode vidéo.", advice: "Passez l'appareil en mode photo." },
  0x8D0F: { title: "L'objectif est rétracté.", advice: "Déployez l'objectif (bague de l'objectif rétractable), puis rallumez l'appareil." },
};

const CAMERA_CONTEXTS = ['camera', 'camera-evf', 'camera-evt', 'capture'];

/**
 * Code d'erreur EDSDK d'un message de la borne : « EDSDK error in …: 0x00000080 », « … refusé
 * (0xA005) », « Échec de l'ordre de capture : 0x8D01 », « EdsDownloadComplete a renvoyé 0x2 »,
 * « dernier code 0x81 ». Null sinon (« ObjectEvent 0x… » est un événement, pas une erreur).
 */
export function edsdkErrorCode(message) {
  const m = String(message ?? '');
  const match = /EDSDK error in [^\n]*?: 0x([0-9A-F]+)/i.exec(m)
    ?? /\(0x([0-9A-F]+)\)[^(]*$/i.exec(m)
    ?? /(?:capture|renvoyé|dernier code)\s*:?\s*0x([0-9A-F]+)/i.exec(m);
  return match ? parseInt(match[1], 16) : null;
}

const hex = (code) => `0x${code.toString(16).toUpperCase()}`;

const ADDRESS_ADVICE = "Dans l'admin de la borne, vérifiez la carte « Adresse du SaaS » (ou associez à nouveau la borne), puis redémarrez l'application. Si l'erreur continue, installez la dernière version de la borne.";
const NETWORK_ADVICE = "Vérifiez le Wi-Fi ou le câble réseau du PC. Rien n'est perdu : la borne garde les photos et les journaux et les renvoie quand la connexion revient.";

// Règles dans l'ordre : la première qui reconnaît le message l'emporte. Messages relevés dans le
// code de la borne et dans les journaux reçus (dev).
const KNOWN_ERRORS = [
  {
    id: 'missing-key',
    test: /No API key found|Invalid API key|UNAUTHORIZED_INVALID_JWT_FORMAT|Auth header is not 'Bearer|Clé API Supabase invalide/i,
    title: "La borne n'envoie pas de clé d'accès valide au serveur : rien ne se synchronise.",
    advice: ADDRESS_ADVICE,
  },
  {
    id: 'license',
    test: /licence kiosk invalide|Licence refusée|licence (?:inactive|retirée)|\b42501\b/i,
    title: "Le serveur refuse la licence de cette borne (retirée, désactivée ou PC remplacé).",
    advice: "Vérifiez la borne dans la page « Mes bornes » ; au besoin, associez à nouveau le PC depuis l'écran d'association de la borne.",
  },
  {
    id: 'unauthorized',
    test: /\b401\b|Unauthorized/i,
    title: "Le serveur a refusé la demande de la borne (accès non autorisé).",
    advice: ADDRESS_ADVICE,
  },
  {
    id: 'saas-address',
    test: /invalid request URI was provided|BaseAddress must be set|Adresse du SaaS incomplète/i,
    title: "L'adresse du serveur n'est pas réglée sur la borne.",
    advice: "Dans l'admin de la borne, saisissez l'adresse du SaaS (carte « Adresse du SaaS »), puis redémarrez l'application.",
  },
  {
    id: 'rate-limit',
    test: /\b429\b|PT429|Too Many Requests|Trop de demandes|trop de journaux/i,
    title: 'La borne envoie trop de demandes : le serveur la fait patienter.',
    advice: "Rien à faire si cela reste ponctuel : la borne réessaie toute seule. Si cela dure, une boucle d'erreurs tourne sur la borne : redémarrez l'application.",
  },
  {
    id: 'network',
    test: /No such host|Hôte inconnu|Name or service not known|connection attempt failed|tentative de connexion a échoué|actively refused|Aucune connexion n'a pu être établie|error occurred while sending the request|erreur s'est produite lors de l'envoi de la demande|HttpClient\.Timeout|SSL connection could not be established|connexion SSL|forcibly closed|connexion existante a dû être fermée|Network is unreachable|réseau est inaccessible|Connexion impossible/i,
    title: "La borne n'arrive pas à joindre le serveur (pas de connexion Internet ou réseau instable).",
    advice: NETWORK_ADVICE,
  },
  {
    id: 'server-error',
    test: /\b50[0-4]\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i,
    title: 'Le serveur a rencontré une erreur passagère.',
    advice: "La borne réessaie toute seule. Si l'erreur dure plus d'une heure, vérifiez l'état du service (Supabase) et prévenez le support.",
  },
  {
    id: 'camera-missing',
    test: /Aucun appareil Canon détecté|Appareil photo (?:éteint ou débranché|non détecté|non connecté)|appareil photo s'est éteint ou a été débranché/i,
    title: "L'appareil photo n'est pas détecté par la borne.",
    advice: "Vérifiez qu'il est allumé, chargé (ou sur secteur) et branché en USB au PC. La borne le recherche toute seule ; sinon, redémarrez l'application.",
  },
  {
    id: 'camera-timeout',
    test: /caméra n'a pas répondu|appareil photo n'a pas répondu|Live view toujours indisponible/i,
    title: "L'appareil photo n'a pas répondu à temps.",
    advice: CAMERA_RESTART,
  },
  {
    id: 'compositing',
    test: /Échec du compositing|Impossible de lire la photo/i,
    title: "La borne n'a pas pu monter la photo dans le cadre.",
    advice: "Vérifiez l'espace libre sur le PC et que le cadre photo de l'événement est bien synchronisé. Si cela se répète, redémarrez l'application.",
  },
  {
    id: 'printer-not-responding',
    test: /imprimante ne répond pas/i,
    title: "L'imprimante ne répond pas.",
    advice: "Vérifiez qu'elle est allumée, qu'il reste du papier et du ruban, et que le câble USB est branché. Le voyant de l'imprimante indique la cause.",
  },
  {
    id: 'printer-missing',
    test: /Imprimante .{0,80}introuvable|imprimante n'est pas (?:installée|disponible)/i,
    title: "L'imprimante choisie sur la borne est introuvable sous Windows.",
    advice: "Allumez l'imprimante et vérifiez son câble, puis choisissez-la à nouveau dans l'admin de la borne (carte « Imprimante »).",
  },
  {
    id: 'paper-missing',
    test: /Papier .{0,40}introuvable/i,
    title: "Le format de papier demandé n'existe pas sur l'imprimante.",
    advice: "Vérifiez que le pilote de l'imprimante est installé et que le rouleau correspond au format du cadre (10×15 ou bande).",
  },
  {
    id: 'print-busy',
    test: /impression est encore en cours/i,
    title: 'Une impression était encore en cours.',
    advice: "Rien à faire : l'invité doit patienter quelques secondes avant de relancer.",
  },
  {
    id: 'composite-missing',
    test: /composite introuvable/i,
    title: "Le tirage monté n'a pas été retrouvé sur le PC.",
    advice: "Souvent après un nettoyage du PC ou un redémarrage pendant une séance : rien à faire si cela reste isolé. Sinon, vérifiez l'espace libre sur le PC.",
  },
  {
    id: 'disk-full',
    test: /disk full|not enough space on the disk|pas assez d'espace sur le disque|espace disque insuffisant/i,
    title: 'Le disque du PC est plein.',
    advice: "Libérez de la place (carte « Nettoyage du PC » dans l'admin de la borne), puis redémarrez l'application.",
  },
  {
    id: 'windows-resources',
    test: /Quota insuffisant|Not enough quota|OutOfMemory|Insufficient memory|mémoire insuffisante/i,
    title: 'Windows manque de ressources (mémoire ou quota système épuisé).',
    advice: "Redémarrez l'application de la borne ; si l'erreur revient, redémarrez le PC. Prévenez le support si cela arrive pendant un événement.",
  },
  {
    id: 'no-design',
    test: /SANS design approuvé/i,
    title: "L'événement est chargé sans modèle photo validé : les photos sortiront sans cadre.",
    advice: "Validez le cadre photo du client dans la fiche de l'événement (onglet Création du client) ; la borne le récupère à la synchro suivante.",
  },
  {
    id: 'event-code',
    test: /Code événement introuvable/i,
    title: "Le code saisi sur la borne ne correspond à aucun événement.",
    advice: "Vérifiez le code dans la fiche de l'événement (il est en majuscules), ou envoyez l'événement à la borne depuis « Mes bornes ».",
  },
];

/**
 * Message clair d'un journal connu : { id, title, advice }, ou null. Les codes EDSDK ne sont lus
 * que dans les alertes et erreurs des contextes caméra.
 */
export function explainLog(log) {
  const message = String(log?.message ?? '');
  if (!message) return null;
  for (const rule of KNOWN_ERRORS) {
    if (rule.test.test(message)) return { id: rule.id, title: rule.title, advice: rule.advice };
  }
  if ((log.level === 'error' || log.level === 'warning') && CAMERA_CONTEXTS.includes(log.context)) {
    const code = edsdkErrorCode(message);
    if (code != null) {
      const known = EDSDK_ERRORS[code];
      if (known) return { id: `edsdk-${hex(code)}`, ...known, title: `${known.title} (code ${hex(code)})` };
      return {
        id: 'edsdk-unknown',
        title: `L'appareil photo a renvoyé une erreur (code ${hex(code)}).`,
        advice: `Si l'erreur se répète : ${CAMERA_RESTART.charAt(0).toLowerCase()}${CAMERA_RESTART.slice(1)}`,
      };
    }
  }
  return null;
}

// ── Export texte ────────────────────────────────────────────────────────────────────────────

/**
 * Export lisible des journaux filtrés (support). `resolve(log)` → { kiosk, event } textes.
 * Une entrée par groupe de journaux identiques, plus récent d'abord.
 */
export function buildLogsText(logs, {
  resolve, filtersText = 'aucun', now = Date.now(), truncated = false, title = 'Journaux des bornes',
} = {}) {
  const groups = groupLogs([...logs].sort(compareLogs));
  const lines = [
    title,
    `Exporté le ${formatExactTime(new Date(now).toISOString())} (heure de Paris)`,
    `Filtres : ${filtersText}`,
    `${logs.length} journa${logs.length > 1 ? 'ux' : 'l'}, ${groups.length} entrée${groups.length > 1 ? 's' : ''}`
      + (truncated ? ` (limité aux ${logs.length} plus récents)` : ''),
    '',
  ];
  for (const g of groups) {
    const log = g.log;
    const r = resolve ? resolve(log) : {};
    const head = [
      LEVELS[log.level]?.label.toUpperCase() ?? String(log.level ?? '').toUpperCase(),
      r.kiosk || log.machine_id,
      r.event || null,
      sessionLabel(log.session_id),
      log.context || null,
      log.app_version ? `v${log.app_version}` : null,
    ].filter(Boolean).join(' · ');
    lines.push(`[${formatExactTime(log.occurred_at)}] ${head}`);
    if (g.count > 1) lines.push(`  ×${g.count}, du ${formatExactTime(g.first)} au ${formatExactTime(g.last)}`);
    const clear = explainLog(log);
    if (clear) {
      lines.push(`  En clair : ${clear.title}`);
      lines.push(`  Que faire : ${clear.advice}`);
    }
    lines.push(`  Message : ${String(log.message ?? '').replace(/\r?\n/g, '\n    ')}`);
    if (log.stack_trace) {
      lines.push('  Trace :');
      for (const t of String(log.stack_trace).split(/\r?\n/)) lines.push(`    ${t}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * « journaux-bornes-2026-11-15.txt » ; avec un événement (fiche de l'événement, LAB-328) :
 * « journaux-borne-mariage-clarisse-hugo-2026-11-15.txt ».
 */
export function logsFileName(now = Date.now(), { eventName = null } = {}) {
  const d = dayFormat.format(new Date(now));
  const slug = String(eventName ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return slug ? `journaux-borne-${slug}-${d}.txt` : `journaux-bornes-${d}.txt`;
}
