// Bilan client d'un événement.
import { supabase } from './client.js';
import { callFunction } from './functions.js';

// ── Bilan client (LAB-233) ───────────────────────────────────────────────────
// Chiffres calculés et figés côté serveur (build_event_report) ; le gel passe par l'envoi.

/** Prépare ou actualise le brouillon : `{ report, metrics, kiosks, blockers, default_for, proposed }`. */
export async function buildEventReport(eventId) {
  const { data, error } = await supabase.rpc('build_event_report', { p_event_id: eventId });
  if (error) throw error;
  return data;
}

/** Photos du bilan (6 au plus), dans l'ordre d'affichage. */
export async function updateEventReportSelection(eventId, photoIds) {
  const { data, error } = await supabase
    .from('event_reports')
    .update({ selected_photo_ids: photoIds })
    .eq('event_id', eventId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Bilan introuvable');
}

/** Lien du bilan coupé ; un nouvel envoi crée un nouveau lien. */
export async function revokeEventReport(eventId) {
  const { data, error } = await supabase
    .from('event_reports')
    .update({ status: 'revoked' })
    .eq('event_id', eventId)
    .eq('status', 'sent')
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Aucun bilan envoyé à révoquer');
}

/** Ligne du bilan sans le recalculer (lecture seule) ; null si jamais préparé. */
export async function getEventReportRow(eventId) {
  const { data, error } = await supabase
    .from('event_reports')
    .select('id, token, status, frozen_at, sent_at, expires_at, selected_photo_ids')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Fige le bilan et l'envoie au client (edge function send-event-report, LAB-238).
 * `photoIds` : photos du bilan (6 au plus, dans l'ordre). L'erreur porte `code` et `blockers`.
 */
export function sendEventReport(eventId, photoIds) {
  return callFunction('send-event-report', {
    admin: true,
    json: { event_id: eventId, photo_ids: photoIds },
    fallback: 'Le bilan n’a pas pu être envoyé',
    errorFields: (data) => ({ blockers: Array.isArray(data?.blockers) ? data.blockers : [] }),
  });
}

/** Bilan public par jeton ; null si inconnu, révoqué ou expiré. */
export async function getEventReport(token) {
  const { data, error } = await supabase.rpc('get_event_report', { p_token: token });
  if (error) throw error;
  return data ?? null;
}
