-- Croix de la cloche des notifications de l'admin : retirer une notification ou une alerte de la liste.
--
-- On masque au lieu de supprimer : les fonctions serveur se servent des lignes existantes pour ne pas
-- prévenir deux fois (notifications : même lead_id et même type ; kiosk_alerts : alerte ouverte de la
-- même borne). Une vraie suppression ferait revenir la notification au passage suivant du cron.
--
-- notifications.dismissed_at : posée par l'admin (politique notifications_owner_update existante).
-- kiosk_alerts.dismissed_at  : posée par la RPC dismiss_kiosk_alert (pas de droit UPDATE sur la table) ;
--   l'alerte reste ouverte (resolved_at inchangé), visible dans l'onglet Alertes de Bornes et dans
--   « À faire » : seule la cloche la cache.
-- Rejouable.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE public.kiosk_alerts  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.dismiss_kiosk_alert(p_alert_id UUID)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.kiosk_alerts a
     SET dismissed_at = now()
   WHERE a.id = p_alert_id
     AND a.dismissed_at IS NULL
     AND auth.uid() IS NOT NULL
     AND a.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.dismiss_kiosk_alert(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_kiosk_alert(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
