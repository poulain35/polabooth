// Réponses au questionnaire de la borne, rappels d'export et consentements photo.
import { guestSearchFilter } from '../guestResponsesExport.js';
import { guestExportReminders } from '../guestExportReminder.js';
import { supabase } from './client.js';

// ── Réponses au questionnaire de la borne (LAB-221) ──────────────────────────
// Lecture et suppression sous RLS (propriétaire de l'organisation) ; la borne écrit par RPC.

const GUEST_RESPONSE_COLUMNS =
  'id, event_id, machine_id, session_ids, answers, questions_snapshot, email, phone, marketing_consent, consent_text, answered_at, received_at';
const SUPABASE_PAGE = 1000;

async function selectAllPages(buildQuery) {
  const all = [];
  for (let from = 0; ; from += SUPABASE_PAGE) {
    const { data, error } = await buildQuery().range(from, from + SUPABASE_PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < SUPABASE_PAGE) return all;
  }
}

/** Page de réponses, plus récentes d'abord. `search` : e-mail ou téléphone (normalisé comme la borne). */
export async function getGuestResponses(eventId, { page = 1, pageSize = 20, search = '' } = {}) {
  let query = supabase
    .from('kiosk_guest_responses')
    .select(GUEST_RESPONSE_COLUMNS, { count: 'exact' })
    .eq('event_id', eventId);
  const filter = guestSearchFilter(search);
  if (filter) query = query.ilike(filter.column, filter.pattern);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order('answered_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export function getAllGuestResponses(eventId) {
  return selectAllPages(() => supabase
    .from('kiosk_guest_responses')
    .select(GUEST_RESPONSE_COLUMNS)
    .eq('event_id', eventId)
    .order('answered_at', { ascending: true })
    .order('id', { ascending: true }));
}

/** Compteurs et date de suppression (`guest_responses_summary`), d'un événement ou de tous. */
export async function getGuestResponsesSummary(eventId = null) {
  let query = supabase.rpc('guest_responses_summary');
  if (eventId) query = query.eq('event_id', eventId);
  const { data, error } = await query;
  if (error) throw error;
  return eventId ? (data?.[0] ?? null) : (data ?? []);
}

/** Photos kiosk de l'événement, pour relier les réponses à leur séance (storage_path). */
export function getGuestResponsePhotos(eventId) {
  return selectAllPages(() => supabase
    .from('photos')
    .select('id, storage_path')
    .eq('event_id', eventId)
    .eq('source', 'kiosk')
    .order('id', { ascending: true }));
}

export async function deleteGuestResponse(id) {
  const { data, error } = await supabase.from('kiosk_guest_responses').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Réponse introuvable ou déjà supprimée');
}

export async function deleteAllGuestResponses(eventId) {
  const { data, error } = await supabase.from('kiosk_guest_responses').delete().eq('event_id', eventId).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/** Rappels « Contacts à exporter » du tableau de bord (LAB-224), suppression la plus proche d'abord. */
export async function getGuestExportReminders() {
  const summaries = await getGuestResponsesSummary();
  if (!summaries.length) return [];
  const { data, error } = await supabase
    .from('events')
    .select('id, name, start_date, end_date, guest_responses_exported_at')
    .in('id', summaries.map((s) => s.event_id));
  if (error) throw error;
  return guestExportReminders(summaries, data ?? []);
}

/** `at` : début de l'export (avant la lecture des lignes), pour qu'une réponse arrivée pendant l'export rouvre le rappel. */
export async function markGuestResponsesExported(eventId, at = new Date()) {
  const { data, error } = await supabase
    .from('events')
    .update({ guest_responses_exported_at: at.toISOString() })
    .eq('id', eventId)
    .select('guest_responses_exported_at')
    .single();
  if (error) throw error;
  return data.guest_responses_exported_at;
}

// ── Consentements photo de la borne (LAB-226) ────────────────────────────────
// Lecture réservée aux administrateurs de l'application (RLS is_app_admin, LAB-223).

const PHOTO_CONSENT_COLUMNS = 'id, event_id, machine_id, session_id, consent_text, consented_at, received_at';

/** Page de consentements, plus récents d'abord. */
export async function getPhotoConsents(eventId, { page = 1, pageSize = 50 } = {}) {
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from('kiosk_photo_consents')
    .select(PHOTO_CONSENT_COLUMNS, { count: 'exact' })
    .eq('event_id', eventId)
    .order('consented_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export function getAllPhotoConsents(eventId) {
  return selectAllPages(() => supabase
    .from('kiosk_photo_consents')
    .select(PHOTO_CONSENT_COLUMNS)
    .eq('event_id', eventId)
    .order('consented_at', { ascending: true })
    .order('id', { ascending: true }));
}
