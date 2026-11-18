-- LAB-356 : ménage quotidien des images des modèles qui ne servent plus (bucket `designs`).
-- Logique dans supabase/functions/design-images-cleanup/ (logic.ts, testé sous node --test).
--
-- 1. design_image_cleanup_candidates(p_cutoff, p_limit, p_names) : objets du bucket `designs` rangés
--    par upload-design-image / remove-background, et seulement eux : `{event_id}/images/{sha256}.{ext}`,
--    `templates/images/…` et `templates/previews/…` (aperçus des modèles). Créés ET réécrits avant
--    p_cutoff (= maintenant - 7 jours, calculé par la fonction). Tirés au hasard (aucun objet bloqué
--    derrière d'autres), au plus p_limit (plafonné à 1000). p_names : restreint à ces noms (nouvelle
--    vérification juste avant la suppression). Le PNG final et le reste du bucket ne sortent jamais.
-- 2. design_image_references(p_source, p_after, p_limit, p_max_bytes) : une page (par id) d'une table
--    de la liste blanche, lignes entières converties en texte JSON (toutes les colonnes : canvas_json
--    avec groupes, fonds, motifs, masques, mais aussi preview_url, form_config, draft_json…), et les
--    suites d'au moins 64 caractères hexadécimaux qu'elles contiennent (empreintes des noms d'images).
--    Au plus p_limit lignes et environ p_max_bytes octets par page (au moins une ligne).
--    Renvoie {rows, last_id, runs}.
-- 3. Job pg_cron quotidien design-images-cleanup (03:30 UTC, nuit en France : personne n'édite) via
--    public.cron_http_post (JWT service_role lu dans le Vault, appel tracé dans cron_http_calls : une
--    réponse hors 2xx déclenche l'alerte de check-cron-alerts).
--
-- PRÉREQUIS (une fois par environnement, dev puis prod) — ne pas committer de secrets :
--   1. Déployer la fonction :  supabase functions deploy design-images-cleanup
--   2. Vault : 'project_url' et 'service_role_key' (créés par 20260608000002_kiosk_alerts_cron.sql).
--   Aucun secret de fonction en plus (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fournis par Supabase).
--
-- Idempotente : CREATE OR REPLACE, cron.schedule par nom (remplace le job).
-- Rien n'est exposé à anon ni à authenticated. Aucun impact kiosk : la borne lit final_png_url et
-- canvas_json (zones photo) ; une image encore citée dans un modèle n'est jamais supprimée.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- ── 1. Images candidates (service_role uniquement) ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.design_image_cleanup_candidates(
  p_cutoff TIMESTAMPTZ,
  p_limit  INTEGER DEFAULT 200,
  p_names  TEXT[]  DEFAULT NULL
)
RETURNS TABLE (name TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT o.name, o.created_at, o.updated_at
    FROM storage.objects o
   WHERE o.bucket_id = 'designs'
     AND o.name ~ '^([0-9a-f-]{36}/images|templates/(images|previews))/[0-9a-f]{64}\.(png|jpg|webp)$'
     AND o.created_at < p_cutoff
     AND coalesce(o.updated_at, o.created_at) < p_cutoff
     AND (p_names IS NULL OR o.name = ANY (p_names))
   ORDER BY random()
   LIMIT least(greatest(coalesce(p_limit, 200), 0), 1000);
$$;

REVOKE ALL ON FUNCTION public.design_image_cleanup_candidates(TIMESTAMPTZ, INTEGER, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.design_image_cleanup_candidates(TIMESTAMPTZ, INTEGER, TEXT[]) TO service_role;

-- ── 2. Empreintes citées dans une table (service_role uniquement) ───────────────────────────

CREATE OR REPLACE FUNCTION public.design_image_references(
  p_source    TEXT,
  p_after     UUID    DEFAULT NULL,
  p_limit     INTEGER DEFAULT 100,
  p_max_bytes BIGINT  DEFAULT 8388608
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Liste blanche : même liste que REFERENCE_SOURCES (design-images-cleanup/logic.ts).
  IF p_source IS NULL OR NOT (p_source = ANY (ARRAY[
    'client_designs', 'design_versions', 'templates', 'kiosk_screens', 'events', 'organizations', 'decorations'
  ])) THEN
    RAISE EXCEPTION 'design_image_references : table non autorisée (%)', p_source;
  END IF;

  EXECUTE format($q$
    WITH page AS (
      SELECT t.id, to_jsonb(t)::text AS body
        FROM public.%I t
       WHERE $1 IS NULL OR t.id > $1
       ORDER BY t.id
       LIMIT least(greatest(coalesce($2, 100), 1), 1000)
    ),
    sized AS (
      SELECT id, body,
             row_number() OVER (ORDER BY id) AS rn,
             sum(octet_length(body)) OVER (ORDER BY id) AS running
        FROM page
    ),
    kept AS (
      SELECT id, body FROM sized WHERE rn = 1 OR running <= coalesce($3, 8388608)
    )
    SELECT jsonb_build_object(
      'rows',    (SELECT count(*) FROM kept),
      'last_id', (SELECT k.id FROM kept k ORDER BY k.id DESC LIMIT 1),
      'runs',    coalesce((
        SELECT jsonb_agg(DISTINCT lower(m.r[1]))
          FROM kept k
         CROSS JOIN LATERAL regexp_matches(k.body, '[0-9a-fA-F]{64,}', 'g') AS m(r)
      ), '[]'::jsonb)
    )
  $q$, p_source)
  INTO v_result
  USING p_after, p_limit, p_max_bytes;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.design_image_references(TEXT, UUID, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.design_image_references(TEXT, UUID, INTEGER, BIGINT) TO service_role;

-- ── 3. Planification (quotidienne, 03:30 UTC) ───────────────────────────────────────────────

SELECT cron.schedule(
  'design-images-cleanup',
  '30 3 * * *',
  $$SELECT public.cron_http_post('design-images-cleanup', 'design-images-cleanup', 120000)$$
);
