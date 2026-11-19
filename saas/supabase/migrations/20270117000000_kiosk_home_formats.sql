-- Accueil de la borne par format du cadre photo.
--
-- L'admin compose, en plus de l'accueil portrait (kind = 'home'), un accueil par format couché ou en
-- bandelette : 'home_landscape' (paysage), 'home_strip_h' (bandelette horizontale), 'home_strip_v'
-- (bandelette verticale). Chaque variante publie un plan de sorte « home » : la borne ne change pas.
--
-- kiosk_get_screens renvoie toujours {home, result} ; `home` est l'accueil publié du format du cadre
-- principal de l'événement (cadre « print » validé au plus petit slot, comme kiosk_get_approved_design),
-- sinon l'accueil portrait. Même règle dans l'export .pola (publishedScreensForFormat).
--
-- Idempotente : DROP CONSTRAINT IF EXISTS, CREATE OR REPLACE, REVOKE / GRANT rejouables.

ALTER TABLE public.kiosk_screens DROP CONSTRAINT IF EXISTS kiosk_screens_kind_check;
ALTER TABLE public.kiosk_screens ADD CONSTRAINT kiosk_screens_kind_check
  CHECK (kind IN ('home', 'home_landscape', 'home_strip_h', 'home_strip_v', 'result'));

CREATE OR REPLACE FUNCTION public.kiosk_get_screens(p_event_id uuid, p_machine_id text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      uuid;
  v_org     uuid;
  v_format  text;
  v_variant text;
  v_home    jsonb;
  v_result  jsonb;
BEGIN
  SELECT l.id, l.org_id INTO v_id, v_org
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND public.kiosk_secret_matches(l.secret_hash, p_secret);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_get_screens : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  -- Événement d'un autre compte (ou borne sans compte) : rien, comme sans écran publié.
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.org_id = v_org) THEN
    -- Format du cadre principal : cadre validé au plus petit slot.
    SELECT d.format INTO v_format
      FROM public.client_designs d
     WHERE d.event_id = p_event_id AND d.kind = 'print' AND d.status = 'approved'
     ORDER BY d.slot ASC
     LIMIT 1;
    v_variant := CASE v_format
      WHEN 'landscape' THEN 'home_landscape'
      WHEN 'stripH'    THEN 'home_strip_h'
      WHEN 'stripV'    THEN 'home_strip_v'
      ELSE NULL
    END;

    IF v_variant IS NOT NULL THEN
      SELECT s.published INTO v_home
        FROM public.kiosk_screens s
       WHERE s.org_id = v_org AND s.kind = v_variant;
    END IF;
    -- Variante absente ou non publiée : accueil portrait.
    IF v_home IS NULL OR jsonb_typeof(v_home) = 'null' THEN
      SELECT s.published INTO v_home
        FROM public.kiosk_screens s
       WHERE s.org_id = v_org AND s.kind = 'home';
    END IF;
    SELECT s.published INTO v_result
      FROM public.kiosk_screens s
     WHERE s.org_id = v_org AND s.kind = 'result';
  END IF;

  RETURN jsonb_build_object('home', v_home, 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_get_screens(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_get_screens(uuid, text, text) TO anon, service_role;
