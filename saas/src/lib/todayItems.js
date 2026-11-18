// Page « Aujourd'hui » de l'admin (LAB-336, spec refonte-navigation-admin, lot 2). Module pur, testé
// dans todayItems.test.js.
//
// Liste « À faire » : une ligne = élément normalisé
//   { id, kind, label, urgency, title, context, date, href, actionLabel,
//     reason?, dismissKey?, dateLabel?, notificationId? }
// Les modules fournissent leurs éléments au même format (crochet `dashboard.items`). La liste est
// triée par urgence, puis par date de l'événement la plus proche, et rangée en trois groupes
// (groupTodayItems). Le titre dit qui (nom du client), la deuxième ligne pourquoi et quand
// (context + todayWhen). Une action reportée ou masquée (table today_dismissals, clé dismissKey =
// action + raison) sort de la liste (splitDismissed). Le badge du menu compte la même liste.

import { alertsTabHref } from './kioskAlerts.js';

/** Niveaux d'urgence, du plus urgent au moins urgent. */
const URGENCY = ['urgent', 'high', 'normal', 'low'];
const DEFAULT_URGENCY = 'normal';
const rankOf = (urgency) => {
  const i = URGENCY.indexOf(urgency);
  return i === -1 ? URGENCY.indexOf(DEFAULT_URGENCY) : i;
};

/** Étiquette affichée par sorte d'élément du code ouvert (un module donne la sienne dans `label`). */
export const KIND_LABELS = {
  alert: 'Borne',
  no_borne: 'Borne',
  design: 'Cadres',
  home_design: 'Écran d’accueil',
  guest_export: 'Contacts',
  setup: 'Mise en route',
};

/** Libellés des alertes des bornes (kiosk_alerts.alert_type). */
const ALERT_LABELS = {
  machine_offline: 'Borne hors ligne',
  printer_problem: 'Problème d’imprimante',
  camera_problem: 'Appareil photo débranché',
  print_quota_near: 'Quota d’impressions bientôt atteint',
  paper_low: 'Papier bientôt vide',
  kiosk_errors: 'Erreurs sur la borne',
};

