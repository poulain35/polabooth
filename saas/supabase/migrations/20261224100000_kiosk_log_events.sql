-- LAB-327 (panneau des journaux de la borne) : nom de l'événement d'un journal, et la raison quand
-- il est illisible.
--
-- kiosk_logs.event_id n'a pas de clé étrangère (LAB-325) : l'événement peut avoir été supprimé, ou
-- appartenir à une autre organisation (PC repris, borne d'un autre compte vue par le super-admin).
-- La RLS d'events cache les deux cas de la même façon ; le panneau doit afficher « Événement
-- supprimé » ou « Événement d'une autre organisation ».
--
-- kiosk_log_events(p_event_ids) renvoie, pour chaque id cité par un journal que l'appelant peut lire
-- (même règle que la RLS kiosk_logs_select) :
--   state 'visible'   : événement de l'appelant (propriétaire de l'organisation), avec son nom ;
--   state 'other_org' : l'événement existe mais n'est pas à lui (aucun nom ni autre champ) ;
--   state 'deleted'   : aucun événement ne porte cet id.
-- Un id qu'aucun journal lisible ne cite n'est pas renvoyé : la fonction ne sert pas à tester des
-- ids au hasard. 200 ids au plus par appel. Aucun droit pour anon.
-- Rejouable.

CREATE OR REPLACE FUNCTION public.kiosk_log_events(p_event_ids UUID[])
RETURNS TABLE (event_id UUID, state TEXT, name TEXT, client_name TEXT, start_date TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT DISTINCT x.id
      FROM unnest(COALESCE(p_event_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS x(id, n)
     WHERE x.id IS NOT NULL AND x.n <= 200
  ),
  cited AS (
    SELECT ids.id
      FROM ids
     WHERE auth.uid() IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.kiosk_logs k
          WHERE k.event_id = ids.id
            AND ((SELECT public.is_app_admin()) OR public.kiosk_log_visible(k.machine_id, k.created_at))
       )
  )
  SELECT c.id,
         CASE WHEN e.id IS NULL THEN 'deleted'
              WHEN o.owner_id = auth.uid() THEN 'visible'
              ELSE 'other_org' END,
         CASE WHEN o.owner_id = auth.uid() THEN e.name END,
         CASE WHEN o.owner_id = auth.uid() THEN e.client_name END,
         CASE WHEN o.owner_id = auth.uid() THEN e.start_date END
    FROM cited c
    LEFT JOIN public.events e ON e.id = c.id
    LEFT JOIN public.organizations o ON o.id = e.org_id;
$$;

REVOKE ALL ON FUNCTION public.kiosk_log_events(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_log_events(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
