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

/**
 * Client sous le JWT de l'utilisateur (clé anon + header Authorization) : soumis à la RLS et aux
 * REVOKE. Ne sert qu'à auth.getUser() et aux deux appels de send-event-report/admin-jwt.ts
 * (test LAB-125 « tout client au JWT utilisateur ») ; tout le reste passe par adminClient().
 */
export function userClient(authHeader: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

/** Utilisateur de la session portée par le header Authorization, ou null. */
export async function sessionUser(authHeader: string): Promise<AuthUser | null> {
  const client = userClient(authHeader);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
