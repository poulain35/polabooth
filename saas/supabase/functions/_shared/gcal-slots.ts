// Synchronisation d'un créneau vers Google Agenda (LAB-72, §5.9.5). Module sans Deno : le fetch
// est injecté, ce qui permet de le tester avec un faux Google (aucun appel réel).

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface SlotCalendarResult {
  action: 'created' | 'updated' | 'deleted' | 'none';
  gcalEventId: string | null;
}

/**
 * Crée, met à jour (PATCH, recréation si l'événement a été supprimé à la main) ou supprime
 * l'événement Google d'un créneau. `body` = buildSlotGcalEvent(...) ; `cancelled` → suppression.
 */
export async function syncSlotCalendar(p: {
  calendarId: string;
  accessToken: string;
  gcalEventId: string | null;
  cancelled: boolean;
  body: Record<string, unknown> | null;
  fetchImpl: FetchLike;
  apiBase?: string;
}): Promise<SlotCalendarResult> {
  const base = `${p.apiBase ?? 'https://www.googleapis.com/calendar/v3/calendars'}/${encodeURIComponent(p.calendarId)}/events`;
  const headers = { Authorization: `Bearer ${p.accessToken}`, 'Content-Type': 'application/json' };

  if (p.cancelled) {
    if (!p.gcalEventId) return { action: 'none', gcalEventId: null };
    const res = await p.fetchImpl(`${base}/${encodeURIComponent(p.gcalEventId)}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar a répondu ${res.status}.`);
    return { action: 'deleted', gcalEventId: null };
  }

  const payload = JSON.stringify(p.body ?? {});
  let res;
  let action: SlotCalendarResult['action'] = 'created';
  if (p.gcalEventId) {
    res = await p.fetchImpl(`${base}/${encodeURIComponent(p.gcalEventId)}`, { method: 'PATCH', headers, body: payload });
    action = 'updated';
    if (res.status === 404 || res.status === 410) {
      res = await p.fetchImpl(base, { method: 'POST', headers, body: payload });
      action = 'created';
    }
  } else {
    res = await p.fetchImpl(base, { method: 'POST', headers, body: payload });
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(data?.error?.message || `Google Calendar a répondu ${res.status}.`);
  return { action, gcalEventId: data.id ?? p.gcalEventId };
}
