-- Conseil de sécurité Supabase « function_search_path_mutable » : la fonction des déclencheurs
-- updated_at n'avait pas de search_path fixé. NOW() vient de pg_catalog, toujours lu en premier,
-- donc un search_path vide ne change rien à son comportement.
ALTER FUNCTION public.set_updated_at() SET search_path = '';
