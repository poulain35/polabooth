// Rappel « Contacts à exporter » (LAB-224) : les réponses au questionnaire de la borne sont
// supprimées 30 jours après l'événement. La date vient de guest_responses_summary().purge_at
// (SQL guest_responses_purge_at, seul endroit où la durée est écrite) : rien n'est recalculé ici.
import { formatParisDate } from './guestResponsesExport.js';

export const URGENT_DAYS = 7;

const PARIS = 'Europe/Paris';
const DAY_MS = 86_400_000;

function toTime(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

function parisDayIndex(date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Jours calendaires (heure de Paris) entre aujourd'hui et `iso` : 0 = aujourd'hui, négatif = passé. */
export function parisDaysUntil(iso, now = new Date()) {
  return parisDayIndex(new Date(iso)) - parisDayIndex(now);
}

/**
 * Rappel d'un événement, ou null s'il n'y a rien à faire. Affiché quand l'événement a des réponses,
 * qu'il est terminé (`end_date`, à défaut `start_date`, passée ; sans date, il l'est d'office car
 * la purge part alors de la première réponse) et qu'il n'a jamais été exporté ou a reçu des
 * réponses après le dernier export.
 */
export function guestExportReminder(summary, event, now = new Date()) {
  const count = Number(summary?.response_count ?? 0);
  if (!event || !(count > 0) || toTime(summary.purge_at) === null) return null;

  const end = toTime(event.end_date) ?? toTime(event.start_date);
  if (end !== null && end > now.getTime()) return null;

  const exportedAt = toTime(event.guest_responses_exported_at);
  const lastReceivedAt = toTime(summary.last_received_at);
  const newSinceExport = exportedAt !== null && lastReceivedAt !== null && lastReceivedAt > exportedAt;
  if (exportedAt !== null && !newSinceExport) return null;

  const daysLeft = parisDaysUntil(summary.purge_at, now);
  return {
    eventId: event.id,
    eventName: event.name || 'Événement sans nom',
    responseCount: count,
    purgeAt: summary.purge_at,
    purgeDate: formatParisDate(summary.purge_at),
    daysLeft,
    urgent: daysLeft < URGENT_DAYS,
    newSinceExport,
  };
}

/** Rappels de tous les événements, suppression la plus proche d'abord. */
export function guestExportReminders(summaries, events, now = new Date()) {
  const byId = new Map((events ?? []).map((e) => [e.id, e]));
  return (summaries ?? [])
    .map((s) => guestExportReminder(s, byId.get(s.event_id), now))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.purgeAt) - Date.parse(b.purgeAt));
}

/** « Contacts à exporter · 12 réponses · suppression à partir du 04/12/2026 » */
export function exportReminderDetail(reminder) {
  const n = reminder.responseCount;
  return `Contacts à exporter · ${n} réponse${n > 1 ? 's' : ''} · suppression à partir du ${reminder.purgeDate}`;
}

/** « {événement} · Contacts à exporter · … » */
export function exportReminderText(reminder) {
  return `${reminder.eventName} · ${exportReminderDetail(reminder)}`;
}

/** Libellé du badge : « Contacts », ou le délai quand la suppression est proche. */
export function exportReminderBadge(reminder) {
  if (!reminder.urgent) return 'Contacts';
  if (reminder.daysLeft <= 0) return 'Aujourd\'hui';
  if (reminder.daysLeft === 1) return 'Demain';
  return `J-${reminder.daysLeft}`;
}
