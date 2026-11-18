-- LAB-358 — Stock de matériel par type (spec docs/specs/stock-materiel.md, lot S1, migration 1 socle).
--
-- 1. Table equipment_types : les types de matériel de l'organisation (Borne photo, Livre d'or audio,
--    Vidéobooth…), créés par l'admin. key = clé stable calculée depuis le libellé puis figée (citée
--    par le catalogue et les événements) ; un seul type par défaut non archivé par organisation
--    (index unique partiel) ; archived_at = plus compté ni proposé.
-- 2. Table equipment_items : un matériel (une borne, un téléphone…) d'un type. status = in_service
--    ou retired (retired_at posé par déclencheur) ; une période d'indisponibilité facultative :
--    unavailable_from (début, compris), unavailable_until (fin comprise, NULL = sans limite),
--    unavailable_reason. Une fin sans début ou avant le début est refusée. Le type doit appartenir
--    à la même organisation (déclencheur, erreur 23514).
-- 3. events.equipment_needs : besoin de l'événement { "<clé de type>": quantité }. NULL = 1 du type
--    par défaut (comportement d'aujourd'hui) ; {} = aucun matériel. Suit la RLS existante de events.
--    N'entre ni dans kiosk_get_event, ni dans le .pola, ni dans get_public_event (aucune RPC modifiée).
-- 4. RLS : le propriétaire de l'organisation lit et écrit ses lignes (comme kiosk_screens). Aucun
--    droit pour anon.
--
-- Fonctionnalité du socle ouvert (features.json, entrée core). Aucune donnée existante modifiée,
-- aucun type ni matériel créé d'office (la reprise « Borne photo » appartient au lot S2, module booking).
-- Idempotente : IF NOT EXISTS, DROP ... IF EXISTS, CREATE OR REPLACE, REVOKE / GRANT rejouables.
-- Vérification : supabase/tests/lab358_equipment_check.sql.

-- ── 1. Types de matériel ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.equipment_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL DEFAULT public.current_owner_org_id()
                          REFERENCES public.organizations (id) ON DELETE CASCADE,
  key         text        NOT NULL CONSTRAINT equipment_types_key_check
                          CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(key) <= 40),
  label       text        NOT NULL CONSTRAINT equipment_types_label_check
                          CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  is_default  boolean     NOT NULL DEFAULT false,
  sort_order  int         NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_types_org_id_key_key UNIQUE (org_id, key)
);

-- Un seul type par défaut (non archivé) par organisation.
CREATE UNIQUE INDEX IF NOT EXISTS equipment_types_one_default_idx
  ON public.equipment_types (org_id)
  WHERE is_default AND archived_at IS NULL;

DROP TRIGGER IF EXISTS trg_equipment_types_updated_at ON public.equipment_types;
CREATE TRIGGER trg_equipment_types_updated_at
  BEFORE UPDATE ON public.equipment_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Matériels ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.equipment_items (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL DEFAULT public.current_owner_org_id()
                                 REFERENCES public.organizations (id) ON DELETE CASCADE,
  type_id            uuid        NOT NULL REFERENCES public.equipment_types (id) ON DELETE RESTRICT,
  name               text        NOT NULL CONSTRAINT equipment_items_name_check
                                 CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  status             text        NOT NULL DEFAULT 'in_service' CONSTRAINT equipment_items_status_check
                                 CHECK (status IN ('in_service', 'retired')),
  unavailable_from   date,
  unavailable_until  date,
  unavailable_reason text        CONSTRAINT equipment_items_unavailable_reason_check
                                 CHECK (length(unavailable_reason) <= 200),
  notes              text        CONSTRAINT equipment_items_notes_check CHECK (length(notes) <= 1000),
  sort_order         int         NOT NULL DEFAULT 0,
  retired_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_items_until_needs_from_check
    CHECK (unavailable_until IS NULL OR unavailable_from IS NOT NULL),
  CONSTRAINT equipment_items_until_after_from_check
    CHECK (unavailable_until IS NULL OR unavailable_until >= unavailable_from)
);

CREATE INDEX IF NOT EXISTS equipment_items_type_id_idx ON public.equipment_items (type_id);
CREATE INDEX IF NOT EXISTS equipment_items_org_id_idx ON public.equipment_items (org_id);

DROP TRIGGER IF EXISTS trg_equipment_items_updated_at ON public.equipment_items;
CREATE TRIGGER trg_equipment_items_updated_at
  BEFORE UPDATE ON public.equipment_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Type de la même organisation, et retired_at tenu à jour depuis status.
-- SECURITY INVOKER : sous la RLS du propriétaire, le type d'une autre organisation est invisible, ce
-- qui donne le même refus (23514).
CREATE OR REPLACE FUNCTION public.equipment_items_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type_org uuid;
BEGIN
  SELECT t.org_id INTO v_type_org FROM public.equipment_types t WHERE t.id = NEW.type_id;
  IF v_type_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'equipment_items : le type doit appartenir à la même organisation'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'retired' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'retired' THEN
      NEW.retired_at := COALESCE(OLD.retired_at, now());
    ELSE
      NEW.retired_at := now();
    END IF;
  ELSE
    NEW.retired_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.equipment_items_before_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_equipment_items_before_write ON public.equipment_items;
CREATE TRIGGER trg_equipment_items_before_write
  BEFORE INSERT OR UPDATE ON public.equipment_items
  FOR EACH ROW EXECUTE FUNCTION public.equipment_items_before_write();

-- ── 3. Besoin de matériel d'un événement ────────────────────────────────────────────────────

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS equipment_needs jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.events'::regclass
                    AND conname = 'events_equipment_needs_check') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_equipment_needs_check
      CHECK (equipment_needs IS NULL OR jsonb_typeof(equipment_needs) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.events.equipment_needs IS
  'Besoin de matériel { "<clé de type>": quantité 0-50 } (LAB-358). NULL = 1 du type par défaut ; {} = aucun matériel.';

-- ── 4. RLS et droits ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.equipment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_types_owner_select ON public.equipment_types;
CREATE POLICY equipment_types_owner_select
  ON public.equipment_types FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_types_owner_insert ON public.equipment_types;
CREATE POLICY equipment_types_owner_insert
  ON public.equipment_types FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_types_owner_update ON public.equipment_types;
CREATE POLICY equipment_types_owner_update
  ON public.equipment_types FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_types_owner_delete ON public.equipment_types;
CREATE POLICY equipment_types_owner_delete
  ON public.equipment_types FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_items_owner_select ON public.equipment_items;
CREATE POLICY equipment_items_owner_select
  ON public.equipment_items FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_items_owner_insert ON public.equipment_items;
CREATE POLICY equipment_items_owner_insert
  ON public.equipment_items FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_items_owner_update ON public.equipment_items;
CREATE POLICY equipment_items_owner_update
  ON public.equipment_items FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS equipment_items_owner_delete ON public.equipment_items;
CREATE POLICY equipment_items_owner_delete
  ON public.equipment_items FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

-- Les droits par défaut du schéma public donnent tout à anon et authenticated : on les retire.
REVOKE ALL ON public.equipment_types FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment_types TO authenticated;
GRANT ALL ON public.equipment_types TO service_role;

REVOKE ALL ON public.equipment_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment_items TO authenticated;
GRANT ALL ON public.equipment_items TO service_role;

NOTIFY pgrst, 'reload schema';
