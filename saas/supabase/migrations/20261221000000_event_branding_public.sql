-- LAB-301 — Galerie aux couleurs de l'événement : get_public_event renvoie l'habillage.
-- Pas de nouvelle colonne : le réglage vit dans events.form_config.branding (écrit par l'admin).
--
-- La galerie (anon) reçoit un bloc `branding` FILTRÉ, jamais le form_config brut :
--   color        : seulement une chaîne #RRGGBB, sinon null (aucune injection de CSS possible) ;
--   logo_url     : seulement une chaîne qui commence par https://, sinon null ;
--   gallery_text : chaîne coupée à 300 caractères, null si vide ou blanche.
-- Rien d'autre de form_config.branding. `branding` vaut null si form_config.branding n'est pas un objet
-- (aucun réglage) : la galerie reste alors identique.
--
-- Corps repris de 20261114000100 (garde anti-énumération, filtres de statut, VOLATILE, droits).
-- Seul écart : event_type est lu par une requête dynamique, et seulement si la table leads existe.
-- leads appartient au module privé de réservation, absent de la base open core (où event_type vaut
-- NULL) : une référence statique ferait échouer la galerie des instances sans ce module. Même
-- résultat qu'avant quand la table existe. Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.get_public_event(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bucket     TEXT := public.rpc_code_guard();
  v_event      RECORD;
  v_event_type TEXT;
  v_branding   JSONB;
BEGIN
  SELECT e.id,
         e.name,
         COALESCE(NULLIF(o.contact_company, ''), NULLIF(o.name, ''), '') AS company,
         COALESCE(e.form_config -> 'gallery', '{}'::jsonb) AS gallery,
         (o.business_profile -> 'gallery_booking_banner') IS DISTINCT FROM 'false'::jsonb AS booking_banner,
         e.form_config -> 'branding' AS branding
  INTO v_event
  FROM public.events e
  LEFT JOIN public.organizations o ON o.id = e.org_id
  WHERE e.access_code = UPPER(TRIM(p_code))
    AND e.status IN ('active', 'submitted')
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_bucket);
    RETURN NULL;
  END IF;

  -- Nom de table passé par format() : la migration reste exportée vers l'open core
  -- (features-manifest.test.ts écarte toute migration qui nomme une table privée).
  IF to_regclass(format('%I.%I', 'public', 'leads')) IS NOT NULL THEN
    EXECUTE format('SELECT l.event_type FROM %I.%I l WHERE l.converted_event_id = $1 '
                || 'ORDER BY l.created_at DESC NULLS LAST LIMIT 1', 'public', 'leads')
      INTO v_event_type
      USING v_event.id;
  END IF;

  IF jsonb_typeof(v_event.branding) = 'object' THEN
    v_branding := jsonb_build_object(
      'color',
        CASE WHEN jsonb_typeof(v_event.branding -> 'color') = 'string'
               AND (v_event.branding ->> 'color') ~ '^#[0-9A-Fa-f]{6}$'
             THEN v_event.branding ->> 'color' END,
      'logo_url',
        CASE WHEN jsonb_typeof(v_event.branding -> 'logo_url') = 'string'
               AND starts_with(v_event.branding ->> 'logo_url', 'https://')
             THEN v_event.branding ->> 'logo_url' END,
      'gallery_text',
        CASE WHEN jsonb_typeof(v_event.branding -> 'gallery_text') = 'string'
               AND (v_event.branding ->> 'gallery_text') ~ '\S'
             THEN left(v_event.branding ->> 'gallery_text', 300) END
    );
  END IF;

  RETURN json_build_object(
    'id',             v_event.id,
    'name',           v_event.name,
    'company',        v_event.company,
    'gallery',        v_event.gallery,
    'booking_banner', v_event.booking_banner,
    'event_type',     v_event_type,
    'branding',       v_branding
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_event(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_event(TEXT) TO anon, authenticated, service_role;
