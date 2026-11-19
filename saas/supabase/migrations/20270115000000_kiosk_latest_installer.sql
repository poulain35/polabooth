-- Adresse courte de l'installeur de la borne (/installer-borne).
--
-- Sur un PC neuf, on ouvre le navigateur, on tape l'adresse courte du SaaS et le téléchargement de la
-- dernière version de la borne se lance, sans connexion. La table kiosk_releases reste fermée à anon
-- (20270101000000_security_hardening) : cette RPC ne renvoie que la dernière version et l'adresse
-- publique de son installeur (déjà publique sur R2), jamais les notes ni l'empreinte.
--
-- get_latest_kiosk_installer() -> { version, exe_url } ou NULL si aucune version n'est publiée.
--   Ordre numérique des versions (1.0.10 après 1.0.9), comme latestRelease de src/lib/kioskUpdate.js.
--   Versions « 1.2.3 » seulement (le cast en int[] ne peut pas échouer) et adresse https seulement.
--
-- Rien dans form_config ni dans le .pola, rien pour la borne. Migration publique (cœur).
-- Idempotente : CREATE OR REPLACE. Aucun secret, aucune donnée.

CREATE OR REPLACE FUNCTION public.get_latest_kiosk_installer()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('version', r.version, 'exe_url', r.exe_url)
  FROM public.kiosk_releases r
  WHERE r.version ~ '^[0-9]{1,9}(\.[0-9]{1,9})*$'
    AND r.exe_url LIKE 'https://%'
  ORDER BY string_to_array(r.version, '.')::int[] DESC, r.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_latest_kiosk_installer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_kiosk_installer() TO anon, authenticated, service_role;
