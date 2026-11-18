// Notifications et actions « À faire » reportées.
import { supabase } from './client.js';

// ── Pipeline commercial & notifications (LAB-28) ──────────────────────────────

/**
 * Notifications in-app (cloche admin). RLS scope déjà la lecture à l'org du owner.
 * Non lues d'abord, puis les plus récentes. Sans celles retirées par la croix de la cloche.
 */
export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, event_id, lead_id, type, title, payload, read_at, created_at, events(name, client_name)')
    .is('dismissed_at', null)
    .order('read_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Retire une notification de la cloche (croix) et la marque lue. Masquée, pas supprimée : les fonctions
 * serveur s'appuient sur les lignes existantes pour ne pas prévenir deux fois.
 */
export async function dismissNotification(notificationId, { unread = false } = {}) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notifications')
    .update(unread ? { dismissed_at: now, read_at: now } : { dismissed_at: now })
    .eq('id', notificationId);
  if (error) throw error;
}

/**
 * Actions « À faire » reportées ou masquées par l'admin (today_dismissals) : [{ item_key, until }].
 * until null = « Ne plus afficher », sinon l'action revient à cette date.
 */
export async function fetchTodayDismissals() {
  const { data, error } = await supabase.from('today_dismissals').select('item_key, until').limit(1000);
  if (error) throw error;
  return data ?? [];
}

/** Reporte une action « À faire » jusqu'à `until` (ISO), ou la masque pour de bon (until null). */
export async function setTodayDismissal(itemKey, until = null) {
  const { error } = await supabase.rpc('set_today_dismissal', { p_item_key: itemKey, p_until: until });
  if (error) throw error;
}

/** Remet une action reportée ou masquée dans la liste « À faire ». */
export async function clearTodayDismissal(itemKey) {
  const { error } = await supabase.rpc('clear_today_dismissal', { p_item_key: itemKey });
  if (error) throw error;
}

/** Marque une notification comme lue (read_at = now). */
export async function markNotificationRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null);
  if (error) throw error;
}
