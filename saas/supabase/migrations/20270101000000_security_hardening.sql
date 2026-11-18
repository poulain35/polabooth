-- LAB-391 — Durcissement de la base avant la publication de Polabooth.
--
-- Vaut pour la prod et le dev (historique des migrations) comme pour une instance neuve (base figée
-- open-core/migrations/20261216000005_base.sql, puis migrations suivantes). Objets du socle ouvert
-- seulement (aucune fonctionnalité privée) : rien à déclarer dans supabase/features.json.
--
-- 1. organizations : plus de création libre. La policy org_owner_all (FOR ALL, TO public) laissait tout
--    compte connecté créer une organisation. Le propriétaire garde lecture, modification et suppression
--    de la sienne ; seul l'admin plateforme (is_app_admin()) crée une organisation depuis le SaaS
--    (la sienne, création automatique de AdminEvents.jsx), le service (install-instance.mjs) passe
--    outre la RLS. anon perd tout droit sur la table (aucune page publique ne la lit : getFormatBleed
--    et getOrgFeatures ignorent l'échec, les pages publiques passent par des RPC).
-- 2. Droits anon retirés : kiosk_alerts, kiosk_releases (lus par l'admin connecté seulement ; la borne
--    ne passe que par des RPC), MAINTAIN sur gallery_analytics et print_logs (PG 17). SELECT sur
--    templates est GARDÉ : l'éditeur du client (anonyme, code événement) lit les modèles actifs
--    (TemplatesSidebar, fetchDbTemplatesMeta, fetchDbTemplateById).
-- 3. Storage : plus de liste des buckets publics. Les adresses /storage/v1/object/public/... ne passent
--    pas par la RLS et restent lisibles. Lecture gardée pour l'admin plateforme sur les buckets qu'il
--    gère : l'upsert (fonds de modèles) et la suppression (décorations, polices) de l'API Storage en
--    ont besoin.
-- 4. Taille et types de fichiers de chaque bucket (kiosk-backgrounds déjà réglé par LAB-282 et LAB-331).
-- 5. Droits par défaut : les futures tables, séquences et fonctions du schéma public ne sont plus
--    ouvertes d'office à anon et authenticated ; chaque migration donne ses droits (GRANT explicites,
--    déjà la règle des migrations récentes). service_role garde ses droits par défaut.
-- 6. get_global_form_config() : search_path fixé et critère explicite.
-- 7. Fonctions SECURITY DEFINER encore exécutables par PUBLIC : REVOKE FROM PUBLIC, GRANT explicites.
--
-- Idempotente. Aucun fichier ni aucune ligne n'est supprimé.

-- ────────────────────────────────────────────────────────────
-- 1. organizations
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_owner_all"        ON public.organizations;
DROP POLICY IF EXISTS "org_owner_select"     ON public.organizations;
DROP POLICY IF EXISTS "org_owner_update"     ON public.organizations;
DROP POLICY IF EXISTS "org_owner_delete"     ON public.organizations;
DROP POLICY IF EXISTS "org_app_admin_insert" ON public.organizations;

CREATE POLICY "org_owner_select" ON public.organizations
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "org_owner_update" ON public.organizations
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "org_owner_delete" ON public.organizations
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- L'admin plateforme crée une organisation dont il est le propriétaire.
CREATE POLICY "org_app_admin_insert" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND (SELECT public.is_app_admin()));

REVOKE ALL ON public.organizations FROM anon;

-- ────────────────────────────────────────────────────────────
-- 2. Droits anon
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON public.kiosk_alerts   FROM anon;
REVOKE ALL ON public.kiosk_releases FROM anon;

-- MAINTAIN n'existe qu'à partir de PostgreSQL 17.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON public.gallery_analytics FROM anon';
    EXECUTE 'REVOKE MAINTAIN ON public.print_logs FROM anon';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. Storage : plus de liste des buckets publics
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "designs_public_read"                ON storage.objects;
DROP POLICY IF EXISTS "Public can read backgrounds"        ON storage.objects;
DROP POLICY IF EXISTS "decorations_public_read"            ON storage.objects;
DROP POLICY IF EXISTS "app_releases_public_read"           ON storage.objects;
DROP POLICY IF EXISTS "fonts_read"                         ON storage.objects;
-- Lecture du bucket fonts par tout compte connecté (LAB-128) : remplacée par la lecture de l'admin.
DROP POLICY IF EXISTS "storage_fonts_authenticated_select" ON storage.objects;

