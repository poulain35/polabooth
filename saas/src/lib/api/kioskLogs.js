// Journaux des bornes (kiosk_logs).
import {
  LOG_COLUMNS, LOG_EXPORT_CHUNK, LOG_EXPORT_MAX, LOG_PAGE_SIZE, LOG_REFRESH_MAX, cursorBranch, logCursor,
  withBranch,
} from '../kioskLogs.js';
import { supabase } from './client.js';

// ── Journaux des bornes (LAB-327) ───────────────────────────────────────────────────────────
// Filtres construits par buildLogFilters (src/lib/kioskLogs.js) et appliqués côté serveur, pour que
// la pagination reste juste. Lecture limitée par la RLS kiosk_logs_select.

function applyLogFilters(q, built) {
  for (const [col, value] of built.eq) q = q.eq(col, value);
  for (const [col] of built.is) q = q.is(col, null);
  for (const [col, values] of built.in) q = q.in(col, values);
  for (const [col, value] of built.gte) q = q.gte(col, value);
  if (built.or) q = q.or(built.or);
  return q;
}

/**
 * Une page de journaux, plus récents d'abord (occurred_at puis id, pagination par curseur).
 * @returns {{ logs: object[], hasMore: boolean }}
 */
export async function fetchKioskLogsPage(built, { cursor = null, limit = LOG_PAGE_SIZE } = {}) {
  const filters = cursor ? withBranch(built, cursorBranch(cursor)) : built;
  const q = applyLogFilters(
    supabase.from('kiosk_logs').select(LOG_COLUMNS)
      .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1),
    filters);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  return { logs: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Journaux reçus depuis `since` (created_at, bornes comprises) qui passent les filtres : temps réel
 * et relecture périodique. `overflow` : plus de `limit` journaux, le panneau recharge tout.
 */
export async function fetchNewKioskLogs(built, since, { limit = LOG_REFRESH_MAX } = {}) {
  let q = supabase.from('kiosk_logs').select(LOG_COLUMNS)
    .order('created_at', { ascending: false }).limit(limit + 1);
  if (since) q = q.gte('created_at', since);
  const { data, error } = await applyLogFilters(q, built);
  if (error) throw error;
  const rows = data ?? [];
  return { logs: rows.slice(0, limit), overflow: rows.length > limit };
}

/** Journaux filtrés pour l'export texte, par tranches, `max` au plus. */
export async function fetchKioskLogsForExport(built, { max = LOG_EXPORT_MAX } = {}) {
  const all = [];
  let cursor = null;
  while (all.length < max) {
    const { logs, hasMore } = await fetchKioskLogsPage(built, { cursor, limit: Math.min(LOG_EXPORT_CHUNK, max - all.length) });
    all.push(...logs);
    if (!hasMore || logs.length === 0) return { logs: all, truncated: false };
    cursor = logCursor(logs);
  }
  return { logs: all, truncated: true };
}

/** Historique des PC des bornes (kiosk_license_machines, RLS : bornes du compte, tout pour le super-admin). */
export async function fetchKioskMachineHistory() {
  const { data, error } = await supabase.from('kiosk_license_machines')
    .select('license_id, machine_id, machine_name, associated_at, replaced_at')
    .order('associated_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Événements cités par des journaux : { [id]: { state, name, client_name, start_date } }.
 * RPC kiosk_log_events (événement à soi, d'une autre organisation ou supprimé) ; si elle manque,
 * lecture d'events (RLS) et state 'hidden' pour un nom illisible.
 */
export async function fetchKioskLogEvents(ids) {
  const list = [...new Set(ids)].filter(Boolean).slice(0, 200);
  if (list.length === 0) return {};
  const { data, error } = await supabase.rpc('kiosk_log_events', { p_event_ids: list });
  if (!error) {
    return Object.fromEntries((data ?? []).map((r) => [r.event_id,
      { state: r.state, name: r.name, client_name: r.client_name, start_date: r.start_date }]));
  }
  const { data: rows, error: evErr } = await supabase.from('events')
    .select('id, name, client_name, start_date').in('id', list);
  if (evErr) throw evErr;
  const found = new Map((rows ?? []).map((e) => [e.id, e]));
  return Object.fromEntries(list.map((id) => [id, found.has(id) ? { state: 'visible', ...found.get(id) } : { state: 'hidden' }]));
}

/** Événements récents du compte (filtre « Événement » du panneau des journaux). */
export async function fetchRecentEventsForLogs({ days = 120, limit = 100 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.from('events')
    .select('id, name, client_name, start_date')
    .gte('start_date', since).order('start_date', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Résumé des journaux d'un événement (fiche de l'événement, LAB-328), sans charger les journaux :
 * comptes par niveau (`head`), première et dernière activité (`occurred_at`), et les PC cités, lus un
 * à un dans l'ordre de machine_id (un événement n'a que quelques bornes). Même RLS que le panneau.
 * @returns {{ total, errors, warnings, first, last, machines: { machine_id, created_at }[] }}
 */
export async function fetchEventKioskLogSummary(eventId, { maxMachines = 20 } = {}) {
  const base = () => supabase.from('kiosk_logs');
  const count = (level) => {
    let q = base().select('id', { count: 'exact', head: true }).eq('event_id', eventId);
    if (level) q = q.eq('level', level);
    return q.then(({ count: n, error }) => { if (error) throw error; return n ?? 0; });
  };
  const edge = (ascending) => base().select('occurred_at').eq('event_id', eventId)
    .order('occurred_at', { ascending }).limit(1)
    .then(({ data, error }) => { if (error) throw error; return data?.[0]?.occurred_at ?? null; });
  const [total, errors, warnings, first, last] = await Promise.all([count(null), count('error'), count('warning'), edge(true), edge(false)]);

  const machines = [];
  while (total > 0 && machines.length < maxMachines) {
    let q = base().select('machine_id, created_at').eq('event_id', eventId)
      .order('machine_id', { ascending: true }).order('created_at', { ascending: false }).limit(1);
    if (machines.length) q = q.gt('machine_id', machines[machines.length - 1].machine_id);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    machines.push(data[0]);
  }
  return { total, errors, warnings, first, last, machines };
}

/** Supprime les journaux qui passent ces filtres (bouton « Purger » d'une borne). */
export async function deleteKioskLogs(built) {
  const { error } = await applyLogFilters(supabase.from('kiosk_logs').delete(), built);
  if (error) throw error;
}
