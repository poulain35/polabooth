import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { AuthUser } from './admin-guard.ts';

const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey      = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Client avec droits admin (bypass RLS) — utiliser uniquement côté serveur. */
export function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

/** Utilisateur de la session portée par le header Authorization, ou null. */
export async function sessionUser(authHeader: string): Promise<AuthUser | null> {
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
