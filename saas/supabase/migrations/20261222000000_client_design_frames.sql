-- Choix du cadre par l'invité (LAB-311, lot C1 de docs/specs/choix-cadre-invite.md) : un événement
-- peut avoir jusqu'à 4 cadres (modèles photo, kind = 'print'), numérotés par slot.
--
-- 1. client_designs.slot (1 à 4, défaut 1) et client_designs.label (nom du cadre sur la borne,
--    24 caractères au plus). L'écran d'accueil (kind = 'home') reste unique : slot = 1.
--    UNIQUE (event_id, kind) devient UNIQUE (event_id, kind, slot) : les upsert passent à
--    onConflict 'event_id,kind,slot' (autosave-design, submit-design, à redéployer avec cette
--    migration). Les lignes existantes prennent slot = 1 par défaut, rien d'autre ne change.
-- 2. design_versions.slot, même règle : l'historique de chaque cadre est séparé.
-- 3. kiosk_get_approved_design : le design renvoyé est le cadre 'print' validé au plus petit slot,
--    avec label en plus. La réponse gagne frames = les autres cadres 'print' validés, triés par
--    slot ({ id, slot, label, format, canvas_json, final_png_url }), seulement si
--    form_config.kiosk.frame_choice.enabled vaut true (booléen JSON strict) ; sinon frames = null.
--    home_design inchangé. Sans cadre validé, la RPC renvoie toujours NULL.
--    Signature et droits inchangés : anon (borne) et service_role seulement.
--
-- Idempotente : IF NOT EXISTS / IF EXISTS, CREATE OR REPLACE. Passe aussi sur un projet construit
-- depuis la migration de base open core (UNIQUE (event_id) d'origine supprimé s'il reste).
-- Vérification : supabase/tests/client_design_frames_check.sql.

-- ── 1. client_designs.slot et label ─────────────────────────────────────────────────────────

ALTER TABLE public.client_designs ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;
ALTER TABLE public.client_designs ADD COLUMN IF NOT EXISTS label text;

ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_slot_check;
ALTER TABLE public.client_designs
  ADD CONSTRAINT client_designs_slot_check CHECK (slot BETWEEN 1 AND 4);

ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_home_slot_check;
ALTER TABLE public.client_designs
  ADD CONSTRAINT client_designs_home_slot_check CHECK (kind = 'print' OR slot = 1);

ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_label_check;
ALTER TABLE public.client_designs
  ADD CONSTRAINT client_designs_label_check CHECK (label IS NULL OR char_length(label) <= 24);

ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_event_id_key;
ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_event_id_kind_key;
ALTER TABLE public.client_designs DROP CONSTRAINT IF EXISTS client_designs_event_id_kind_slot_key;
ALTER TABLE public.client_designs
  ADD CONSTRAINT client_designs_event_id_kind_slot_key UNIQUE (event_id, kind, slot);

-- ── 2. design_versions.slot ─────────────────────────────────────────────────────────────────

ALTER TABLE public.design_versions ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;

ALTER TABLE public.design_versions DROP CONSTRAINT IF EXISTS design_versions_slot_check;
ALTER TABLE public.design_versions
  ADD CONSTRAINT design_versions_slot_check CHECK (slot BETWEEN 1 AND 4);

DROP INDEX IF EXISTS public.design_versions_event_kind_created;
CREATE INDEX IF NOT EXISTS design_versions_event_kind_slot_created
  ON public.design_versions (event_id, kind, slot, created_at DESC);

-- ── 3. Cadres validés (borne) ───────────────────────────────────────────────────────────────

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
  v_frames boolean;
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

  SELECT e.form_config #> '{kiosk,home}',
         e.form_config #> '{kiosk,frame_choice,enabled}' = 'true'::jsonb
    INTO v_home, v_frames
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
    ),
    'label',         d.label,
    'frames',        CASE WHEN v_frames THEN (
      SELECT coalesce(json_agg(json_build_object(
               'id',            f.id,
               'slot',          f.slot,
               'label',         f.label,
               'format',        f.format,
               'canvas_json',   f.canvas_json,
               'final_png_url', f.final_png_url
             ) ORDER BY f.slot), '[]'::json)
        FROM public.client_designs f
       WHERE f.event_id = d.event_id
         AND f.kind = 'print'
         AND f.status = 'approved'
         AND f.id <> d.id
    ) END
  )
  INTO v_design
  FROM public.client_designs d
  JOIN public.events e ON e.id = d.event_id
  WHERE d.event_id = p_event_id
    AND d.kind = 'print'
    AND d.status = 'approved'
    AND e.org_id = v_org
  ORDER BY d.slot
  LIMIT 1;

  RETURN v_design;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_get_approved_design(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_get_approved_design(text, text, uuid) TO anon, service_role;

NOTIFY pgrst, 'reload schema';
