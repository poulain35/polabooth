// Session de l'admin connecté et organisation dont il est propriétaire.
import { supabase } from './client.js';

/** Session Supabase en cours, ou null. */
export async function currentSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Organisation par défaut du propriétaire connecté (la plus ancienne, comme current_owner_org_id),
 * colonnes `columns`. `{ signedIn: false, org: null }` sans session ; `org` null sans organisation.
 */
export async function ownOrganization(columns) {
  const session = await currentSession();
  if (!session) return { signedIn: false, org: null };
  const { data, error } = await supabase
    .from('organizations')
    .select(columns)
    .eq('owner_id', session.user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return { signedIn: true, org: data ?? null };
}
