-- LAB-295 — Écrans de la borne composés par l'admin (spec docs/specs/ecrans-borne-admin.md, lot E1).
--
-- 1. Table kiosk_screens : un écran d'accueil (kind = 'home') et un écran de partage (kind = 'result')
--    par organisation, appliqués à tous ses événements.
--    - draft_json : brouillon de l'éditeur (enveloppe de serializeState), jamais lu par la borne ;
--    - published : plan publié (contrat `layout` de la spec, avec les adresses complètes des images),
--      NULL = rien de publié (la borne garde ses écrans standard) ;
--    - published_version : numéro de la dernière publication (0 = jamais publié).
--    org_id prend par défaut l'organisation de l'utilisateur connecté (comme planning_entries).
-- 2. RLS : le propriétaire de l'organisation lit et écrit ses lignes. Aucun droit pour anon.
-- 3. RPC borne kiosk_get_screens(p_event_id, p_machine_id, p_secret) : licence vérifiée comme
--    kiosk_get_approved_design (même erreur 42501), puis { home, result } = published de chaque
--    écran de l'organisation de l'événement, ou null. Événement d'un autre compte (ou borne sans
--    compte) : { home: null, result: null }, comme sans écran. Droits : anon et service_role.
--
-- Fonctionnalité du socle ouvert (features.json, entrée core). Aucune donnée existante modifiée.
-- Idempotente : IF NOT EXISTS, DROP ... IF EXISTS, CREATE OR REPLACE, REVOKE / GRANT rejouables.
-- Vérification : supabase/tests/lab295_kiosk_screens_check.sql.

-- ── 1. Table ────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kiosk_screens (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL DEFAULT public.current_owner_org_id()
                                REFERENCES public.organizations (id) ON DELETE CASCADE,
  kind              text        NOT NULL CONSTRAINT kiosk_screens_kind_check CHECK (kind IN ('home', 'result')),
  draft_json        jsonb,
  draft_updated_at  timestamptz,
  published         jsonb,
  published_version int         NOT NULL DEFAULT 0,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kiosk_screens_org_id_kind_key UNIQUE (org_id, kind)
);

DROP TRIGGER IF EXISTS trg_kiosk_screens_updated_at ON public.kiosk_screens;
CREATE TRIGGER trg_kiosk_screens_updated_at
  BEFORE UPDATE ON public.kiosk_screens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS et droits ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kiosk_screens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kiosk_screens_owner_select ON public.kiosk_screens;
CREATE POLICY kiosk_screens_owner_select
  ON public.kiosk_screens FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS kiosk_screens_owner_insert ON public.kiosk_screens;
CREATE POLICY kiosk_screens_owner_insert
  ON public.kiosk_screens FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS kiosk_screens_owner_update ON public.kiosk_screens;
CREATE POLICY kiosk_screens_owner_update
  ON public.kiosk_screens FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS kiosk_screens_owner_delete ON public.kiosk_screens;
CREATE POLICY kiosk_screens_owner_delete
  ON public.kiosk_screens FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

-- Les droits par défaut du schéma public donnent tout à anon et authenticated : on les retire.
REVOKE ALL ON public.kiosk_screens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kiosk_screens TO authenticated;
GRANT ALL ON public.kiosk_screens TO service_role;

-- ── 3. Écrans publiés (borne) ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kiosk_get_screens(p_event_id uuid, p_machine_id text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_org    uuid;
  v_home   jsonb;
  v_result jsonb;
BEGIN
  SELECT l.id, l.org_id INTO v_id, v_org
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND l.secret <> ''
     AND l.secret = p_secret;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_get_screens : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  -- Événement d'un autre compte (ou borne sans compte) : rien, comme sans écran publié.
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.org_id = v_org) THEN
    SELECT s.published INTO v_home
      FROM public.kiosk_screens s
     WHERE s.org_id = v_org AND s.kind = 'home';
    SELECT s.published INTO v_result
      FROM public.kiosk_screens s
     WHERE s.org_id = v_org AND s.kind = 'result';
  END IF;

  RETURN jsonb_build_object('home', v_home, 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_get_screens(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_get_screens(uuid, text, text) TO anon, service_role;

NOTIFY pgrst, 'reload schema';
