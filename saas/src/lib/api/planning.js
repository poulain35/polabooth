// Planning des bornes et synchro Google Calendar.
import { supabase } from './client.js';
import { requestFunction } from './functions.js';

// ── Planning ──────────────────────────────────────────────────────────────────

export async function getPlanningData() {
  const [eventsRes, entriesRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, client_name, start_date, end_date, photobooth_id, kiosk_licenses!events_photobooth_id_fkey(id, label, color)')
      .not('start_date', 'is', null),
    supabase.from('planning_entries').select('*'),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (entriesRes.error) throw entriesRes.error;
  return { events: eventsRes.data ?? [], entries: entriesRes.data ?? [] };
}

export async function updateEventPhotobooth(eventId, photoboothId) {
  const { error } = await supabase
    .from('events')
    .update({ photobooth_id: photoboothId ?? null })
    .eq('id', eventId);
  if (error) throw error;
  syncEventToGoogleCalendar(eventId);
}

export async function createPlanningEntry({ title, startAt, endAt, color, notes, googleEventId, googleCalendarId }) {
  const { data, error } = await supabase
    .from('planning_entries')
    .insert({
      title,
      start_at: startAt,
      end_at: endAt,
      color,
      notes: notes || null,
      google_event_id: googleEventId ?? null,
      google_calendar_id: googleCalendarId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePlanningEntry(id, { title, startAt, endAt, color, notes, googleEventId, googleCalendarId }) {
  const patch = { title, start_at: startAt, end_at: endAt, color, notes: notes || null };
  if (googleEventId !== undefined) {
    patch.google_event_id    = googleEventId;
    patch.google_calendar_id = googleCalendarId ?? null;
  }
  const { error } = await supabase
    .from('planning_entries')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deletePlanningEntry(id) {
  const { error } = await supabase.from('planning_entries').delete().eq('id', id);
  if (error) throw error;
}

// ── Synchro Google Calendar (LAB-29) ──────────────────────────────────────────

/**
 * Pousse un événement vers Google Calendar (borne assignée + client + code dans la description).
 * Best-effort : ne lève jamais — la synchro ne doit pas bloquer l'UX. Reste inactive tant que
 * les secrets Google ne sont pas configurés côté Supabase (la fonction répond alors { skipped }).
 */
export async function syncEventToGoogleCalendar(eventId) {
  if (!eventId) return;
  try {
    // requestFunction : un refus est seulement signalé dans la console, jamais levé. Sans session,
    // l'erreur « Session expirée » part dans le catch (gcal-sync refusait déjà la clé anon).
    const { res, data } = await requestFunction('gcal-sync', { admin: true, json: { event_id: eventId } });
    if (!res.ok) console.warn('Synchro Google Calendar échouée', data.error ?? res.status);
  } catch (e) {
    console.warn('Synchro Google Calendar échouée', e);
  }
}
