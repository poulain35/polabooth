// Client Supabase partagé et adresse des edge functions.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  console.warn('Variables Supabase manquantes dans .env — voir .env.example');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnon ?? '');

export const FUNCTIONS_URL = `${supabaseUrl}/functions/v1`;
