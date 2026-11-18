-- LAB-325 (chantier « Journaux de la borne ») : chaque journal dit d'où il vient (borne, événement,
-- séance), et le serveur purge les journaux de plus de 90 jours.
--
-- 1. kiosk_logs.event_id et kiosk_logs.session_id (uuid, facultatifs, SANS clé étrangère : un
--    événement peut être supprimé après coup, et la borne peut envoyer un id que la base ne connaît
--    pas). Index (event_id, occurred_at DESC) pour les journaux d'un événement, et index session_id.
-- 2. kiosk_record_logs : même signature, mêmes règles (licence, 100 lignes, 600 sur 15 min,
--    troncatures, machine_id de la licence). Lit en plus les clés facultatives event_id et
--    session_id de chaque ligne. Un uuid invalide (ou une valeur qui n'est pas une chaîne) devient
--    null, sans refuser le lot : une borne qui ne les envoie pas continue de marcher.
-- 3. Purge quotidienne (cron SQL purge-kiosk-logs, 03:25 UTC) : supprime les journaux reçus ET datés
--    de plus de 90 jours (comme la borne, qui purge les siens à 90 jours). Les deux dates : une borne
--    à l'horloge fausse ne fait pas disparaître un journal qu'elle vient d'envoyer. Aucun lot de
--    nettoyage commun n'existe (une tâche par purge, modèle purge-kiosk-guest-responses).
--
-- Lecture inchangée : RLS kiosk_logs_select (is_app_admin() OR kiosk_log_visible(...)) ; le nom de
-- l'événement se lit dans events avec la RLS d'events (propriétaire de l'organisation, super-admin).
-- Rejouable. Vérification : supabase/tests/lab325_kiosk_logs_event_session_check.sql.

-- ── 1. Colonnes et index ────────────────────────────────────────────────────────────────────

ALTER TABLE public.kiosk_logs ADD COLUMN IF NOT EXISTS event_id   UUID NULL;
ALTER TABLE public.kiosk_logs ADD COLUMN IF NOT EXISTS session_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_kiosk_logs_event_occurred ON public.kiosk_logs (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_kiosk_logs_session_id ON public.kiosk_logs (session_id);

-- ── 2. RPC kiosk_record_logs ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kiosk_record_logs(p_machine_id TEXT, p_secret TEXT, p_logs JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count    INTEGER;
  v_bucket   TEXT;
  v_hits     INTEGER;
  v_inserted INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses
    WHERE machine_id = p_machine_id
      AND is_active
      AND retired_at IS NULL
      AND secret <> ''
      AND secret = p_secret
  ) THEN
    RAISE EXCEPTION 'kiosk_record_logs : licence kiosk invalide ou inactive' USING ERRCODE = '42501';
  END IF;

  IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' OR jsonb_array_length(p_logs) > 100 THEN
    RAISE EXCEPTION 'kiosk_record_logs : lot invalide (tableau de 100 lignes au plus)' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_logs);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_logs) AS l(item)
    WHERE jsonb_typeof(l.item) <> 'object'
       OR NOT COALESCE(l.item ->> 'id', '')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'kiosk_record_logs : ligne invalide (id uuid obligatoire)' USING ERRCODE = '22023';
  END IF;

  v_bucket := 'kiosk:logs:' || p_machine_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  SELECT count(*) INTO v_hits
    FROM (SELECT 1 FROM public.booking_rate_limits
           WHERE bucket = v_bucket AND created_at > now() - INTERVAL '15 minutes'
           LIMIT 600) recent;
  IF v_hits + v_count > 600 THEN
    RAISE SQLSTATE 'PT429' USING
      MESSAGE = 'kiosk_record_logs : trop de journaux envoyes, reessayer plus tard',
      HINT    = 'trop_de_requetes';
  END IF;

  INSERT INTO public.booking_rate_limits (bucket)
  SELECT v_bucket FROM generate_series(1, v_count);

  INSERT INTO public.kiosk_logs (id, machine_id, level, context, message, stack_trace, app_version, occurred_at,
                                 event_id, session_id)
  SELECT (l.item ->> 'id')::uuid,
         p_machine_id,
         CASE WHEN l.item ->> 'level' IN ('error', 'warning', 'info') THEN l.item ->> 'level' ELSE 'error' END,
         left(l.item ->> 'context', 200),
         left(COALESCE(l.item ->> 'message', ''), 2000),
         left(l.item ->> 'stack_trace', 4000),
         left(l.item ->> 'app_version', 50),
         LEAST(COALESCE((l.item ->> 'occurred_at')::timestamptz, now()), now() + INTERVAL '1 day'),
         CASE WHEN jsonb_typeof(l.item -> 'event_id') = 'string'
                   AND l.item ->> 'event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (l.item ->> 'event_id')::uuid END,
         CASE WHEN jsonb_typeof(l.item -> 'session_id') = 'string'
                   AND l.item ->> 'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (l.item ->> 'session_id')::uuid END
    FROM jsonb_array_elements(p_logs) AS l(item)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_record_logs(TEXT, TEXT, JSONB) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_record_logs(TEXT, TEXT, JSONB) TO anon;

-- ── 3. Purge quotidienne (SQL pur, modèle purge-kiosk-guest-responses) ──────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('purge-kiosk-logs');
EXCEPTION WHEN OTHERS THEN
  NULL; -- le job n'existait pas encore
END $$;

SELECT cron.schedule(
  'purge-kiosk-logs',
  '25 3 * * *',
  $$
  DELETE FROM public.kiosk_logs
   WHERE occurred_at < now() - INTERVAL '90 days'
     AND created_at < now() - INTERVAL '90 days'
  $$
);

NOTIFY pgrst, 'reload schema';
