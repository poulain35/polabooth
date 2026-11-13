-- LAB-282 (LAB-283) — Verrouillage du bucket kiosk-backgrounds.
-- Spec : docs/specs/LAB-282-bucket-kiosk-backgrounds.md (D1 à D8, validées le 2026-11-13).
--
-- Avant : tout compte connecté écrivait n'importe où dans le bucket, et anon listait son contenu.
-- Après, trois formes de chemin seulement, pour les comptes connectés :
--   default/{fichier}        → admin plateforme (is_app_admin())                       (D1)
--   {event_id}/{fichier}     → propriétaire de l'organisation de l'événement            (D2)
--   org/{org_id}/{fichier}   → propriétaire de l'organisation                           (D3)
-- Tout autre chemin est refusé (D8). La lecture par le compte connecté suit les mêmes règles (elle
-- est nécessaire à l'upsert de Storage) ; anon n'a plus aucune policy (D4). Le bucket reste public :
-- la borne et l'export .pola lisent par /storage/v1/object/public/..., qui ne passe pas par la RLS.
-- Types acceptés : PNG, JPEG, JSON (setup_config.json) ; 10 Mo au maximum (D5).
--
-- Idempotente. Aucun fichier existant n'est déplacé ni supprimé.

-- Vrai si le compte connecté peut lire et écrire ce chemin du bucket kiosk-backgrounds.
-- SECURITY INVOKER : la RLS d'events et d'organizations s'applique en plus ; la condition
-- owner_id = auth.uid() reste écrite pour que la règle se lise seule (et pour exclure l'admin
-- plateforme des dossiers des autres organisations, D2). Comparaison en texte : un segment qui
-- n'est pas un uuid ne provoque pas d'erreur de conversion.
CREATE OR REPLACE FUNCTION public.kiosk_bg_path_allowed(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_name IS NULL OR p_name = '' THEN false
    -- Un segment vide (« a//b », « /x », « x/ ») n'est jamais un chemin valide.
    WHEN '' = ANY (string_to_array(p_name, '/')) THEN false
    WHEN array_length(string_to_array(p_name, '/'), 1) = 2 AND split_part(p_name, '/', 1) = 'default'
      THEN coalesce((SELECT public.is_app_admin()), false)
    WHEN array_length(string_to_array(p_name, '/'), 1) = 3 AND split_part(p_name, '/', 1) = 'org'
      THEN EXISTS (SELECT 1 FROM public.organizations o
                    WHERE o.id::text = split_part(p_name, '/', 2)
                      AND o.owner_id = auth.uid())
    WHEN array_length(string_to_array(p_name, '/'), 1) = 2
      THEN EXISTS (SELECT 1 FROM public.events e
                     JOIN public.organizations o ON o.id = e.org_id
                    WHERE e.id::text = split_part(p_name, '/', 1)
                      AND o.owner_id = auth.uid())
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_bg_path_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kiosk_bg_path_allowed(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "kiosk_bg_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_admin_insert"  ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_admin_update"  ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_admin_delete"  ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_owner_select"  ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_owner_insert"  ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "kiosk_bg_owner_delete"  ON storage.objects;

CREATE POLICY "kiosk_bg_owner_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kiosk-backgrounds' AND public.kiosk_bg_path_allowed(name));

CREATE POLICY "kiosk_bg_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kiosk-backgrounds' AND public.kiosk_bg_path_allowed(name));

CREATE POLICY "kiosk_bg_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'kiosk-backgrounds' AND public.kiosk_bg_path_allowed(name))
  WITH CHECK (bucket_id = 'kiosk-backgrounds' AND public.kiosk_bg_path_allowed(name));

CREATE POLICY "kiosk_bg_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kiosk-backgrounds' AND public.kiosk_bg_path_allowed(name));

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'application/json'],
       file_size_limit = 10485760
 WHERE id = 'kiosk-backgrounds';
