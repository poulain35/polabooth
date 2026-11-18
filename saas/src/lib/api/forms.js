// Formulaire pré-édition : configuration, envoi par le client et lecture des réponses.
import {
  FORM_UNKNOWN_EVENT_MESSAGE, NOT_KIOSK_CONSENT_FILTER, formSubmitErrorMessage, withoutKioskConsents,
} from '../formResponses.js';
import { supabase } from './client.js';

// ── Formulaire pré-édition ───────────────────────────────────────────────────

/** Vérifie si le formulaire pré-édition est activé pour un code d'accès. */
export async function getEventFormEnabled(code) {
  const { data, error } = await supabase.rpc('get_event_form_enabled', { p_code: code });
  if (error) return false;
  return data === true;
}

/** Config globale des questions (lisible par anon via RPC). */
export async function getGlobalFormConfig() {
  const { data, error } = await supabase.rpc('get_global_form_config');
  if (error) return null;
  return data; // { enabled, questions } ou null
}

/** Sauvegarde la config globale dans organizations (admin). */
export async function updateGlobalFormConfig(orgId, formConfig) {
  const { error } = await supabase
    .from('organizations')
    .update({ form_config: formConfig })
    .eq('id', orgId);
  if (error) throw error;
}

/** form_config d'un événement ({} s'il est vide), relu avant une écriture qui en change une partie. */
export async function readEventFormConfig(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('form_config')
    .eq('id', eventId)
    .single();
  if (error) throw error;
  return data?.form_config ?? {};
}

/** Active/désactive le formulaire pour un événement spécifique. */
export async function updateEventFormConfig(eventId, formConfig) {
  const { data, error } = await supabase
    .from('events')
    .update({ form_config: formConfig })
    .eq('id', eventId)
    .select('id, form_config')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Envoie les réponses du formulaire client par la RPC submit_form_response (LAB-277) : plus
 * d'INSERT direct. Code inconnu ou événement inactif : la RPC renvoie false, erreur claire.
 * Trop d'envois depuis la même adresse (PT429) : message dédié (formSubmitErrorMessage).
 */
export async function submitFormResponse({ code, answers }) {
  const { data, error } = await supabase.rpc('submit_form_response', { p_code: code, p_answers: answers });
  if (error) throw new Error(formSubmitErrorMessage(error));
  if (data !== true) throw new Error(FORM_UNKNOWN_EVENT_MESSAGE);
}

/** Réponses du client à un événement, sans les consentements photo de la borne (LAB-217). */
export async function getFormResponses(eventId) {
  const { data, error } = await supabase
    .from('event_form_responses')
    .select('*')
    .eq('event_id', eventId)
    .or(NOT_KIOSK_CONSENT_FILTER)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return withoutKioskConsents(data);
}

/** Toutes les réponses du formulaire, tous événements confondus (admin — stats globales), sans les consentements de la borne. */
export async function getAllFormResponses() {
  const { data, error } = await supabase
    .from('event_form_responses')
    .select('id, event_id, answers, submitted_at, events(name)')
    .or(NOT_KIOSK_CONSENT_FILTER)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return withoutKioskConsents(data);
}
