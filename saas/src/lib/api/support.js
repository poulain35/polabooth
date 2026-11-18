// Assistance client (page /aide).
import { supabase } from './client.js';
import { callFunction } from './functions.js';

// ── Assistance client (page /aide) ───────────────────────────────────────────

/** Contenu de la page d'aide : cas publiés (FAQ) + contact du loueur (par code, optionnel). */
export async function getSupportContent(code) {
  const articlesPromise = supabase
    .from('support_articles')
    .select('id, category, title, solution, image_url, severity, sort_order')
    .eq('is_published', true)
    .order('sort_order', { ascending: true });

  const contactPromise = code
    ? supabase.rpc('get_org_contact_by_code', { p_code: code })
    : Promise.resolve({ data: null });

  const [{ data: articles, error }, { data: contact }] = await Promise.all([
    articlesPromise,
    contactPromise,
  ]);
  if (error) throw error;
  return { articles: articles ?? [], contact: contact ?? null };
}

/** Chat IA de dépannage (closed-book). messages = [{ role, content }]. */
export function assistantChat({ code, messages }) {
  // { reply, escalate: { needed, urgency } }
  return callFunction('assistant-chat', { json: { code, messages }, fallback: 'Erreur assistant' });
}

/** Escalade : enregistre un message pour le loueur et le notifie. */
export function submitSupportMessage({ code, name, phone, message, urgency, transcript }) {
  // { ok: true }
  return callFunction('submit-support-message', {
    json: { code, name, phone, message, urgency, transcript }, fallback: 'Envoi du message échoué',
  });
}