const eventHref = (eventId, tab) => `/admin/events/${encodeURIComponent(eventId)}${tab ? `?tab=${tab}` : ''}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Paris' });
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const FULL_DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

const time = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};
const parisDay = (ms) => PARIS_DAY.format(new Date(ms));
const join = (parts) => parts.filter(Boolean).join(' · ');

/** « de Léa Martin », « d’Anne Roux », ou '' sans nom (titres des lignes). */
export function ofName(name) {
  const n = String(name ?? '').trim();
  if (!n) return '';
  return /^[aeiouyàâäéèêëîïôöûüAEIOUYÀÂÄÉÈÊËÎÏÔÖÛÜ]/.test(n) ? ` d’${n}` : ` de ${n}`;
}

/** Nombre de jours calendaires (Paris) de `now` à `iso` (négatif si passé), ou null. */
export function daysFromNow(iso, now = new Date()) {
  const t = time(iso);
  if (t == null) return null;
  return Math.round((Date.parse(parisDay(t)) - Date.parse(parisDay(now.getTime()))) / DAY_MS);
}

/** « Aujourd'hui », « Demain », « Hier » ou « sam. 21 nov. » (heure de Paris), ou ''. */
export function shortDateLabel(iso, now = new Date()) {
  const days = daysFromNow(iso, now);
  if (days == null) return '';
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  if (days === -1) return 'Hier';
  return SHORT_DATE.format(new Date(time(iso)));
}

/**
 * Échéance en clair : « aujourd’hui », « demain », « hier », « dans 6 jours », « il y a 3 jours »
 * (jusqu'à 14 jours), sinon « le sam. 14 juin 2027 ». '' sans date.
 */
export function whenLabel(iso, now = new Date()) {
  const days = daysFromNow(iso, now);
  if (days == null) return '';
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  if (days === -1) return 'hier';
  if (days > 1 && days <= 14) return `dans ${days} jours`;
  if (days < -1 && days >= -14) return `il y a ${-days} jours`;
  return `le ${FULL_DATE.format(new Date(time(iso)))}`;
}

/**
 * Fin de la deuxième ligne : « événement dans 6 jours », « suppression demain »… dateLabel de
 * l'élément (« événement » par défaut ; null ou '' : pas de date affichée).
 */
export function todayWhen(item, now = new Date()) {
  const label = item?.dateLabel === undefined ? 'événement' : item.dateLabel;
  if (!label) return '';
  const when = whenLabel(item.date, now);
  return when ? `${label} ${when}` : '';
}

/** « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 j ». */
export function timeAgo(iso, now = new Date()) {
  const t = time(iso);
  if (t == null) return '';
  const m = Math.floor((now.getTime() - t) / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/** Élément complété (urgence, étiquette par défaut), ou null s'il lui manque un titre ou une adresse. */
export function normalizeItem(item) {
  if (!item?.title || !item?.href) return null;
  const urgency = URGENCY.includes(item.urgency) ? item.urgency : DEFAULT_URGENCY;
  const id = String(item.id ?? `${item.kind}:${item.href}`);
  return {
    ...item,
    id,
    dismissKey: String(item.dismissKey ?? id),
    label: item.label ?? KIND_LABELS[item.kind] ?? '',
    urgency,
    context: item.context ?? '',
    date: item.date ?? null,
    actionLabel: item.actionLabel ?? 'Ouvrir',
  };
}

/** Tri : urgence, puis date la plus proche (sans date en dernier), puis titre. */
export function compareTodayItems(a, b) {
  const byUrgency = rankOf(a.urgency) - rankOf(b.urgency);
  if (byUrgency) return byUrgency;
  const ta = time(a.date);
  const tb = time(b.date);
  if (ta != null && tb != null && ta !== tb) return ta - tb;
  if ((ta == null) !== (tb == null)) return ta == null ? 1 : -1;
  return String(a.title).localeCompare(String(b.title), 'fr');
}

/** Éléments normalisés, sans doublon (même id), triés. */
export function sortTodayItems(items) {
  const seen = new Set();
  const out = [];
  for (const raw of items ?? []) {
    const item = normalizeItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.sort(compareTodayItems);
}

/**
 * Alertes ouvertes des bornes (kiosk_alerts, resolved_at null) : en tête de liste.
 * alerts : [{ id, alert_type, machine_id, sent_at, event_id, events: { name, start_date } }] ;
 * licenses : [{ machine_id, label }] pour nommer la borne.
 */
export function alertItems(alerts, licenses = [], now = new Date()) {
  const names = new Map((licenses ?? []).filter((l) => l?.machine_id).map((l) => [l.machine_id, l.label || l.machine_id]));
  return (alerts ?? []).filter((a) => a && !a.resolved_at).map((a) => ({
    id: `alert:${a.id}`,
    kind: 'alert',
    urgency: 'urgent',
    title: ALERT_LABELS[a.alert_type] ?? 'Alerte de la borne',
    dateLabel: null,
    context: join([
      a.machine_id ? names.get(a.machine_id) ?? a.machine_id : '',
      a.events?.name,
      a.sent_at ? `signalée ${timeAgo(a.sent_at, now)}` : '',
    ]),
    date: a.events?.start_date ?? null,
    href: alertsTabHref(a.id),
    actionLabel: 'Voir la borne',
  }));
}

/**
 * Cadres photo et écrans d'accueil soumis (client_designs, status 'submitted'), regroupés : une ligne
 * par événement pour ses cadres photo, une pour son écran d'accueil.
 * designs : [{ id, event_id, kind, submitted_at, events: { name, client_name, start_date } }].
 */
export function designItems(designs) {
  const groups = new Map();
  for (const d of designs ?? []) {
    if (!d?.event_id) continue;
    const kind = d.kind === 'home' ? 'home_design' : 'design';
    const key = `${kind}:${d.event_id}`;
    const group = groups.get(key) ?? { kind, eventId: d.event_id, event: d.events ?? null, count: 0 };
    group.count += 1;
    group.event = group.event ?? d.events ?? null;
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, g]) => ({
    id: key,
    kind: g.kind,
    urgency: 'normal',
    title: (g.kind === 'home_design'
      ? 'Valider l’écran d’accueil'
      : g.count > 1 ? `Valider les ${g.count} cadres photo` : 'Valider le cadre photo') + ofName(g.event?.client_name),
    context: join([g.kind === 'home_design' ? 'Écran envoyé par le client' : 'Envoyé par le client', g.event?.name]),
    date: g.event?.start_date ?? null,
    href: eventHref(g.eventId, 'creation'),
    actionLabel: 'Valider',
  }));
}

/** Événements des 7 prochains jours sans borne assignée. events : [{ id, name, client_name, start_date }]. */
export function noBorneItems(events) {
  return (events ?? []).filter((e) => e?.id).map((e) => ({
    id: `no_borne:${e.id}`,
    kind: 'no_borne',
    urgency: 'high',
    title: `Assigner une borne${e.client_name ? ` pour ${e.client_name}` : ''}`,
    context: join(['Aucune borne prévue', e.name]),
    date: e.start_date ?? null,
    href: eventHref(e.id, 'jour-j'),
    actionLabel: 'Assigner',
  }));
}

/** Contacts du questionnaire à exporter avant leur suppression (guestExportReminders). */
export function guestExportItems(reminders) {
  return (reminders ?? []).filter((r) => r?.eventId).map((r) => ({
    id: `guest_export:${r.eventId}`,
    kind: 'guest_export',
    urgency: r.urgent ? 'high' : 'low',
    title: 'Exporter les contacts des invités',
    context: join([
      `${r.responseCount} réponse${r.responseCount > 1 ? 's' : ''} au questionnaire`,
      r.eventName || 'Événement sans nom',
    ]),
    dateLabel: 'suppression',
    date: r.purgeAt ?? null,
    href: eventHref(r.eventId, 'livraison'),
    actionLabel: 'Exporter',
  }));
}

/**
 * Liste « À faire » complète, triée. Chaque source du code ouvert est gardée par sa fonctionnalité
 * (alertes : kiosk_alerts, cadres : client_design, contacts : guest_form) ; `moduleItems` est déjà
 * filtré par le module qui les fournit ; `setupItems` (étapes de la mise en route reportées quand la
 * carte est masquée, `setupTodayItems` de setupSteps.js) est ajouté tel quel.
 */
export function buildTodayItems(sources = {}, { isAvailable = () => true, now = new Date() } = {}) {
  const {
    alerts = [], licenses = [], designs = [], eventsWithoutBorne = [], guestReminders = [], moduleItems = [], setupItems = [],
  } = sources;
  return sortTodayItems([
    ...(isAvailable('kiosk_alerts') ? alertItems(alerts, licenses, now) : []),
    ...(isAvailable('client_design') ? designItems(designs) : []),
    ...noBorneItems(eventsWithoutBorne),
    ...(isAvailable('guest_form') ? guestExportItems(guestReminders) : []),
    ...(moduleItems ?? []),
    ...(setupItems ?? []),
  ]);
}

// ── Groupes et actions masquées ───────────────────────────────────────────────

/** Groupes de la liste, dans l'ordre d'affichage. */
const TODAY_GROUPS = [
  { key: 'urgent', title: 'Urgent' },
  { key: 'week', title: 'Cette semaine' },
  { key: 'later', title: 'Plus tard' },
];
const URGENT_DAYS = 3;
const WEEK_DAYS = 7;

/**
 * Groupe d'un élément : « urgent » (urgence urgent, ou échéance dans 3 jours au plus), « week »
 * (urgence haute, ou échéance dans 7 jours au plus), sinon « later ». Une échéance passée ne compte
 * pas (le solde après l'événement suit son urgence) ; une urgence basse n'est jamais urgente.
 */
export function todayGroupOf(item, now = new Date()) {
  if (item?.urgency === 'urgent') return 'urgent';
  const days = daysFromNow(item?.date, now);
  const upcoming = days != null && days >= 0;
  if (upcoming && days <= URGENT_DAYS && item?.urgency !== 'low') return 'urgent';
  if (item?.urgency === 'high' || (upcoming && days <= WEEK_DAYS)) return 'week';
  return 'later';
}

/** Éléments (déjà triés) rangés par groupe : [{ key, title, items }], sans groupe vide. */
export function groupTodayItems(items, now = new Date()) {
  const byKey = new Map(TODAY_GROUPS.map((g) => [g.key, { ...g, items: [] }]));
  for (const item of items ?? []) byKey.get(todayGroupOf(item, now)).items.push(item);
  return [...byKey.values()].filter((g) => g.items.length);
}

/** Date de retour d'une action reportée de `days` jours. */
export function snoozeUntil(days, now = new Date()) {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/**
 * Sépare les éléments affichés des éléments masqués. dismissals : lignes de today_dismissals
 * [{ item_key, until }] ; until null = masquée, until futur = reportée, until passé = revenue.
 * Renvoie { visible, hidden } ; chaque élément masqué porte `dismissedUntil` (null ou date).
 */
export function splitDismissed(items, dismissals, now = new Date()) {
  const active = new Map();
  for (const d of dismissals ?? []) {
    if (!d?.item_key) continue;
    if (d.until == null) active.set(d.item_key, null);
    else if ((time(d.until) ?? 0) > now.getTime()) active.set(d.item_key, d.until);
  }
  const visible = [];
  const hidden = [];
  for (const item of items ?? []) {
    const key = item.dismissKey ?? item.id;
    if (active.has(key)) hidden.push({ ...item, dismissedUntil: active.get(key) });
    else visible.push(item);
  }
  return { visible, hidden };
}

// ── « Cette semaine » ─────────────────────────────────────────────────────────

/** Événements de la semaine (en cours ou commençant dans les 7 jours) au format des lignes de la semaine. */
export function weekEventEntries(events, borneLabel = () => null) {
  return (events ?? []).filter((e) => e?.id && e.start_date).map((e) => ({
    id: `event:${e.id}`,
    kind: 'event',
    label: 'Événement',
    date: e.start_date,
    endDate: e.end_date ?? null,
    title: e.name || 'Événement sans nom',
    context: join([e.client_name, borneLabel(e.photobooth_id) ?? (e.photobooth_id ? '' : 'sans borne')]),
    href: eventHref(e.id),
  }));
}

/**
 * Lignes de « Cette semaine » (événements, et retraits et retours fournis par un module) rangées par
 * jour de Paris, sur 7 jours à partir d'aujourd'hui. Ce qui a commencé avant aujourd'hui et n'est pas
 * fini est rangé sous « En cours ». Renvoie [{ key, title, entries }], sans jour vide.
 */
export function weekAgenda(entries, now = new Date()) {
  const today = parisDay(now.getTime());
  const last = parisDay(now.getTime() + 6 * DAY_MS);
  const groups = new Map();
  const sorted = [...(entries ?? [])]
    .filter((e) => time(e?.date) != null)
    .sort((a, b) => time(a.date) - time(b.date));
  for (const entry of sorted) {
    const t = time(entry.date);
    let day = parisDay(t);
    if (day < today) {
      const end = time(entry.endDate);
      if (end == null || end < now.getTime()) continue;
      day = 'en-cours';
    }
    if (day !== 'en-cours' && day > last) continue;
    const group = groups.get(day) ?? { key: day, title: dayTitle(day, today, t), entries: [] };
    group.entries.push({ ...entry, time: day === 'en-cours' ? '' : PARIS_TIME.format(new Date(t)) });
    groups.set(day, group);
  }
  return [...groups.values()].sort((a, b) => (a.key === 'en-cours' ? -1 : b.key === 'en-cours' ? 1 : a.key.localeCompare(b.key)));
}

function dayTitle(day, today, t) {
  if (day === 'en-cours') return 'En cours';
  if (day === today) return 'Aujourd’hui';
  const tomorrow = parisDay(Date.parse(`${today}T12:00:00Z`) + DAY_MS);
  if (day === tomorrow) return 'Demain';
  const label = LONG_DAY.format(new Date(t));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ── Trois chiffres ────────────────────────────────────────────────────────────

/**
 * Trois chiffres sous la liste. Le module de réservation fournit « Signé ce mois » ; sans lui
 * (construction ouverte), le troisième chiffre est le nombre de photos du mois : jamais de montant.
 * moduleFigures : [{ id, label, value, sub? }].
 */
export function todayFigures({ moduleFigures = [], upcomingEvents = 0, printsThisMonth = 0, photosThisMonth = 0, month = '' } = {}) {
  const n = (v) => Number(v ?? 0).toLocaleString('fr-FR');
  const ofMonth = month ? ` en ${month}` : ' ce mois';
  const figures = [
    ...(moduleFigures ?? []).filter((f) => f?.label).slice(0, 1),
    { id: 'upcoming', label: 'Événements à venir', value: n(upcomingEvents), to: '/admin/events' },
    { id: 'prints', label: `Impressions${ofMonth}`, value: n(printsThisMonth) },
  ];
  if (figures.length < 3) figures.push({ id: 'photos', label: `Photos${ofMonth}`, value: n(photosThisMonth) });
  return figures;
}
