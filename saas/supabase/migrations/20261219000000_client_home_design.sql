-- Deux designs par événement : le modèle photo (kind = 'print') et l'écran d'accueil de la borne
-- (kind = 'home', 1920×1080), créé par le client quand form_config.kiosk.home.client_design est vrai.
--
-- 1. client_designs.kind ('print' | 'home', défaut 'print') : les lignes existantes passent en 'print'.
--    UNIQUE (event_id) devient UNIQUE (event_id, kind) : les upsert utilisent onConflict 'event_id,kind'.
-- 2. design_versions.kind, même règle : l'historique de chaque design est séparé.
-- 3. kiosk_get_approved_design : le design renvoyé est le modèle photo (kind = 'print') et la réponse
--    gagne home_design = { id, final_png_url } ou null. L'écran d'accueil n'est renvoyé que s'il est
--    validé (status = 'approved') et si form_config.kiosk.home.personalized ET home.client_design
--    valent true (booléens JSON stricts). Sans modèle photo validé, la RPC renvoie toujours NULL.
--    Droits inchangés : anon (borne) et service_role seulement.
--
-- Idempotente : IF NOT EXISTS / IF EXISTS, CREATE OR REPLACE.
-- Vérification : supabase/tests/lab288_client_home_design_check.sql.

-- ── 1. client_designs.kind ──────────────────────────────────────────────────────────────────

ALTER TABLE public.client_designs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'print';

ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_kind_check;
ALTER TABLE public.client_designs
  ADD CONSTRAINT client_designs_kind_check CHECK (kind IN ('print', 'home'));

ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_event_id_key;
ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_event_id_kind_key;
ALTER TABLE public.client_designs
  ADD CONSTRAINT client_designs_event_id_kind_key UNIQUE (event_id, kind);

-- ── 2. design_versions.kind ─────────────────────────────────────────────────────────────────

ALTER TABLE public.design_versions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'print';

ALTER TABLE public.design_versions DROP CONSTRAINT IF EXISTS design_versions_kind_check;
ALTER TABLE public.design_versions
  ADD CONSTRAINT design_versions_kind_check CHECK (kind IN ('print', 'home'));

DROP INDEX IF EXISTS public.design_versions_event_created;
CREATE INDEX IF NOT EXISTS design_versions_event_kind_created
  ON public.design_versions (event_id, kind, created_at DESC);

-- ── 3. Design approuvé (borne) ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kiosk_get_approved_design(p_machine_id text, p_secret text, p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_org    uuid;
  v_home   jsonb;
  v_design json;
BEGIN
  SELECT l.id, l.org_id INTO v_id, v_org
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND l.secret <> ''
     AND l.secret = p_secret;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_get_approved_design : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  SELECT e.form_config #> '{kiosk,home}' INTO v_home
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.org_id = v_org;

  -- Événement d'un autre compte (ou borne sans compte) : NULL, comme sans design.
  SELECT json_build_object(
    'id',            d.id,
    'format',        d.format,
    'canvas_json',   d.canvas_json,
    'final_png_url', d.final_png_url,
    'home_design',   (
      SELECT json_build_object('id', h.id, 'final_png_url', h.final_png_url)
        FROM public.client_designs h
       WHERE h.event_id = d.event_id
         AND h.kind = 'home'
         AND h.status = 'approved'
         AND v_home -> 'personalized' = 'true'::jsonb
         AND v_home -> 'client_design' = 'true'::jsonb
       LIMIT 1
    )
  )
  INTO v_design
  FROM public.client_designs d
  JOIN public.events e ON e.id = d.event_id
  WHERE d.event_id = p_event_id
    AND d.kind = 'print'
    AND d.status = 'approved'
    AND e.org_id = v_org
  LIMIT 1;

  RETURN v_design;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_get_approved_design(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_get_approved_design(text, text, uuid) TO anon, service_role;

NOTIFY pgrst, 'reload schema';