DROP POLICY IF EXISTS "storage_template_backgrounds_app_admin_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_decorations_app_admin_select"          ON storage.objects;
DROP POLICY IF EXISTS "storage_fonts_app_admin_select"                ON storage.objects;
DROP POLICY IF EXISTS "app_releases_admin_select"                     ON storage.objects;

CREATE POLICY "storage_template_backgrounds_app_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'template-backgrounds' AND (SELECT public.is_app_admin()));

CREATE POLICY "storage_decorations_app_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'decorations' AND (SELECT public.is_app_admin()));

CREATE POLICY "storage_fonts_app_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'fonts' AND (SELECT public.is_app_admin()));

-- Bucket sans usage depuis LAB-269 (installeurs sur R2/S3) : mêmes règles que ses policies d'écriture.
CREATE POLICY "app_releases_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'app-releases' AND (SELECT public.is_app_admin()));

-- ────────────────────────────────────────────────────────────
-- 4. Taille et types des buckets (bucket absent : UPDATE sans effet)
-- ────────────────────────────────────────────────────────────
-- designs : PNG final des designs (submit-design, jusqu'à 3600 × 2400 px) et images importées
-- (upload-design-image, remove-background : PNG, JPEG, WebP, 15 Mo au plus).
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
 WHERE id = 'designs';

-- decorations : décorations de la Bibliothèque (AdminDecorations) et leurs vignettes PNG.
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
 WHERE id = 'decorations';

-- template-backgrounds : fonds de modèles (import par lot, JPEG à la taille d'impression).
UPDATE storage.buckets
   SET file_size_limit = 20971520,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'template-backgrounds';

-- fonts : polices de la Bibliothèque (AdminFonts : .woff2, .woff, .ttf, .otf ; polices Google en TTF
-- ou OTF). Même plafond que les polices des écrans de la borne. Types larges : un navigateur sous Windows
-- envoie souvent un .ttf en application/octet-stream (polices déjà en prod sous ce type).
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'font/sfnt',
                                 'application/octet-stream', 'application/x-font-ttf', 'application/x-font-otf',
                                 'application/font-sfnt', 'application/font-woff']
 WHERE id = 'fonts';

-- thumbnails : sans usage (les vignettes des décorations sont dans decorations/thumbnails/).
UPDATE storage.buckets
   SET file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
 WHERE id = 'thumbnails';

-- photos : sans usage (photos et vidéos sur le stockage S3/R2) ; mêmes types que la borne, plafond
-- du plan gratuit de Supabase (50 Mo).
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
 WHERE id = 'photos';

-- app-releases : sans usage depuis LAB-269 (l'installeur, environ 100 Mo, dépasse la limite de
-- Supabase) ; réglé pour ne rien accepter d'autre qu'un exécutable Windows.
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY['application/vnd.microsoft.portable-executable',
                                  'application/x-msdownload', 'application/octet-stream']
 WHERE id = 'app-releases';

-- ────────────────────────────────────────────────────────────
-- 5. Droits par défaut des futurs objets du schéma public
-- ────────────────────────────────────────────────────────────
-- Les migrations tournent sous le rôle postgres. EXECUTE reste donné à PUBLIC par PostgreSQL pour
-- toute nouvelle fonction (règle globale, pas par schéma) : chaque migration continue d'écrire
-- REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated avant ses GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. get_global_form_config()
-- ────────────────────────────────────────────────────────────
-- Questionnaire invité (form_config de l'organisation), lu par l'admin (AdminNewEvent, AdminStats,
-- CreationTab) et par la page client anonyme (EditorPage, formulaire activé). Avant : « LIMIT 1 »
-- sans ordre ni search_path. Critère : l'organisation du compte connecté s'il en possède une, sinon
-- celle de l'admin plateforme (l'organisation de l'instance), sinon la plus ancienne.
CREATE OR REPLACE FUNCTION public.get_global_form_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.form_config
    FROM public.organizations o
   ORDER BY (o.owner_id = auth.uid()) IS TRUE DESC,
            EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = o.owner_id) DESC,
            o.created_at, o.id
   LIMIT 1;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. Fonctions SECURITY DEFINER encore exécutables par PUBLIC
-- ────────────────────────────────────────────────────────────
-- Les quatre fonctions du socle sans REVOKE FROM PUBLIC. Elles restent appelées par anon (page
-- client, borne) et par l'admin connecté.
REVOKE ALL ON FUNCTION public.get_global_form_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_form_config() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_event_form_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_form_enabled(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_org_contact_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_contact_by_code(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_org_contact_by_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_contact_by_event(uuid) TO anon, authenticated, service_role;
