-- Liste « À faire » de la page Aujourd'hui : reporter ou masquer une action.
--
-- Une ligne = une action retirée de la liste par l'admin. item_key = clé de l'action ET de sa raison
-- (ex. « quote:<id>:remind ») : si la situation change (le devis à relancer devient « Appeler le
-- client »), la clé change et l'action revient d'elle-même.
--   until NULL      : « Ne plus afficher » ;
--   until renseigné : « Me le rappeler » ; l'action revient à cette date.
-- Écrite par les RPC set_today_dismissal / clear_today_dismissal (l'organisation est déduite du
-- propriétaire connecté) ; lue directement par le propriétaire (RLS). Les lignes de plus d'un an sont
-- effacées à chaque écriture : les actions concernées ont disparu depuis longtemps.
-- Rejouable.

CREATE TABLE IF NOT EXISTS public.today_dismissals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 200),
  until      TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, item_key)
);

ALTER TABLE public.today_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS today_dismissals_owner_select ON public.today_dismissals;
CREATE POLICY today_dismissals_owner_select
  ON public.today_dismissals FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  );

-- Les droits par défaut du schéma public donnent tout à anon et authenticated : on les retire.
REVOKE ALL ON public.today_dismissals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.today_dismissals TO authenticated;
GRANT ALL ON public.today_dismissals TO service_role;

CREATE OR REPLACE FUNCTION public.set_today_dismissal(p_item_key TEXT, p_until TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID;
BEGIN
  IF auth.uid() IS NULL OR p_item_key IS NULL OR length(p_item_key) NOT BETWEEN 1 AND 200 THEN
    RETURN;
  END IF;
  SELECT o.id INTO v_org FROM public.organizations o
   WHERE o.owner_id = auth.uid() ORDER BY o.created_at LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.today_dismissals (org_id, item_key, until)
  VALUES (v_org, p_item_key, p_until)
  ON CONFLICT (org_id, item_key) DO UPDATE SET until = EXCLUDED.until, created_at = now();
  DELETE FROM public.today_dismissals d
   WHERE d.org_id = v_org AND d.created_at < now() - interval '1 year';
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_today_dismissal(p_item_key TEXT)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.today_dismissals d
   WHERE d.item_key = p_item_key
     AND auth.uid() IS NOT NULL
     AND d.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.set_today_dismissal(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_today_dismissal(TEXT, TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION public.clear_today_dismissal(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_today_dismissal(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
