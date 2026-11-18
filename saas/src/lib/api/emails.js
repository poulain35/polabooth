// Emails : renvoi du code, email de test, suivi des envois, livraison après l'événement.
import {
  EMAIL_LOG_COLUMNS, applyEmailLogPlan, bookingRefScope, emailLogQueryPlan, emailLogSelect, escapeLike,
} from '../emailTracking.js';
import { INSTALLED_MODULES } from '../../features/modules.js';
import { supabase } from './client.js';
import { callFunction } from './functions.js';

/** Renvoie l'email de code d'accès au client (admin uniquement). */
export function resendAccessEmail(eventId) {
  return callFunction('resend-access-email', { admin: true, json: { event_id: eventId }, fallback: 'Erreur lors de l\'envoi' });
}

/**
 * Resynchronise le suivi d'un email (remise, ouvertures, clics, rebonds) depuis Brevo (admin
 * uniquement). Retourne { email_log, events } : la ligne email_logs à jour. Les erreurs portent
 * `status` (422 sans message-id Brevo, 403 accès refusé, 429 quota de 20 / 10 min).
 */
export function syncEmailLog(emailLogId) {
  return callFunction('email-sync', {
    admin: true, json: { email_log_id: emailLogId }, fallback: 'Erreur lors de la synchronisation du suivi',
  });
}

// ── Email de test (mise en route, LAB-345) ───────────────────────────────────
// Envoyé à l'adresse du compte connecté seulement (administrateur de l'application), par le même
// chemin que les vrais emails. Réponse { ok, provider, to, message, hint? } : un refus du service
// d'envoi arrive en ok: false (200), seules les erreurs de droits ou de réseau lèvent.

export function sendTestEmail() {
  return callFunction('send-test-email', { admin: true, json: {}, fallback: 'Envoi de l\'email de test impossible' });
}

// ── Suivi des emails (LAB-124) ───────────────────────────────────────────────
// Lecture sous RLS (session admin) : aucun filtre d'organisation côté client, la policy de
// email_logs décide des lignes visibles.

// Jointures sur leads et prospects seulement si leur module privé est dans le build (LAB-274).
export { EMAIL_LOG_COLUMNS };
const EMAIL_LOG_SELECT = emailLogSelect(INSTALLED_MODULES);

/**
 * Page Emails : une page de email_logs (plus récents d'abord) filtrée côté serveur.
 * filters = { status, type, from, to, search, problemsOnly, page }. Retourne { rows, count }.
 */
export async function fetchEmailLogs(filters = {}) {
  const plan = emailLogQueryPlan(filters, { modules: INSTALLED_MODULES });
  if (plan.empty) return { rows: [], count: 0 };

  let refScope = null;
  if (plan.bookingRef) {
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, converted_event_id')
      .ilike('booking_number', `%${escapeLike(plan.bookingRef)}%`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (leadsErr) throw leadsErr;
    refScope = bookingRefScope(leads);
    if (!refScope.leadIds.length) return { rows: [], count: 0 };
  }

  const query = supabase.from('email_logs').select(EMAIL_LOG_SELECT, { count: 'exact' });
  const { data, count, error } = await applyEmailLogPlan(query, plan, refScope);
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

/** Un email avec son lead ou son événement. */
export async function getEmailLog(emailLogId) {
  const { data, error } = await supabase
    .from('email_logs')
    .select(EMAIL_LOG_SELECT)
    .eq('id', emailLogId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Historique Brevo d'un email (email_events), du plus ancien au plus récent. */
export async function getEmailEvents(emailLogId) {
  const { data, error } = await supabase
    .from('email_events')
    .select('id, event, occurred_at, reason, link')
    .eq('email_log_id', emailLogId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getEmailLogs(eventId) {
  const { data, error } = await supabase
    .from('email_logs')
    .select(EMAIL_LOG_COLUMNS)
    .eq('event_id', eventId)
    .order('sent_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

// ── Livraison post-événement (LAB-10) ────────────────────────────────────────

/** Envoie l'email de livraison unifié (photos + audio + avis + facture) pour un événement (admin). */
export function sendDeliveryEmailForEvent(eventId) {
  return callFunction('send-delivery', {
    admin: true, json: { event_id: eventId }, fallback: 'Erreur lors de l\'envoi de la livraison',
  });
}
