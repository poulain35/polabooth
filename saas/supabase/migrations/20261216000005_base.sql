-- Migration de base du schéma (générée, ne pas modifier à la main).
-- Schéma complet de la suite ouverte : tables, fonctions, politiques RLS, droits, données de départ
-- (modèles vierges, articles d'aide), buckets et politiques Storage, tâches pg_cron.
-- Les tâches pg_cron qui appellent une fonction lisent les secrets Vault project_url et
-- service_role_key (créés par le script d'installation).
-- Remplace 135 migrations, jusqu'à 20261216000004 inclus. Les migrations suivantes s'appliquent par-dessus.


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE OR REPLACE FUNCTION "public"."build_event_report"("p_event_id" "uuid", "p_freeze" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_uid         UUID := auth.uid();
  v_event       public.events%ROWTYPE;
  v_profile     JSONB;
  v_report      public.event_reports%ROWTYPE;
  v_metrics     JSONB;
  v_kiosks      JSONB;
  v_blockers    TEXT[] := ARRAY[]::TEXT[];
  v_default_for TEXT;
  v_client_type TEXT;
BEGIN
  SELECT e.* INTO v_event
    FROM public.events e
    JOIN public.organizations o ON o.id = e.org_id
   WHERE e.id = p_event_id
     AND v_uid IS NOT NULL
     AND o.owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'build_event_report : evenement introuvable' USING ERRCODE = '42501';
  END IF;

  SELECT o.business_profile INTO v_profile FROM public.organizations o WHERE o.id = v_event.org_id;

  INSERT INTO public.event_reports (event_id) VALUES (p_event_id) ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO v_report FROM public.event_reports r WHERE r.event_id = p_event_id FOR UPDATE;

  v_metrics := public.event_report_metrics(p_event_id,
    CASE WHEN v_report.frozen_at IS NOT NULL THEN v_report.metrics END);
  IF v_metrics IS NULL OR v_metrics = '{}'::jsonb THEN
    RAISE EXCEPTION 'build_event_report : rien a presenter pour cet evenement' USING ERRCODE = '22023';
  END IF;

  v_kiosks := public.event_report_kiosks(p_event_id);
  IF jsonb_path_exists(v_kiosks, '$[*] ? (@.state == "pending")') THEN
    v_blockers := array_append(v_blockers, 'kiosk_pending');
  END IF;
  IF jsonb_path_exists(v_kiosks, '$[*] ? (@.state == "unknown")') THEN
    v_blockers := array_append(v_blockers, 'kiosk_unknown');
  END IF;
  IF jsonb_path_exists(v_kiosks, '$[*] ? (@.state == "not_seen")') THEN
    v_blockers := array_append(v_blockers, 'kiosk_not_seen');
  END IF;
  IF jsonb_array_length(v_kiosks) = 0 AND COALESCE((v_metrics ->> 'sessions')::BIGINT, 0) > 0 THEN
    v_blockers := array_append(v_blockers, 'kiosk_unidentified');
  END IF;
  IF NULLIF(btrim(COALESCE(v_event.client_email, '')), '') IS NULL THEN
    v_blockers := array_append(v_blockers, 'no_client_email');
  END IF;

  IF p_freeze THEN
    IF cardinality(v_blockers) > 0 THEN
      RAISE EXCEPTION 'build_event_report : envoi bloque (%)', array_to_string(v_blockers, ', ')
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.event_reports r SET
      metrics    = v_metrics,
      token      = CASE WHEN r.status = 'revoked' THEN gen_random_uuid() ELSE r.token END,
      status     = 'sent',
      frozen_at  = now(),
      expires_at = now() + INTERVAL '12 months'
     WHERE r.id = v_report.id
    RETURNING * INTO v_report;
  ELSIF v_report.status = 'draft' THEN
    UPDATE public.event_reports r SET metrics = v_metrics
     WHERE r.id = v_report.id
    RETURNING * INTO v_report;
  END IF;

  v_default_for := public.event_report_default_for(v_profile);
  v_client_type := NULL;

  RETURN jsonb_build_object(
    'report', public.event_report_payload(v_report.id) || jsonb_build_object(
      'id',                 v_report.id,
      'token',              v_report.token,
      'status',             v_report.status,
      'sent_at',            v_report.sent_at,
      'selected_photo_ids', to_jsonb(v_report.selected_photo_ids)),
    'metrics',     v_metrics,
    'kiosks',      v_kiosks,
    'blockers',    to_jsonb(v_blockers),
    'default_for', v_default_for,
    'proposed',    v_default_for = 'tous'
                   OR (v_default_for = 'professionnel' AND v_client_type IS NOT DISTINCT FROM 'professionnel')
  );
END;
$_$;

ALTER FUNCTION "public"."build_event_report"("p_event_id" "uuid", "p_freeze" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cron_health_snapshot"() RETURNS TABLE("jobid" bigint, "jobname" "text", "schedule" "text", "last_start_at" timestamp with time zone, "last_status" "text", "last_finished_at" timestamp with time zone, "last_return_message" "text", "http_request_id" bigint, "http_requested_at" timestamp with time zone, "http_timeout_ms" integer, "http_status_code" integer, "http_timed_out" boolean, "http_error" "text", "http_excerpt" "text", "http_responded_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
DECLARE
  -- Fenêtre de lecture : couvre largement les jobs quotidiens (un passage manqué compris).
  v_since TIMESTAMPTZ := NOW() - INTERVAL '2 days';
BEGIN
  UPDATE public.cron_http_calls c
     SET status_code      = r.status_code,
         timed_out        = r.timed_out,
         error_msg        = left(r.error_msg, 500),
         response_excerpt = left(r.content, 300),
         responded_at     = r.created
    FROM net._http_response r
   WHERE r.id = c.request_id
     AND c.responded_at IS NULL;

  DELETE FROM public.cron_http_calls c
   WHERE c.requested_at < NOW() - INTERVAL '35 days'
     AND c.request_id < (SELECT max(x.request_id) FROM public.cron_http_calls x WHERE x.job_name = c.job_name);

  RETURN QUERY
  WITH active AS (
    SELECT j.jobid FROM cron.job j WHERE j.active
  ), recent AS MATERIALIZED (
    SELECT d.jobid, d.start_time, d.status, d.end_time, d.return_message
      FROM cron.job_run_details d
     WHERE d.start_time >= v_since
       AND d.jobid IN (SELECT a.jobid FROM active a)
  ), fallback AS MATERIALIZED (
    SELECT a.jobid
      FROM active a
     WHERE NOT EXISTS (
       SELECT 1 FROM recent r WHERE r.jobid = a.jobid AND r.status IN ('succeeded', 'failed')
     )
  ), runs AS MATERIALIZED (
    SELECT r.jobid, r.start_time, r.status, r.end_time, r.return_message
      FROM recent r
     WHERE r.jobid NOT IN (SELECT f.jobid FROM fallback f)
    UNION ALL
    SELECT d.jobid, d.start_time, d.status, d.end_time, d.return_message
      FROM cron.job_run_details d
     WHERE EXISTS (SELECT 1 FROM fallback)
       AND d.jobid IN (SELECT f.jobid FROM fallback f)
  ), last_start AS (
    SELECT DISTINCT ON (r.jobid) r.jobid, r.start_time
      FROM runs r
     ORDER BY r.jobid, r.start_time DESC NULLS LAST
  ), last_done AS (
    SELECT DISTINCT ON (r.jobid) r.jobid, r.status, r.end_time, r.return_message
      FROM runs r
     WHERE r.status IN ('succeeded', 'failed')
     ORDER BY r.jobid, r.start_time DESC NULLS LAST
  )
  SELECT j.jobid,
         j.jobname::TEXT,
         j.schedule::TEXT,
         ls.start_time,
         ld.status::TEXT,
         ld.end_time,
         left(ld.return_message, 500),
         h.request_id,
         h.requested_at,
         h.timeout_ms,
         h.status_code,
         h.timed_out,
         h.error_msg,
         h.response_excerpt,
         h.responded_at
    FROM cron.job j
    LEFT JOIN last_start ls ON ls.jobid = j.jobid
    LEFT JOIN last_done  ld ON ld.jobid = j.jobid
    LEFT JOIN LATERAL (
      SELECT c.*
        FROM public.cron_http_calls c
       WHERE c.job_name = j.jobname
         AND (c.responded_at IS NOT NULL
              OR c.requested_at < NOW() - make_interval(secs => c.timeout_ms / 1000.0 + 120))
       ORDER BY c.requested_at DESC
       LIMIT 1
    ) h ON TRUE
   WHERE j.active
   ORDER BY j.jobname;
END;
$$;

ALTER FUNCTION "public"."cron_health_snapshot"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cron_http_post"("p_job" "text", "p_function" "text", "p_timeout_ms" integer DEFAULT 30000) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_url        TEXT := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url');
  v_key        TEXT := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key');
  v_request_id BIGINT;
BEGIN
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Secrets Vault project_url / service_role_key absents : % non appelée', p_function;
  END IF;

  v_request_id := net.http_post(
    url     := v_url || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );

  INSERT INTO public.cron_http_calls (request_id, job_name, timeout_ms)
  VALUES (v_request_id, p_job, p_timeout_ms);

  RETURN v_request_id;
END;
$$;

ALTER FUNCTION "public"."cron_http_post"("p_job" "text", "p_function" "text", "p_timeout_ms" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."current_owner_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT o.id
    FROM public.organizations o
   WHERE o.owner_id = auth.uid()
   ORDER BY o.created_at, o.id
   LIMIT 1;
$$;

ALTER FUNCTION "public"."current_owner_org_id"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."delete_service_key"("p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Acces refuse : reserve aux administrateurs de l''application' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_key_allowed(p_name) THEN
    RAISE EXCEPTION 'Cle inconnue : %', p_name USING ERRCODE = '22023';
  END IF;

  DELETE FROM vault.secrets s WHERE s.name = 'service_key:' || p_name;
  DELETE FROM public.service_keys k WHERE k.name = p_name;
END;
$$;

ALTER FUNCTION "public"."delete_service_key"("p_name" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."event_report_default_for"("p_business_profile" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
           WHEN p_business_profile #>> '{event_report,default_for}' IN ('tous', 'aucun')
             THEN p_business_profile #>> '{event_report,default_for}'
           ELSE 'professionnel'
         END;
$$;

ALTER FUNCTION "public"."event_report_default_for"("p_business_profile" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."event_report_kiosks"("p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH ev AS (
    SELECT e.id, e.photobooth_id, COALESCE(e.end_date, e.start_date, e.created_at) AS ended_at
      FROM public.events e
     WHERE e.id = p_event_id
  ), m AS (
    SELECT pl.machine_id FROM public.print_logs pl
     WHERE pl.event_id = p_event_id AND NULLIF(pl.machine_id, '') IS NOT NULL
    UNION
    SELECT r.machine_id FROM public.kiosk_guest_responses r WHERE r.event_id = p_event_id
    UNION
    SELECT c.machine_id FROM public.kiosk_photo_consents c WHERE c.event_id = p_event_id
  ), resolved AS (
    SELECT m.machine_id,
           COALESCE(
             (SELECT h.license_id
                FROM public.kiosk_license_machines h
               WHERE h.machine_id = m.machine_id
               ORDER BY (h.associated_at <= ev.ended_at
                         AND (h.replaced_at IS NULL OR h.replaced_at > ev.ended_at)) DESC NULLS LAST,
                        (h.replaced_at IS NULL) DESC,
                        h.associated_at DESC
               LIMIT 1),
             (SELECT l.id FROM public.kiosk_licenses l WHERE l.machine_id = m.machine_id)
           ) AS license_id
      FROM m CROSS JOIN ev
  ), k AS (
    SELECT ev.photobooth_id AS license_id, NULL::text AS machine_id
      FROM ev WHERE ev.photobooth_id IS NOT NULL
    UNION
    SELECT r.license_id, CASE WHEN r.license_id IS NULL THEN r.machine_id END
      FROM resolved r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'label',              COALESCE(NULLIF(l.label, ''), l.machine_name, l.machine_id, k.machine_id),
           'last_seen_at',       l.last_seen_at,
           'pending_uploads',    l.pending_uploads,
           'pending_uploads_at', l.pending_uploads_at,
           'state', CASE
             WHEN l.id IS NULL OR l.last_seen_at IS NULL OR l.last_seen_at < ev.ended_at THEN 'not_seen'
             WHEN l.pending_uploads IS NULL OR l.pending_uploads_at IS NULL
                  OR l.pending_uploads_at < ev.ended_at THEN 'unknown'
             WHEN l.pending_uploads > 0 THEN 'pending'
             ELSE 'ok'
           END)
         ORDER BY COALESCE(NULLIF(l.label, ''), l.machine_name, l.machine_id, k.machine_id)), '[]'::jsonb)
    FROM k
    CROSS JOIN ev
    LEFT JOIN public.kiosk_licenses l ON l.id = k.license_id;
$$;

ALTER FUNCTION "public"."event_report_kiosks"("p_event_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."event_report_metrics"("p_event_id" "uuid", "p_previous" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event      public.events%ROWTYPE;
  v_prev       JSONB := COALESCE(p_previous, '{}'::jsonb);
  v_kiosk      JSONB;
  v_buttons    JSONB;
  v_media_gone BOOLEAN;
  v_guest_gone BOOLEAN;
  v_metrics    JSONB := '{}'::jsonb;
  v_sessions   BIGINT;
  v_timed      BIGINT;
  v_hours      JSONB;
  v_rows       BIGINT;
  v_prints     BIGINT;
  v_qr         BIGINT;
  v_emails     BIGINT;
  v_opens      BIGINT;
  v_downloads  BIGINT;
  v_messages   BIGINT;
  v_seconds    BIGINT;
  v_responses  BIGINT;
  v_consents   BIGINT;
BEGIN
  SELECT * INTO v_event FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_kiosk   := COALESCE(v_event.form_config -> 'kiosk', '{}'::jsonb);
  v_buttons := COALESCE(v_kiosk #> '{result,buttons}', '{}'::jsonb);
  v_media_gone := v_event.media_purged_at IS NOT NULL
                  OR COALESCE(v_event.expires_at + INTERVAL '30 days' <= now(), false);
  v_guest_gone := COALESCE(
    public.guest_responses_purge_at(v_event.end_date, v_event.start_date, v_event.created_at) <= now(), false);

  -- Seances : une par dossier de seance (photos/{dossier}/{session_id}/{fichier}), a defaut la ligne.
  WITH s AS (
    SELECT COALESCE(lower(substring(p.storage_path FROM '^photos/[^/]+/([0-9A-Fa-f-]{36})/')), p.id::TEXT) AS session_key,
           min(p.captured_at) AS started_at
      FROM public.photos p
     WHERE p.event_id = p_event_id
       AND p.source = 'kiosk'
     GROUP BY 1
  )
  SELECT count(*),
         count(s.started_at),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', h.day, 'hour', h.hour, 'sessions', h.n)
                                    ORDER BY h.day, h.hour), '[]'::jsonb)
            FROM (SELECT to_char(s2.started_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day,
                         extract(hour FROM s2.started_at AT TIME ZONE 'Europe/Paris')::INT AS hour,
                         count(*) AS n
                    FROM s s2
                   WHERE s2.started_at IS NOT NULL
                   GROUP BY 1, 2) h)
    INTO v_sessions, v_timed, v_hours
    FROM s;

  IF v_media_gone AND v_prev ? 'sessions' THEN
    v_sessions := (v_prev ->> 'sessions')::BIGINT;
    v_metrics := v_metrics || jsonb_build_object('sessions', v_prev -> 'sessions');
    IF v_prev ? 'hours' THEN
      v_metrics := v_metrics || jsonb_build_object('hours', v_prev -> 'hours', 'timed_sessions', v_prev -> 'timed_sessions');
    END IF;
  ELSIF v_sessions > 0 OR v_prev ? 'sessions' THEN
    v_metrics := v_metrics || jsonb_build_object('sessions', v_sessions);
    IF v_timed > 0 THEN
      v_metrics := v_metrics || jsonb_build_object('hours', v_hours, 'timed_sessions', v_timed);
    END IF;
  END IF;

  -- Impressions : bloc masque sans ligne print_logs ni impression configuree (offre Digitale).
  SELECT count(*), COALESCE(sum(l.copies), 0) INTO v_rows, v_prints
    FROM public.print_logs l
   WHERE l.event_id = p_event_id;
  IF v_rows > 0
     OR v_prev ? 'prints'
     OR (v_sessions > 0
         AND ((v_kiosk #> '{result,auto_print}') = 'true'::jsonb
              OR (v_buttons #> '{print,enabled}') IS DISTINCT FROM 'false'::jsonb)) THEN
    v_metrics := v_metrics || jsonb_build_object('prints', v_prints);
  END IF;

  -- QR code (une photo comptee une fois) et e-mails envoyes depuis la borne.
  SELECT count(DISTINCT a.photo_id) FILTER (WHERE a.kind = 'qr_open'),
         count(*) FILTER (WHERE a.kind = 'kiosk_email')
    INTO v_qr, v_emails
    FROM public.event_activity a
   WHERE a.event_id = p_event_id;
  IF v_qr > 0
     OR v_prev ? 'qr_photos'
     OR (v_sessions > 0 AND (v_buttons #> '{qr,enabled}') IS DISTINCT FROM 'false'::jsonb) THEN
    v_metrics := v_metrics || jsonb_build_object('qr_photos', v_qr);
  END IF;
  -- Meme regle que la borne : bouton affiche si email.enabled ET result.buttons.email.enabled.
  IF v_emails > 0
     OR v_prev ? 'kiosk_emails'
     OR (v_sessions > 0
         AND (v_kiosk #> '{email,enabled}') = 'true'::jsonb
         AND (v_buttons #> '{email,enabled}') IS DISTINCT FROM 'false'::jsonb) THEN
    v_metrics := v_metrics || jsonb_build_object('kiosk_emails', v_emails);
  END IF;

  -- Galerie en ligne.
  SELECT count(*),
         COALESCE(sum(g.count) FILTER (WHERE g.type = 'view'), 0),
         COALESCE(sum(g.count) FILTER (WHERE g.type IN ('download', 'download_all', 'download_selection')), 0)
    INTO v_rows, v_opens, v_downloads
    FROM public.gallery_analytics g
   WHERE g.event_id = p_event_id;
  IF v_rows > 0
     OR v_prev ? 'gallery_opens'
     OR EXISTS (SELECT 1 FROM public.photos p WHERE p.event_id = p_event_id AND p.status = 'approved') THEN
    v_metrics := v_metrics || jsonb_build_object('gallery_opens', v_opens, 'downloads', v_downloads);
  END IF;

  -- Livre d'or audio : duree seulement si toutes les pistes en ont une.
  IF v_media_gone AND v_prev ? 'audio' THEN
    v_metrics := v_metrics || jsonb_build_object('audio', v_prev -> 'audio');
  ELSIF (v_event.form_config -> 'audio_enabled') = 'true'::jsonb OR v_prev ? 'audio' THEN
    SELECT count(*),
           CASE WHEN bool_or(t.duration_seconds IS NULL) THEN NULL ELSE COALESCE(sum(t.duration_seconds), 0) END
      INTO v_messages, v_seconds
      FROM public.audio_tracks t
     WHERE t.event_id = p_event_id;
    v_metrics := v_metrics || jsonb_build_object('audio', jsonb_build_object('messages', v_messages, 'seconds', v_seconds));
  END IF;

  -- Questionnaire : deux compteurs, jamais une reponse.
  IF v_guest_gone AND v_prev ? 'questionnaire' THEN
    v_metrics := v_metrics || jsonb_build_object('questionnaire', v_prev -> 'questionnaire');
  ELSE
    SELECT count(*), count(*) FILTER (WHERE r.marketing_consent)
      INTO v_responses, v_consents
      FROM public.kiosk_guest_responses r
     WHERE r.event_id = p_event_id;
    IF v_responses > 0
       OR v_prev ? 'questionnaire'
       OR (v_kiosk #> '{questionnaire,enabled}') = 'true'::jsonb THEN
      v_metrics := v_metrics || jsonb_build_object('questionnaire',
        jsonb_build_object('responses', v_responses, 'consents', v_consents));
    END IF;
  END IF;

  RETURN v_metrics;
END;
$$;

ALTER FUNCTION "public"."event_report_metrics"("p_event_id" "uuid", "p_previous" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."event_report_payload"("p_report_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
  SELECT jsonb_build_object(
    'name',           e.name,
    'start_date',     e.start_date,
    'end_date',       e.end_date,
    'company',        COALESCE(NULLIF(o.contact_company, ''), NULLIF(o.name, ''), ''),
    'frozen_at',      r.frozen_at,
    'expires_at',     r.expires_at,
    'metrics',        r.metrics,
    'photos',         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                'id', p.id, 'url', p.photo_url, 'thumbnail_url', p.thumbnail_url)
                              ORDER BY s.ord), '[]'::jsonb)
                         FROM unnest(r.selected_photo_ids) WITH ORDINALITY AS s(photo_id, ord)
                         JOIN public.photos p ON p.id = s.photo_id
                        WHERE p.event_id = r.event_id
                          AND p.status = 'approved'),
    'gallery_online', w.gallery,
    'audio_online',   w.audio,
    'access_code',    CASE WHEN w.gallery OR w.audio THEN e.access_code END,
    'review_url',     CASE WHEN (o.business_profile ->> 'google_review_url') ~ '^https://[^[:space:]]+$'
                           THEN o.business_profile ->> 'google_review_url' END,
    'client_type',    ld.client_type,
    'event_type',     ld.event_type
  )
  FROM public.event_reports r
  JOIN public.events e ON e.id = r.event_id
  LEFT JOIN public.organizations o ON o.id = e.org_id
  LEFT JOIN LATERAL (SELECT NULL::text AS client_type, NULL::text AS event_type) ld ON true
  CROSS JOIN LATERAL (
    SELECT
      (e.status <> 'archived' AND (e.expires_at IS NULL OR e.expires_at > now())
        AND EXISTS (SELECT 1 FROM public.photos p WHERE p.event_id = e.id AND p.status = 'approved')) AS gallery,
      (e.status <> 'archived' AND (e.expires_at IS NULL OR e.expires_at > now())
        AND (e.form_config -> 'audio_enabled') = 'true'::jsonb
        AND EXISTS (SELECT 1 FROM public.audio_tracks t WHERE t.event_id = e.id)) AS audio
  ) w
  WHERE r.id = p_report_id;
$_$;

ALTER FUNCTION "public"."event_report_payload"("p_report_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."event_reports_guard_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'sent' AND NEW.status = 'revoked') THEN
    RAISE EXCEPTION 'event_reports : changement de statut refuse' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."event_reports_guard_update"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."feature_catalog"() RETURNS TABLE("pos" integer, "id" "text", "is_core" boolean, "default_enabled" boolean, "depends_on" "text"[])
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT c.pos, c.id, c.is_core, c.default_enabled, c.depends_on::TEXT[]
  FROM (VALUES
    (1,  'core',            true,  true,  '{}'),
    (2,  'templates',       true,  true,  '{}'),
    (3,  'client_design',   false, true,  '{templates}'),
    (4,  'gallery',         false, true,  '{}'),
    (5,  'guest_form',      false, true,  '{}'),
    (6,  'event_report',    false, true,  '{}'),
    (7,  'delivery_email',  false, true,  '{gallery}'),
    (8,  'kiosk_alerts',    false, true,  '{}'),
    (9,  'planning',        false, true,  '{}'),
    (10, 'google_calendar', false, true,  '{planning}'),
    (11, 'ai_visuals',      false, true,  '{templates}'),
    (12, 'help',            false, true,  '{}'),
    (13, 'assistant',       false, true,  '{help}'),
    (14, 'booking',         false, false, '{client_design}'),
    (15, 'prospects',       false, false, '{}'),
    (16, 'invoicing',       false, false, '{booking}'),
    (17, 'audio_guestbook', false, false, '{}')
  ) AS c(pos, id, is_core, default_enabled, depends_on);
$$;

ALTER FUNCTION "public"."feature_catalog"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."feature_flags_enabled"("p_features" "jsonb", "p_feature" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_core    BOOLEAN;
  v_default BOOLEAN;
  v_deps    TEXT[];
  v_stored  JSONB;
  v_dep     TEXT;
BEGIN
  SELECT c.is_core, c.default_enabled, c.depends_on
    INTO v_core, v_default, v_deps
    FROM public.feature_catalog() c
   WHERE c.id = p_feature;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT v_core THEN
    v_stored := p_features -> p_feature;
    IF jsonb_typeof(v_stored) = 'boolean' THEN
      IF NOT v_stored::BOOLEAN THEN
        RETURN false;
      END IF;
    ELSIF NOT v_default THEN
      RETURN false;
    END IF;
  END IF;

  FOREACH v_dep IN ARRAY v_deps LOOP
    IF NOT public.feature_flags_enabled(p_features, v_dep) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER FUNCTION "public"."feature_flags_enabled"("p_features" "jsonb", "p_feature" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_event_form_enabled"("p_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bucket TEXT := public.rpc_code_guard();
  v_result BOOLEAN;
  v_org_id UUID;
BEGIN
  SELECT COALESCE((e.form_config ->> 'enabled')::boolean, false), e.org_id
  INTO v_result, v_org_id
  FROM public.events e
  WHERE e.access_code = p_code
    AND e.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_bucket);
    RETURN v_result;
  END IF;

  IF NOT public.org_feature_enabled(v_org_id, 'guest_form') THEN
    RAISE EXCEPTION 'fonctionnalite_desactivee' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION "public"."get_event_form_enabled"("p_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_event_report"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_bucket TEXT := public.rpc_code_guard();
  v_id     UUID;
  v_org_id UUID;
BEGIN
  IF btrim(p_token) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT r.id, e.org_id INTO v_id, v_org_id
      FROM public.event_reports r
      JOIN public.events e ON e.id = r.event_id
     WHERE r.token = lower(btrim(p_token))::UUID
       AND r.status = 'sent'
       AND r.frozen_at IS NOT NULL
       AND r.expires_at > now();
  END IF;

  IF v_id IS NULL THEN
    PERFORM public.rpc_code_failed(v_bucket);
    RETURN NULL;
  END IF;

  IF NOT public.org_feature_enabled(v_org_id, 'event_report') THEN
    RAISE EXCEPTION 'fonctionnalite_desactivee' USING ERRCODE = 'PT404';
  END IF;

  RETURN public.event_report_payload(v_id);
END;
$_$;

ALTER FUNCTION "public"."get_event_report"("p_token" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_global_form_config"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT form_config FROM organizations LIMIT 1;
$$;

ALTER FUNCTION "public"."get_global_form_config"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_org_contact_by_code"("p_code" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bucket TEXT := public.rpc_code_guard();
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'contact_company', COALESCE(o.contact_company, o.name),
    'contact_phone',   o.contact_phone,
    'contact_email',   o.contact_email
  )
  INTO v_result
  FROM public.events e
  JOIN public.organizations o ON o.id = e.org_id
  WHERE e.access_code = UPPER(TRIM(p_code))
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_bucket);
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION "public"."get_org_contact_by_code"("p_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_org_contact_by_event"("p_event_id" "uuid") RETURNS json
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT json_build_object(
    'contact_company', COALESCE(o.contact_company, o.name),
    'contact_phone',   o.contact_phone,
    'contact_email',   o.contact_email,
    'logo_url',        o.logo_url
  )
  FROM public.events e
  JOIN public.organizations o ON o.id = e.org_id
  WHERE e.id = p_event_id
  LIMIT 1;
$$;

ALTER FUNCTION "public"."get_org_contact_by_event"("p_event_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_event"("p_code" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bucket TEXT := public.rpc_code_guard();
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',             e.id,
    'name',           e.name,
    'company',        COALESCE(NULLIF(o.contact_company, ''), NULLIF(o.name, ''), ''),
    'gallery',        COALESCE(e.form_config -> 'gallery', '{}'::jsonb),
    'booking_banner', (o.business_profile -> 'gallery_booking_banner') IS DISTINCT FROM 'false'::jsonb,
    'event_type',     NULL::text
  )
  INTO v_result
  FROM public.events e
  LEFT JOIN public.organizations o ON o.id = e.org_id
  WHERE e.access_code = UPPER(TRIM(p_code))
    AND e.status IN ('active', 'submitted')
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_bucket);
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION "public"."get_public_event"("p_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_photos"("p_code" "text", "p_limit" integer DEFAULT NULL::integer) RETURNS TABLE("id" "uuid", "photo_url" "text", "thumbnail_url" "text", "storage_path" "text", "share_url" "text", "source" "text", "width" integer, "height" integer, "created_at" timestamp with time zone, "media_type" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.access_code = UPPER(TRIM(p_code))
       AND e.status IN ('active', 'submitted')
       AND NOT public.org_feature_enabled(e.org_id, 'gallery')
  ) THEN
    RAISE EXCEPTION 'fonctionnalite_desactivee' USING ERRCODE = 'PT404';
  END IF;

  RETURN QUERY
  SELECT p.id, p.photo_url, p.thumbnail_url, p.storage_path, p.share_url, p.source,
         p.width, p.height, p.created_at, p.media_type
  FROM public.events e
  JOIN public.photos p ON p.event_id = e.id
  WHERE e.access_code = UPPER(TRIM(p_code))
    AND e.status IN ('active', 'submitted')
    AND p.status = 'approved'
  ORDER BY p.created_at ASC, p.id ASC
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION "public"."get_public_photos"("p_code" "text", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_service_key"("p_name" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT d.decrypted_secret
  FROM vault.decrypted_secrets d
  WHERE public.service_key_allowed(p_name)
    AND d.name = 'service_key:' || p_name
  LIMIT 1;
$$;

ALTER FUNCTION "public"."get_service_key"("p_name" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."guest_responses_purge_at"("p_end_date" timestamp with time zone, "p_start_date" timestamp with time zone, "p_answered_at" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce(p_end_date, p_start_date, p_answered_at) + interval '30 days';
$$;

ALTER FUNCTION "public"."guest_responses_purge_at"("p_end_date" timestamp with time zone, "p_start_date" timestamp with time zone, "p_answered_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."guest_responses_summary"() RETURNS TABLE("event_id" "uuid", "response_count" bigint, "consent_count" bigint, "last_received_at" timestamp with time zone, "purge_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT r.event_id,
         count(*),
         count(*) FILTER (WHERE r.marketing_consent),
         max(r.received_at),
         public.guest_responses_purge_at(e.end_date, e.start_date, min(r.answered_at))
    FROM public.kiosk_guest_responses r
    JOIN public.events e ON e.id = r.event_id
   GROUP BY r.event_id, e.end_date, e.start_date;
$$;

ALTER FUNCTION "public"."guest_responses_summary"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_app_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid());
$$;

ALTER FUNCTION "public"."is_app_admin"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_ack_event_request"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid", "p_error" "text" DEFAULT NULL::"text", "p_requested_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id    uuid;
  v_error text := left(NULLIF(btrim(COALESCE(p_error, '')), ''), 500);
BEGIN
  SELECT l.id INTO v_id
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND l.secret <> ''
     AND l.secret = p_secret
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_ack_event_request : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  UPDATE public.kiosk_licenses l SET
    event_push_received_at = COALESCE(l.event_push_received_at, now()),
    event_push_applied_at  = CASE WHEN v_error IS NULL THEN now() END,
    event_push_error       = v_error
  WHERE l.id = v_id
    AND l.event_push_id = p_event_id
    AND l.event_push_requested_at IS NOT NULL
    AND (p_requested_at IS NULL OR l.event_push_requested_at = p_requested_at)
    AND l.event_push_applied_at IS NULL
    AND l.event_push_error IS NULL;

  RETURN FOUND;
END;
$$;

ALTER FUNCTION "public"."kiosk_ack_event_request"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid", "p_error" "text", "p_requested_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_cancel_event_request"("p_license_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_push    uuid;
  v_applied timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kiosk_cancel_event_request : connexion requise' USING ERRCODE = '42501';
  END IF;

  SELECT l.event_push_id, l.event_push_applied_at INTO v_push, v_applied
    FROM public.kiosk_licenses l
   WHERE l.id = p_license_id
     AND (public.is_app_admin()
          OR l.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = v_uid))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borne introuvable dans votre compte.' USING ERRCODE = '42501';
  END IF;

  IF v_push IS NOT NULL AND v_applied IS NOT NULL THEN
    RAISE EXCEPTION 'La borne a déjà chargé cet événement : envoyez-en un autre pour le remplacer.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.kiosk_licenses l SET
    event_push_id           = NULL,
    event_push_requested_at = NULL,
    event_push_received_at  = NULL,
    event_push_applied_at   = NULL,
    event_push_error        = NULL
  WHERE l.id = p_license_id;

  RETURN jsonb_build_object(
    'event_push_id',           NULL,
    'event_push_requested_at', NULL,
    'event_push_received_at',  NULL,
    'event_push_applied_at',   NULL,
    'event_push_error',        NULL);
END;
$$;

ALTER FUNCTION "public"."kiosk_cancel_event_request"("p_license_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_check_license"("p_machine_id" "text", "p_secret" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE((
    SELECT is_active
    FROM public.kiosk_licenses
    WHERE machine_id = p_machine_id
      AND retired_at IS NULL
      AND secret <> ''
      AND secret = p_secret
  ), false);
$$;

ALTER FUNCTION "public"."kiosk_check_license"("p_machine_id" "text", "p_secret" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_get_admin_pin"("p_machine_id" "text", "p_secret" "text") RETURNS TABLE("pin_hash" "text", "pin_set_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT l.id INTO v_id
  FROM public.kiosk_licenses l
  WHERE l.machine_id = p_machine_id
    AND l.is_active
    AND l.secret <> ''
    AND l.secret = p_secret
    AND l.admin_pin_hash IS NOT NULL
    AND l.admin_pin_pushed_at IS NOT NULL
    AND l.admin_pin_pushed_at >= l.admin_pin_set_at;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.kiosk_licenses l
  SET admin_pin_received_at = now()
  WHERE l.id = v_id
    AND (l.admin_pin_received_at IS NULL OR l.admin_pin_pushed_at > l.admin_pin_received_at);

  RETURN QUERY
  SELECT l.admin_pin_hash, l.admin_pin_set_at
  FROM public.kiosk_licenses l
  WHERE l.id = v_id;
END;
$$;

ALTER FUNCTION "public"."kiosk_get_admin_pin"("p_machine_id" "text", "p_secret" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_get_approved_design"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id     uuid;
  v_org    uuid;
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

  -- Événement d'un autre compte (ou borne sans compte) : NULL, comme sans design.
  SELECT json_build_object(
    'id',            d.id,
    'format',        d.format,
    'canvas_json',   d.canvas_json,
    'final_png_url', d.final_png_url
  )
  INTO v_design
  FROM public.client_designs d
  JOIN public.events e ON e.id = d.event_id
  WHERE d.event_id = p_event_id
    AND d.status = 'approved'
    AND e.org_id = v_org
  LIMIT 1;

  RETURN v_design;
END;
$$;

ALTER FUNCTION "public"."kiosk_get_approved_design"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_get_event"("p_code" "text", "p_machine_id" "text", "p_secret" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bucket TEXT := public.rpc_code_guard();
  v_org    UUID;
  v_result JSON;
BEGIN
  SELECT l.org_id INTO v_org
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND l.secret <> ''
     AND l.secret = p_secret;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'kiosk_get_event : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'id',          e.id,
    'org_id',      e.org_id,
    'name',        e.name,
    'access_code', e.access_code,
    'start_date',  e.start_date,
    'end_date',    e.end_date,
    'form_config', json_build_object('kiosk', CASE
      WHEN public.org_feature_enabled(e.org_id, 'guest_form') THEN e.form_config -> 'kiosk'
      ELSE (e.form_config -> 'kiosk') - 'questionnaire'
    END)
  )
  INTO v_result
  FROM public.events e
  WHERE e.access_code = UPPER(TRIM(p_code))
    AND e.status IN ('active', 'submitted')
    AND e.org_id = v_org
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_bucket);
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION "public"."kiosk_get_event"("p_code" "text", "p_machine_id" "text", "p_secret" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_get_event_request"("p_machine_id" "text", "p_secret" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id        uuid;
  v_org       uuid;
  v_push      uuid;
  v_requested timestamptz;
  v_applied   timestamptz;
  v_error     text;
  v_event     json;
BEGIN
  SELECT l.id, l.org_id, l.event_push_id, l.event_push_requested_at, l.event_push_applied_at, l.event_push_error
    INTO v_id, v_org, v_push, v_requested, v_applied, v_error
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND l.secret <> ''
     AND l.secret = p_secret
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_get_event_request : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  IF v_push IS NULL OR v_requested IS NULL OR v_applied IS NOT NULL OR v_error IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'id',          e.id,
    'org_id',      e.org_id,
    'name',        e.name,
    'access_code', e.access_code,
    'start_date',  e.start_date,
    'end_date',    e.end_date,
    'form_config', json_build_object('kiosk', CASE
      WHEN public.org_feature_enabled(e.org_id, 'guest_form') THEN e.form_config -> 'kiosk'
      ELSE (e.form_config -> 'kiosk') - 'questionnaire'
    END)
  )
  INTO v_event
  FROM public.events e
  WHERE e.id = v_push
    AND e.status IN ('active', 'submitted')
    AND e.org_id = v_org;

  IF v_event IS NULL THEN
    UPDATE public.kiosk_licenses l
       SET event_push_error = 'Événement indisponible : archivé, ou la borne a changé de compte.'
     WHERE l.id = v_id;
    RETURN NULL;
  END IF;

  UPDATE public.kiosk_licenses l
     SET event_push_received_at = now()
   WHERE l.id = v_id AND l.event_push_received_at IS NULL;

  RETURN json_build_object('requested_at', v_requested, 'event', v_event);
END;
$$;

ALTER FUNCTION "public"."kiosk_get_event_request"("p_machine_id" "text", "p_secret" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_get_update_request"("p_machine_id" "text", "p_secret" "text") RETURNS TABLE("version" "text", "exe_url" "text", "sha256" "text", "requested_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT l.id INTO v_id
  FROM public.kiosk_licenses l
  WHERE l.machine_id = p_machine_id
    AND l.is_active
    AND l.secret <> ''
    AND l.secret = p_secret
    AND l.update_requested_version IS NOT NULL
    AND l.update_requested_at IS NOT NULL
    AND (l.update_failed_at IS NULL OR l.update_failed_at < l.update_requested_at)
    AND l.app_version IS DISTINCT FROM l.update_requested_version;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.kiosk_licenses l
  SET update_received_at = now()
  WHERE l.id = v_id
    AND (l.update_received_at IS NULL OR l.update_received_at < l.update_requested_at);

  RETURN QUERY
  SELECT r.version, r.exe_url, r.sha256, l.update_requested_at
  FROM public.kiosk_licenses l
  JOIN public.kiosk_releases r ON r.version = l.update_requested_version
  WHERE l.id = v_id;
END;
$$;

ALTER FUNCTION "public"."kiosk_get_update_request"("p_machine_id" "text", "p_secret" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_heartbeat"("p_machine_id" "text", "p_secret" "text", "p_app_version" "text", "p_printer_status" "text", "p_printer_name" "text", "p_pending_uploads" integer DEFAULT NULL::integer, "p_camera_status" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.kiosk_licenses SET
    last_seen_at       = now(),
    app_version        = COALESCE(p_app_version, app_version),
    printer_status     = p_printer_status,
    printer_name       = NULLIF(p_printer_name, ''),
    printer_status_at  = now(),
    pending_uploads    = CASE WHEN p_pending_uploads IS NULL THEN NULL ELSE GREATEST(p_pending_uploads, 0) END,
    pending_uploads_at = CASE WHEN p_pending_uploads IS NULL THEN NULL ELSE now() END,
    camera_status      = CASE WHEN p_camera_status IN ('ok', 'disconnected') THEN p_camera_status ELSE camera_status END,
    camera_status_at   = CASE WHEN p_camera_status IN ('ok', 'disconnected') THEN now() ELSE camera_status_at END
  WHERE machine_id = p_machine_id
    AND retired_at IS NULL
    AND secret <> ''
    AND secret = p_secret;
END;
$$;

ALTER FUNCTION "public"."kiosk_heartbeat"("p_machine_id" "text", "p_secret" "text", "p_app_version" "text", "p_printer_status" "text", "p_printer_name" "text", "p_pending_uploads" integer, "p_camera_status" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_licenses_clear_event_push"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (NEW.retired_at IS NOT NULL AND OLD.retired_at IS NULL)
     OR NEW.machine_id IS DISTINCT FROM OLD.machine_id THEN
    NEW.event_push_id           := NULL;
    NEW.event_push_requested_at := NULL;
    NEW.event_push_received_at  := NULL;
    NEW.event_push_applied_at   := NULL;
    NEW.event_push_error        := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."kiosk_licenses_clear_event_push"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_licenses_guard_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      IF current_user = 'anon' THEN
        RAISE EXCEPTION 'Seul le super-admin peut deplacer une borne vers un autre compte.' USING ERRCODE = '42501';
      END IF;
      IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Seul le super-admin peut deplacer une borne vers un autre compte.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.is_active AND NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'Une borne retiree se reactive en l''associant de nouveau.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."kiosk_licenses_guard_update"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_licenses_track_machine"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.machine_id IS NOT NULL THEN
      INSERT INTO public.kiosk_license_machines (license_id, machine_id, machine_name)
      VALUES (NEW.id, NEW.machine_id, NEW.machine_name);
    END IF;
  ELSIF NEW.machine_id IS DISTINCT FROM OLD.machine_id THEN
    UPDATE public.kiosk_license_machines SET replaced_at = now()
     WHERE license_id = NEW.id AND replaced_at IS NULL;
    IF NEW.machine_id IS NOT NULL THEN
      INSERT INTO public.kiosk_license_machines (license_id, machine_id, machine_name)
      VALUES (NEW.id, NEW.machine_id, NEW.machine_name);
    END IF;
  ELSIF NEW.machine_name IS DISTINCT FROM OLD.machine_name THEN
    UPDATE public.kiosk_license_machines SET machine_name = NEW.machine_name
     WHERE license_id = NEW.id AND replaced_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION "public"."kiosk_licenses_track_machine"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_list_accounts"() RETURNS TABLE("id" "uuid", "name" "text", "kiosk_limit" integer, "owner_id" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kiosk_list_accounts : connexion requise' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name::text, o.kiosk_limit, o.owner_id
      FROM public.organizations o
     WHERE public.is_app_admin() OR o.owner_id = v_uid
     ORDER BY o.name;
END;
$$;

ALTER FUNCTION "public"."kiosk_list_accounts"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_log_visible"("p_machine_id" "text", "p_created_at" timestamp with time zone) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.kiosk_license_machines h
      JOIN public.kiosk_licenses l ON l.id = h.license_id
      JOIN public.organizations o ON o.id = l.org_id
     WHERE h.machine_id = p_machine_id
       AND o.owner_id = auth.uid()
       -- Borne d'abord vue sans licence : ses journaux d'avant l'association restent lisibles, mais
       -- pas ceux d'un PC repris d'un autre compte (ligne d'historique d'une autre licence).
       AND p_created_at >= CASE
             WHEN EXISTS (SELECT 1 FROM public.kiosk_license_machines prev
                           WHERE prev.machine_id = h.machine_id
                             AND prev.license_id <> h.license_id
                             AND prev.associated_at < h.associated_at)
             THEN h.associated_at
             ELSE '-infinity'::timestamptz
           END
       AND p_created_at < COALESCE(h.replaced_at, 'infinity'::timestamptz)
  );
$$;

ALTER FUNCTION "public"."kiosk_log_visible"("p_machine_id" "text", "p_created_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_pairing_approve"("p_code" "text", "p_label" "text", "p_replace_license_id" "uuid" DEFAULT NULL::"uuid", "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_admin     BOOLEAN;
  v_bucket    TEXT;
  v_label     TEXT := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_row       public.kiosk_pairings%ROWTYPE;
  v_org       public.organizations%ROWTYPE;
  v_pc        public.kiosk_licenses%ROWTYPE;
  v_pc_found  BOOLEAN;
  v_rep       public.kiosk_licenses%ROWTYPE;
  v_target    UUID;
  v_target_label TEXT;
  v_detach    UUID;
  v_counts    BOOLEAN := true;
  v_mode      TEXT := 'new';
  v_used      INTEGER;
  v_secret    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kiosk_pairing_approve : connexion requise' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_app_admin();

  IF char_length(COALESCE(v_label, '')) > 80 THEN
    RAISE EXCEPTION 'kiosk_pairing_approve : nom de borne trop long (80 caracteres au plus)' USING ERRCODE = '22023';
  END IF;

  v_bucket := 'kiosk:pairing-code-fail:user:' || v_uid::text;
  IF public.kiosk_rate_limited(v_bucket, 10) THEN
    RAISE SQLSTATE 'PT429' USING
      MESSAGE = 'Trop de codes faux. Reessayez dans 15 minutes.', HINT = 'trop_de_requetes';
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id FOR UPDATE;
    IF NOT FOUND OR (NOT v_admin AND v_org.owner_id <> v_uid) THEN
      RAISE EXCEPTION 'kiosk_pairing_approve : seul le super-admin peut choisir un autre compte' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT * INTO v_org FROM public.organizations
     WHERE owner_id = v_uid
     ORDER BY created_at, id
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'kiosk_pairing_approve : aucun compte pour cet utilisateur' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.kiosk_pairings
   WHERE code = public.kiosk_pairing_normalize_code(p_code)
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.booking_rate_limits (bucket) VALUES (v_bucket);
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.status IN ('approved', 'delivered') THEN
    RETURN jsonb_build_object('status', 'used');
  END IF;
  IF v_row.status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT * INTO v_pc FROM public.kiosk_licenses WHERE machine_id = v_row.machine_id FOR UPDATE;
  v_pc_found := FOUND;

  IF p_replace_license_id IS NOT NULL THEN
    SELECT * INTO v_rep FROM public.kiosk_licenses WHERE id = p_replace_license_id FOR UPDATE;
    IF NOT FOUND OR v_rep.org_id <> v_org.id THEN
      RAISE EXCEPTION 'kiosk_pairing_approve : borne a remplacer introuvable dans ce compte' USING ERRCODE = '42501';
    END IF;
    IF v_pc_found AND v_pc.id <> v_rep.id THEN
      IF v_pc.retired_at IS NOT NULL THEN
        v_detach := v_pc.id;
      ELSIF v_pc.org_id <> v_org.id AND NOT v_admin THEN
        RETURN jsonb_build_object('status', 'other_account');
      ELSE
        RETURN jsonb_build_object('status', 'pc_in_use', 'license_id', v_pc.id, 'label', v_pc.label);
      END IF;
    END IF;
    v_target := v_rep.id;
    v_target_label := v_rep.label;
    v_counts := v_rep.retired_at IS NOT NULL;
    v_mode := CASE WHEN v_pc_found AND v_pc.id = v_rep.id THEN 'resumed' ELSE 'replaced' END;
  ELSIF v_pc_found THEN
    IF v_pc.org_id = v_org.id THEN
      v_target := v_pc.id;
      v_target_label := v_pc.label;
      v_counts := v_pc.retired_at IS NOT NULL;
      v_mode := 'resumed';
    ELSIF v_pc.retired_at IS NOT NULL THEN
      v_detach := v_pc.id;
    ELSIF v_admin THEN
      v_target := v_pc.id;
      v_target_label := v_pc.label;
      v_mode := 'moved';
    ELSE
      RETURN jsonb_build_object('status', 'other_account');
    END IF;
  END IF;

  IF v_counts AND v_org.kiosk_limit IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM public.kiosk_licenses l
     WHERE l.org_id = v_org.id AND l.retired_at IS NULL AND l.id IS DISTINCT FROM v_target;
    IF v_used >= v_org.kiosk_limit THEN
      RETURN jsonb_build_object('status', 'limit_reached', 'count', v_used, 'limit', v_org.kiosk_limit);
    END IF;
  END IF;

  IF v_detach IS NOT NULL THEN
    UPDATE public.kiosk_licenses SET machine_id = NULL WHERE id = v_detach;
  END IF;

  v_label := COALESCE(v_label, NULLIF(v_target_label, ''), v_row.machine_name, v_row.machine_id);
  v_secret := 'ks_' || replace(gen_random_uuid()::text, '-', '');

  IF v_target IS NULL THEN
    INSERT INTO public.kiosk_licenses (machine_id, machine_name, app_version, label, org_id, is_active, secret, activated_at)
    VALUES (v_row.machine_id, v_row.machine_name, v_row.app_version, v_label, v_org.id, true, v_secret, now())
    RETURNING id INTO v_target;
  ELSE
    UPDATE public.kiosk_licenses SET
      machine_id   = v_row.machine_id,
      machine_name = v_row.machine_name,
      app_version  = COALESCE(v_row.app_version, app_version),
      label        = v_label,
      org_id       = v_org.id,
      is_active    = true,
      retired_at   = NULL,
      secret       = v_secret,
      activated_at = now()
    WHERE id = v_target;
  END IF;

  -- Une approbation plus ancienne de la même borne, pas encore remise, ne doit plus livrer de secret.
  UPDATE public.kiosk_pairings SET status = 'cancelled', secret_to_deliver = NULL
   WHERE license_id = v_target AND status = 'approved' AND id <> v_row.id;

  UPDATE public.kiosk_pairings SET
    status            = 'approved',
    org_id            = v_org.id,
    license_id        = v_target,
    approved_by       = v_uid,
    approved_at       = now(),
    secret_to_deliver = v_secret
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'status',     'ok',
    'mode',       v_mode,
    'license_id', v_target,
    'label',      v_label,
    'org_id',     v_org.id,
    'org_name',   v_org.name);
END;
$$;

ALTER FUNCTION "public"."kiosk_pairing_approve"("p_code" "text", "p_label" "text", "p_replace_license_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_pairing_lookup"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_admin   BOOLEAN;
  v_bucket  TEXT;
  v_limited BOOLEAN;
  v_row     public.kiosk_pairings%ROWTYPE;
  v_found   BOOLEAN;
  v_mine    BOOLEAN;
  v_lic     RECORD;
  v_result  JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kiosk_pairing_lookup : connexion requise' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_app_admin();

  v_bucket  := 'kiosk:pairing-code-fail:user:' || v_uid::text;
  v_limited := public.kiosk_rate_limited(v_bucket, 10);

  SELECT * INTO v_row FROM public.kiosk_pairings
   WHERE code = public.kiosk_pairing_normalize_code(p_code)
   ORDER BY created_at DESC
   LIMIT 1;
  v_found := FOUND;

  -- Limite atteinte : seule une association approuvée par l'appelant reste consultable.
  IF v_limited AND NOT (v_found AND v_row.approved_by IS NOT DISTINCT FROM v_uid AND v_row.approved_by IS NOT NULL) THEN
    RAISE SQLSTATE 'PT429' USING
      MESSAGE = 'Trop de codes faux. Reessayez dans 15 minutes.', HINT = 'trop_de_requetes';
  END IF;

  IF NOT v_found THEN
    INSERT INTO public.booking_rate_limits (bucket) VALUES (v_bucket);
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_mine := v_admin OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_row.org_id AND o.owner_id = v_uid);

  IF v_row.status = 'pending' THEN
    v_result := jsonb_build_object(
      'status',       CASE WHEN v_row.expires_at <= now() THEN 'expired' ELSE 'pending' END,
      'machine_name', v_row.machine_name,
      'app_version',  v_row.app_version,
      'expires_at',   v_row.expires_at);

    -- PC déjà connu dans un compte de l'appelant : le SaaS préremplit le nom de la borne.
    SELECT l.id, l.label, l.retired_at INTO v_lic
      FROM public.kiosk_licenses l
     WHERE l.machine_id = v_row.machine_id
       AND (v_admin OR l.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = v_uid));
    IF FOUND THEN
      v_result := v_result || jsonb_build_object('license', jsonb_build_object(
        'id', v_lic.id, 'label', v_lic.label, 'retired', v_lic.retired_at IS NOT NULL));
    END IF;
    RETURN v_result;
  END IF;

  v_result := jsonb_build_object('status', v_row.status);
  IF v_mine THEN
    v_result := v_result || jsonb_build_object(
      'machine_name', v_row.machine_name,
      'app_version',  v_row.app_version,
      'license_id',   v_row.license_id,
      'approved_at',  v_row.approved_at,
      'delivered_at', v_row.delivered_at);
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION "public"."kiosk_pairing_lookup"("p_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_pairing_new_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code  TEXT := '';
  v_bytes BYTEA;
  v_byte  INTEGER;
  i       INTEGER;
BEGIN
  WHILE char_length(v_code) < 6 LOOP
    v_bytes := uuid_send(gen_random_uuid());
    FOREACH i IN ARRAY ARRAY[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15] LOOP
      v_byte := get_byte(v_bytes, i);
      IF v_byte < 240 AND char_length(v_code) < 6 THEN
        v_code := v_code || substr(v_alphabet, v_byte % 30 + 1, 1);
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_code;
END;
$$;

ALTER FUNCTION "public"."kiosk_pairing_new_code"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_pairing_normalize_code"("p_code" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

ALTER FUNCTION "public"."kiosk_pairing_normalize_code"("p_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_pairing_poll"("p_pairing_id" "uuid", "p_device_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_row     public.kiosk_pairings%ROWTYPE;
  v_key     TEXT := lower(btrim(COALESCE(p_device_key, '')));
  v_key_ok  BOOLEAN := false;
  v_label   TEXT;
  v_org     TEXT;
BEGIN
  SELECT * INTO v_row FROM public.kiosk_pairings WHERE id = p_pairing_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.status IN ('delivered', 'cancelled') THEN
    RETURN jsonb_build_object('status', v_row.status);
  END IF;

  IF v_row.poll_count + 1 > 400 THEN
    UPDATE public.kiosk_pairings SET poll_count = v_row.poll_count + 1, status = 'cancelled', secret_to_deliver = NULL
     WHERE id = v_row.id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  -- decode() échoue sur un texte non hexadécimal : le format est vérifié avant.
  IF v_key ~ '^[0-9a-f]{64}$' THEN
    v_key_ok := encode(sha256(decode(v_key, 'hex')), 'hex') = v_row.device_key_hash;
  END IF;

  IF NOT v_key_ok THEN
    IF v_row.wrong_key_count + 1 >= 5 THEN
      UPDATE public.kiosk_pairings
         SET poll_count = v_row.poll_count + 1, wrong_key_count = v_row.wrong_key_count + 1,
             status = 'cancelled', secret_to_deliver = NULL
       WHERE id = v_row.id;
      RETURN jsonb_build_object('status', 'cancelled');
    END IF;
    UPDATE public.kiosk_pairings
       SET poll_count = v_row.poll_count + 1, wrong_key_count = v_row.wrong_key_count + 1
     WHERE id = v_row.id;
    RETURN jsonb_build_object('status', 'invalid_key');
  END IF;

  IF v_row.status = 'pending' THEN
    UPDATE public.kiosk_pairings SET poll_count = v_row.poll_count + 1 WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'status',     CASE WHEN v_row.expires_at <= now() THEN 'expired' ELSE 'pending' END,
      'expires_at', v_row.expires_at);
  END IF;

  UPDATE public.kiosk_pairings
     SET poll_count = v_row.poll_count + 1, status = 'delivered', delivered_at = now(), secret_to_deliver = NULL
   WHERE id = v_row.id;

  SELECT l.label, o.name INTO v_label, v_org
    FROM public.kiosk_licenses l
    JOIN public.organizations o ON o.id = l.org_id
   WHERE l.id = v_row.license_id;

  RETURN jsonb_build_object(
    'status',     'approved',
    'secret',     v_row.secret_to_deliver,
    'license_id', v_row.license_id,
    'label',      v_label,
    'org_name',   v_org,
    'org_id',     v_row.org_id);
END;
$_$;

ALTER FUNCTION "public"."kiosk_pairing_poll"("p_pairing_id" "uuid", "p_device_key" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_pairing_start"("p_machine_id" "text", "p_machine_name" "text", "p_app_version" "text", "p_device_key_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_machine TEXT := btrim(COALESCE(p_machine_id, ''));
  v_name    TEXT := NULLIF(btrim(COALESCE(p_machine_name, '')), '');
  v_version TEXT := NULLIF(btrim(COALESCE(p_app_version, '')), '');
  v_hash    TEXT := lower(btrim(COALESCE(p_device_key_hash, '')));
  v_ip      TEXT;
  v_bucket  TEXT;
  v_row     public.kiosk_pairings%ROWTYPE;
  v_try     INTEGER := 0;
BEGIN
  IF v_machine = '' OR char_length(v_machine) > 200
     OR char_length(COALESCE(v_name, '')) > 200
     OR char_length(COALESCE(v_version, '')) > 50
     OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'kiosk_pairing_start : parametres invalides' USING ERRCODE = '22023';
  END IF;

  v_ip := public.rpc_client_ip_key();
  IF v_ip IS NOT NULL THEN
    v_bucket := 'kiosk:pairing-start:ip:' || v_ip;
    IF public.kiosk_rate_limited(v_bucket, 10) THEN
      RAISE SQLSTATE 'PT429' USING
        MESSAGE = 'Trop de demandes d''association depuis cette adresse. Reessayez dans quelques minutes.',
        HINT    = 'trop_de_requetes';
    END IF;
    INSERT INTO public.booking_rate_limits (bucket) VALUES (v_bucket);
  END IF;

  DELETE FROM public.kiosk_pairings WHERE created_at < now() - INTERVAL '7 days';

  UPDATE public.kiosk_pairings SET status = 'cancelled', secret_to_deliver = NULL
   WHERE (machine_id = v_machine AND status IN ('pending', 'approved'))
      OR (status = 'pending' AND expires_at <= now());

  LOOP
    BEGIN
      INSERT INTO public.kiosk_pairings (code, device_key_hash, machine_id, machine_name, app_version)
      VALUES (public.kiosk_pairing_new_code(), v_hash, v_machine, v_name, v_version)
      RETURNING * INTO v_row;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try >= 10 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('pairing_id', v_row.id, 'code', v_row.code, 'expires_at', v_row.expires_at);
END;
$_$;

ALTER FUNCTION "public"."kiosk_pairing_start"("p_machine_id" "text", "p_machine_name" "text", "p_app_version" "text", "p_device_key_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_rate_limited"("p_bucket" "text", "p_max" integer) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_hits INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_bucket, 0));
  SELECT count(*) INTO v_hits
    FROM (SELECT 1 FROM public.booking_rate_limits
           WHERE bucket = p_bucket AND created_at > now() - INTERVAL '15 minutes'
           LIMIT p_max) recent;
  RETURN v_hits >= p_max;
END;
$$;

ALTER FUNCTION "public"."kiosk_rate_limited"("p_bucket" "text", "p_max" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_record_guest_response"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_response_id" "uuid", "p_answered_at" timestamp with time zone, "p_answers" "jsonb", "p_questions" "jsonb", "p_marketing_consent" boolean, "p_consent_text" "text", "p_notice_hash" "text", "p_session_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_end_date   timestamptz;
  v_start_date timestamptz;
  v_questions  jsonb := coalesce(p_questions, '[]'::jsonb);
  v_answers    jsonb := '{}'::jsonb;
  v_key        text;
  v_val        jsonb;
  v_email      text;
  v_phone      text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses l
    WHERE l.machine_id = p_machine_id
      AND l.is_active
      AND l.secret <> ''
      AND l.secret = p_secret
  ) THEN
    RAISE EXCEPTION 'kiosk_record_guest_response : licence kiosk invalide ou inactive';
  END IF;

  SELECT e.end_date, e.start_date INTO v_end_date, v_start_date
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.access_code = UPPER(TRIM(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kiosk_record_guest_response : evenement introuvable';
  END IF;

  -- Contrôles séparés : jsonb_object_keys / jsonb_array_elements lèvent une erreur sur un autre type.
  IF p_response_id IS NULL
     OR p_answered_at IS NULL
     OR p_answered_at > now() + interval '5 minutes'
     OR p_answers IS NULL
     OR jsonb_typeof(p_answers) <> 'object'
     OR jsonb_typeof(v_questions) <> 'array'
     OR octet_length(p_answers::text) > 16384
     OR octet_length(v_questions::text) > 16384
     OR coalesce(array_length(p_session_ids, 1), 0) > 20
  THEN
    RAISE EXCEPTION 'kiosk_record_guest_response : reponse invalide' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_answers)) > 20
     OR jsonb_array_length(v_questions) > 20 THEN
    RAISE EXCEPTION 'kiosk_record_guest_response : reponse invalide' USING ERRCODE = '22023';
  END IF;

  IF public.guest_responses_purge_at(v_end_date, v_start_date, p_answered_at) < now() THEN
    RETURN p_response_id;
  END IF;

  -- Assainissement : chaînes tronquées à 500 caractères, booléens, tableaux de 12 chaînes au plus.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_answers) LOOP
    CONTINUE WHEN length(v_key) > 64;
    IF jsonb_typeof(v_val) = 'string' THEN
      v_answers := v_answers || jsonb_build_object(v_key, left(v_val #>> '{}', 500));
    ELSIF jsonb_typeof(v_val) = 'boolean' THEN
      v_answers := v_answers || jsonb_build_object(v_key, v_val);
    ELSIF jsonb_typeof(v_val) = 'array' THEN
      v_answers := v_answers || jsonb_build_object(v_key, (
        SELECT coalesce(jsonb_agg(left(s.x, 120)), '[]'::jsonb)
          FROM (SELECT jsonb_array_elements_text(v_val) AS x LIMIT 12) s));
    END IF;
  END LOOP;

  SELECT lower(trim(v_answers ->> (q ->> 'id'))) INTO v_email
    FROM jsonb_array_elements(v_questions) q
   WHERE q ->> 'type' = 'email'
     AND jsonb_typeof(v_answers -> (q ->> 'id')) = 'string'
   LIMIT 1;

  SELECT trim(v_answers ->> (q ->> 'id')) INTO v_phone
    FROM jsonb_array_elements(v_questions) q
   WHERE q ->> 'type' = 'tel'
     AND jsonb_typeof(v_answers -> (q ->> 'id')) = 'string'
   LIMIT 1;

  INSERT INTO public.kiosk_guest_responses (
    id, event_id, machine_id, session_ids, answers, questions_snapshot,
    email, phone, marketing_consent, consent_text, notice_hash, answered_at
  ) VALUES (
    p_response_id, p_event_id, p_machine_id, coalesce(p_session_ids, '{}'),
    v_answers, v_questions,
    nullif(v_email, ''), nullif(v_phone, ''), coalesce(p_marketing_consent, false),
    left(p_consent_text, 500), left(p_notice_hash, 64), p_answered_at
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN p_response_id;
END;
$$;

ALTER FUNCTION "public"."kiosk_record_guest_response"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_response_id" "uuid", "p_answered_at" timestamp with time zone, "p_answers" "jsonb", "p_questions" "jsonb", "p_marketing_consent" boolean, "p_consent_text" "text", "p_notice_hash" "text", "p_session_ids" "uuid"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_record_logs"("p_machine_id" "text", "p_secret" "text", "p_logs" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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

  INSERT INTO public.kiosk_logs (id, machine_id, level, context, message, stack_trace, app_version, occurred_at)
  SELECT (l.item ->> 'id')::uuid,
         p_machine_id,
         CASE WHEN l.item ->> 'level' IN ('error', 'warning', 'info') THEN l.item ->> 'level' ELSE 'error' END,
         left(l.item ->> 'context', 200),
         left(COALESCE(l.item ->> 'message', ''), 2000),
         left(l.item ->> 'stack_trace', 4000),
         left(l.item ->> 'app_version', 50),
         LEAST(COALESCE((l.item ->> 'occurred_at')::timestamptz, now()), now() + INTERVAL '1 day')
    FROM jsonb_array_elements(p_logs) AS l(item)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$_$;

ALTER FUNCTION "public"."kiosk_record_logs"("p_machine_id" "text", "p_secret" "text", "p_logs" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_record_photo"("p_code" "text", "p_event_id" "uuid", "p_storage_path" "text", "p_photo_url" "text", "p_machine_id" "text", "p_secret" "text", "p_captured_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_media_type" "text" DEFAULT 'photo'::"text", "p_thumbnail_path" "text" DEFAULT NULL::"text", "p_duration_ms" integer DEFAULT NULL::integer, "p_width" integer DEFAULT NULL::integer, "p_height" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_id          UUID;
  v_captured_at TIMESTAMPTZ;
  v_ext         TEXT;
  v_thumb_url   TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses
    WHERE machine_id = p_machine_id
      AND is_active
      AND secret <> ''
      AND secret = p_secret
  ) THEN
    RAISE EXCEPTION 'kiosk_record_photo : licence kiosk invalide ou inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND e.access_code = UPPER(TRIM(p_code))
      AND e.status IN ('active', 'submitted')
  ) THEN
    RAISE EXCEPTION 'kiosk_record_photo : evenement introuvable ou cloture';
  END IF;

  -- testimonial : lot 2, refuse tant que get-photos ne l'exclut pas de la galerie publique.
  IF p_media_type IS NULL OR p_media_type NOT IN ('photo', 'gif', 'boomerang', 'video') THEN
    RAISE EXCEPTION 'kiosk_record_photo : type de media invalide' USING ERRCODE = '22023';
  END IF;

  -- Image pour une photo, MP4 pour un format anime.
  v_ext := CASE WHEN p_media_type = 'photo' THEN '([jJ][pP][eE]?[gG]|[pP][nN][gG])' ELSE '[mM][pP]4' END;

  IF p_storage_path IS NULL
     OR p_storage_path !~ ('^photos/[a-z0-9-]+-' || left(p_event_id::TEXT, 8)
                           || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                           || '/[A-Za-z0-9][A-Za-z0-9._-]*[.]' || v_ext || '$')
     OR p_storage_path LIKE '%..%' THEN
    RAISE EXCEPTION 'kiosk_record_photo : chemin de media invalide' USING ERRCODE = '22023';
  END IF;

  IF p_photo_url IS NULL
     OR p_photo_url !~ '^https://[^/?#@[:space:]]+/[^?#[:space:]]+$'
     OR right(p_photo_url, length(p_storage_path) + 1) <> '/' || p_storage_path THEN
    RAISE EXCEPTION 'kiosk_record_photo : URL de media invalide' USING ERRCODE = '22023';
  END IF;

  -- Affiche : obligatoirement poster.jpg dans le dossier de la seance du fichier principal.
  IF p_thumbnail_path IS NOT NULL THEN
    IF p_thumbnail_path <> regexp_replace(p_storage_path, '/[^/]+$', '') || '/poster.jpg' THEN
      RAISE EXCEPTION 'kiosk_record_photo : affiche invalide' USING ERRCODE = '22023';
    END IF;
    v_thumb_url := left(p_photo_url, length(p_photo_url) - length(p_storage_path)) || p_thumbnail_path;
  ELSIF p_media_type <> 'photo' THEN
    RAISE EXCEPTION 'kiosk_record_photo : affiche obligatoire pour un format anime' USING ERRCODE = '22023';
  END IF;

  IF p_duration_ms IS NOT NULL AND (p_media_type = 'photo' OR p_duration_ms NOT BETWEEN 1 AND 600000) THEN
    RAISE EXCEPTION 'kiosk_record_photo : duree invalide' USING ERRCODE = '22023';
  END IF;

  IF (p_width IS NULL) <> (p_height IS NULL)
     OR p_width NOT BETWEEN 1 AND 20000
     OR p_height NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'kiosk_record_photo : dimensions invalides' USING ERRCODE = '22023';
  END IF;

  SELECT p_captured_at INTO v_captured_at
  FROM public.events e
  WHERE e.id = p_event_id
    AND p_captured_at >= COALESCE(e.start_date, e.created_at) - INTERVAL '1 day'
    AND p_captured_at <= now() + INTERVAL '1 hour';

  INSERT INTO public.photos (event_id, photo_url, storage_path, thumbnail_url, source, status, captured_at,
                             media_type, duration_ms, width, height)
  VALUES (p_event_id, p_photo_url, p_storage_path, v_thumb_url, 'kiosk', 'approved', v_captured_at,
          p_media_type, p_duration_ms, p_width, p_height)
  ON CONFLICT (storage_path) WHERE storage_path IS NOT NULL DO NOTHING
  RETURNING photos.id INTO v_id;

  IF v_id IS NULL THEN
    SELECT p.id INTO v_id
    FROM public.photos p
    WHERE p.storage_path = p_storage_path
      AND p.event_id = p_event_id
      AND p.source = 'kiosk';

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'kiosk_record_photo : chemin de media deja utilise' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN v_id;
END;
$_$;

ALTER FUNCTION "public"."kiosk_record_photo"("p_code" "text", "p_event_id" "uuid", "p_storage_path" "text", "p_photo_url" "text", "p_machine_id" "text", "p_secret" "text", "p_captured_at" timestamp with time zone, "p_media_type" "text", "p_thumbnail_path" "text", "p_duration_ms" integer, "p_width" integer, "p_height" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_record_photo_consent"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_consent_id" "uuid", "p_session_id" "uuid", "p_consented_at" timestamp with time zone, "p_consent_text" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_expires_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses l
    WHERE l.machine_id = p_machine_id
      AND l.is_active
      AND l.secret <> ''
      AND l.secret = p_secret
  ) THEN
    RAISE EXCEPTION 'kiosk_record_photo_consent : licence kiosk invalide ou inactive';
  END IF;

  SELECT e.expires_at INTO v_expires_at
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.access_code = UPPER(TRIM(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kiosk_record_photo_consent : evenement introuvable';
  END IF;

  IF p_consent_id IS NULL
     OR p_session_id IS NULL
     OR p_consented_at IS NULL
     OR p_consented_at > now() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'kiosk_record_photo_consent : consentement invalide' USING ERRCODE = '22023';
  END IF;

  IF public.photo_consents_purge_at(v_expires_at) < now() THEN
    RETURN p_consent_id;
  END IF;

  INSERT INTO public.kiosk_photo_consents (
    id, event_id, machine_id, session_id, consent_text, consented_at
  ) VALUES (
    p_consent_id, p_event_id, p_machine_id, p_session_id, left(coalesce(p_consent_text, ''), 1000), p_consented_at
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN p_consent_id;
END;
$$;

ALTER FUNCTION "public"."kiosk_record_photo_consent"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_consent_id" "uuid", "p_session_id" "uuid", "p_consented_at" timestamp with time zone, "p_consent_text" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_record_print"("p_code" "text", "p_event_id" "uuid", "p_id" "uuid", "p_session_id" "uuid", "p_copies" integer, "p_printed_at" timestamp with time zone, "p_machine_id" "text", "p_secret" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses
    WHERE machine_id = p_machine_id
      AND is_active
      AND secret <> ''
      AND secret = p_secret
  ) THEN
    RAISE EXCEPTION 'kiosk_record_print : licence kiosk invalide ou inactive';
  END IF;

  IF p_id IS NULL OR p_event_id IS NULL OR p_copies IS NULL OR p_copies < 1 OR p_copies > 20 THEN
    RAISE EXCEPTION 'kiosk_record_print : impression invalide' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'kiosk_record_print : evenement introuvable' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND e.access_code = UPPER(TRIM(p_code))
  ) THEN
    RAISE EXCEPTION 'kiosk_record_print : code d''acces invalide';
  END IF;

  INSERT INTO public.print_logs (id, event_id, session_id, copies, machine_id, printed_at)
  VALUES (p_id, p_event_id, p_session_id, p_copies, p_machine_id, COALESCE(p_printed_at, now()))
  ON CONFLICT (id) DO NOTHING;

  SELECT l.event_id INTO v_event_id FROM public.print_logs l WHERE l.id = p_id;
  IF v_event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'kiosk_record_print : id d''impression deja utilise' USING ERRCODE = '22023';
  END IF;

  RETURN true;
END;
$$;

ALTER FUNCTION "public"."kiosk_record_print"("p_code" "text", "p_event_id" "uuid", "p_id" "uuid", "p_session_id" "uuid", "p_copies" integer, "p_printed_at" timestamp with time zone, "p_machine_id" "text", "p_secret" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_report_update_failure"("p_machine_id" "text", "p_secret" "text", "p_version" "text", "p_error" "text", "p_requested_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.kiosk_licenses l SET
    update_failed_at = now(),
    update_error     = left(COALESCE(NULLIF(btrim(p_error), ''), 'Échec sans détail'), 500)
  WHERE l.machine_id = p_machine_id
    AND l.is_active
    AND l.secret <> ''
    AND l.secret = p_secret
    AND l.update_requested_version = p_version
    AND l.update_requested_at IS NOT NULL
    AND (p_requested_at IS NULL OR l.update_requested_at = p_requested_at)
    AND (l.update_failed_at IS NULL OR l.update_failed_at < l.update_requested_at);
END;
$$;

ALTER FUNCTION "public"."kiosk_report_update_failure"("p_machine_id" "text", "p_secret" "text", "p_version" "text", "p_error" "text", "p_requested_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_request_event"("p_license_id" "uuid", "p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_admin     boolean;
  v_lic_org   uuid;
  v_retired   timestamptz;
  v_active    boolean;
  v_ev_org    uuid;
  v_ev_status text;
  v_result    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kiosk_request_event : connexion requise' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_app_admin();

  SELECT l.org_id, l.retired_at, l.is_active INTO v_lic_org, v_retired, v_active
    FROM public.kiosk_licenses l
   WHERE l.id = p_license_id
     AND (v_admin OR l.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = v_uid))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borne introuvable dans votre compte.' USING ERRCODE = '42501';
  END IF;

  SELECT e.org_id, e.status INTO v_ev_org, v_ev_status
    FROM public.events e
   WHERE e.id = p_event_id
     AND (v_admin OR e.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = v_uid));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Événement introuvable dans votre compte.' USING ERRCODE = '42501';
  END IF;

  IF v_retired IS NOT NULL THEN
    RAISE EXCEPTION 'Cette borne est retirée : associez-la de nouveau avant d''y envoyer un événement.' USING ERRCODE = '55000';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'Cette borne est désactivée : réactivez-la avant d''y envoyer un événement.' USING ERRCODE = '55000';
  END IF;
  IF v_ev_org IS DISTINCT FROM v_lic_org THEN
    RAISE EXCEPTION 'L''événement et la borne doivent appartenir au même compte.' USING ERRCODE = '55000';
  END IF;
  IF v_ev_status NOT IN ('active', 'submitted') THEN
    RAISE EXCEPTION 'Événement archivé : il ne peut plus être chargé sur une borne.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.kiosk_licenses l SET
    event_push_id           = p_event_id,
    event_push_requested_at = now(),
    event_push_received_at  = NULL,
    event_push_applied_at   = NULL,
    event_push_error        = NULL
  WHERE l.id = p_license_id
  RETURNING jsonb_build_object(
    'event_push_id',           l.event_push_id,
    'event_push_requested_at', l.event_push_requested_at,
    'event_push_received_at',  l.event_push_received_at,
    'event_push_applied_at',   l.event_push_applied_at,
    'event_push_error',        l.event_push_error)
  INTO v_result;

  RETURN v_result;
END;
$$;

ALTER FUNCTION "public"."kiosk_request_event"("p_license_id" "uuid", "p_event_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_request_update"("p_license_id" "uuid", "p_version" "text") RETURNS TABLE("update_requested_version" "text", "update_requested_at" timestamp with time zone, "update_received_at" timestamp with time zone, "update_failed_at" timestamp with time zone, "update_error" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
       public.is_app_admin()
       OR EXISTS (SELECT 1 FROM public.kiosk_licenses l
                    JOIN public.organizations o ON o.id = l.org_id
                   WHERE l.id = p_license_id AND o.owner_id = auth.uid())) THEN
    RAISE EXCEPTION 'kiosk_request_update : reserve au super-admin et au proprietaire de la borne' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.kiosk_releases r WHERE r.version = p_version) THEN
    RAISE EXCEPTION 'kiosk_request_update : version % introuvable', p_version;
  END IF;

  RETURN QUERY
  UPDATE public.kiosk_licenses l SET
    update_requested_version = p_version,
    update_requested_at      = now(),
    update_received_at       = NULL,
    update_failed_at         = NULL,
    update_error             = NULL
  WHERE l.id = p_license_id AND l.retired_at IS NULL
  RETURNING l.update_requested_version, l.update_requested_at, l.update_received_at,
            l.update_failed_at, l.update_error;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'kiosk_request_update : licence introuvable ou retiree';
  END IF;
END;
$$;

ALTER FUNCTION "public"."kiosk_request_update"("p_license_id" "uuid", "p_version" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_retire_license"("p_license_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_retired TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kiosk_retire_license : connexion requise' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.kiosk_licenses l
   WHERE l.id = p_license_id
     AND (public.is_app_admin()
          OR l.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = v_uid))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kiosk_retire_license : borne introuvable dans votre compte' USING ERRCODE = '42501';
  END IF;

  UPDATE public.kiosk_licenses
     SET retired_at = COALESCE(retired_at, now()), is_active = false, secret = NULL
   WHERE id = p_license_id
  RETURNING retired_at INTO v_retired;

  UPDATE public.kiosk_pairings SET status = 'cancelled', secret_to_deliver = NULL
   WHERE license_id = p_license_id AND status = 'approved';

  RETURN jsonb_build_object('id', p_license_id, 'retired_at', v_retired);
END;
$$;

ALTER FUNCTION "public"."kiosk_retire_license"("p_license_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."kiosk_set_org_limit"("p_org_id" "uuid", "p_limit" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Seul le super-admin peut changer la limite de bornes d''un compte.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 0 THEN
    RAISE EXCEPTION 'La limite de bornes doit etre positive ou vide.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organizations SET kiosk_limit = p_limit WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compte introuvable.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

ALTER FUNCTION "public"."kiosk_set_org_limit"("p_org_id" "uuid", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_service_keys"() RETURNS TABLE("name" "text", "last4" "text", "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Acces refuse : reserve aux administrateurs de l''application' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT k.name, k.last4, k.updated_at
    FROM public.service_keys k
    ORDER BY k.name;
END;
$$;

ALTER FUNCTION "public"."list_service_keys"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."media_purge_candidates"("p_cutoff" timestamp with time zone, "p_limit" integer DEFAULT 10) RETURNS TABLE("event_id" "uuid")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT e.id
    FROM public.events e
   WHERE e.expires_at IS NOT NULL
     AND e.expires_at <= p_cutoff
     AND (EXISTS (SELECT 1 FROM public.photos p WHERE p.event_id = e.id)
          OR EXISTS (SELECT 1 FROM public.audio_tracks a WHERE a.event_id = e.id))
   ORDER BY e.expires_at, e.id
   LIMIT greatest(coalesce(p_limit, 10), 0);
$$;

ALTER FUNCTION "public"."media_purge_candidates"("p_cutoff" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."org_feature_enabled"("p_org_id" "uuid", "p_feature" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.feature_flags_enabled(
    COALESCE((SELECT o.features FROM public.organizations o WHERE o.id = p_org_id), '{}'::jsonb),
    p_feature
  );
$$;

ALTER FUNCTION "public"."org_feature_enabled"("p_org_id" "uuid", "p_feature" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."organizations_guard_kiosk_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.kiosk_limit IS DISTINCT FROM OLD.kiosk_limit AND current_user IN ('anon', 'authenticated') THEN
    IF current_user = 'anon' THEN
      RAISE EXCEPTION 'Seul le super-admin peut changer la limite de bornes d''un compte.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_app_admin() THEN
      RAISE EXCEPTION 'Seul le super-admin peut changer la limite de bornes d''un compte.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."organizations_guard_kiosk_limit"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."photo_consents_purge_at"("p_expires_at" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT p_expires_at + interval '30 days';
$$;

ALTER FUNCTION "public"."photo_consents_purge_at"("p_expires_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_features_by_code"("p_code" "text") RETURNS "text"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bucket   TEXT := public.rpc_code_guard();
  v_features JSONB;
BEGIN
  SELECT COALESCE(o.features, '{}'::jsonb)
    INTO v_features
    FROM public.events e
    LEFT JOIN public.organizations o ON o.id = e.org_id
   WHERE e.access_code = UPPER(TRIM(p_code))
   LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_bucket);
    RETURN NULL;
  END IF;

  RETURN ARRAY(
    SELECT c.id FROM public.feature_catalog() c
     WHERE public.feature_flags_enabled(v_features, c.id)
     ORDER BY c.pos
  );
END;
$$;

ALTER FUNCTION "public"."public_features_by_code"("p_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."rpc_client_ip_key"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_headers JSON;
  v_ip      TEXT;
  v_addr    INET;
  v_salt    TEXT;
BEGIN
  IF COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role' THEN
    RETURN NULL;
  END IF;

  v_headers := NULLIF(current_setting('request.headers', true), '')::json;
  IF v_headers IS NULL THEN
    RETURN NULL;
  END IF;

  v_ip := COALESCE(
    NULLIF(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    NULLIF(btrim(v_headers ->> 'x-real-ip'), ''),
    NULLIF(btrim(substring(COALESCE(v_headers ->> 'x-forwarded-for', '') FROM '([^,]*)$')), '')
  );
  IF v_ip IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_addr := v_ip::inet;
    IF family(v_addr) = 6 THEN
      v_ip := host(network(set_masklen(v_addr, 64)));
    ELSE
      v_ip := host(v_addr);
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    NULL;
  END;

  SELECT s.salt INTO v_salt FROM public.rpc_rate_limit_salt s;
  IF v_salt IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(sha256(convert_to(v_ip || v_salt, 'UTF8')), 'hex');
END;
$_$;

ALTER FUNCTION "public"."rpc_client_ip_key"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."rpc_code_failed"("p_bucket" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.booking_rate_limits (bucket) SELECT p_bucket WHERE p_bucket IS NOT NULL;
$$;

ALTER FUNCTION "public"."rpc_code_failed"("p_bucket" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."rpc_code_guard"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_headers JSON;
  v_ip      TEXT;
  v_addr    INET;
  v_salt    TEXT;
  v_bucket  TEXT;
  v_hits    INTEGER;
BEGIN
  IF COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role' THEN
    RETURN NULL;
  END IF;

  v_headers := NULLIF(current_setting('request.headers', true), '')::json;
  IF v_headers IS NULL THEN
    RETURN NULL;
  END IF;

  v_ip := COALESCE(
    NULLIF(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    NULLIF(btrim(v_headers ->> 'x-real-ip'), ''),
    NULLIF(btrim(substring(COALESCE(v_headers ->> 'x-forwarded-for', '') FROM '([^,]*)$')), '')
  );
  IF v_ip IS NULL THEN
    RAISE LOG 'rpc_code_guard : IP client introuvable, limite ignoree';
    RETURN NULL;
  END IF;

  BEGIN
    v_addr := v_ip::inet;
    IF family(v_addr) = 6 THEN
      v_ip := host(network(set_masklen(v_addr, 64)));
    ELSE
      v_ip := host(v_addr);
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    NULL;
  END;

  SELECT s.salt INTO v_salt FROM public.rpc_rate_limit_salt s;
  IF v_salt IS NULL THEN
    RAISE LOG 'rpc_code_guard : sel absent, limite ignoree';
    RETURN NULL;
  END IF;
  v_bucket := 'rpc:code-fail:ip:' || encode(sha256(convert_to(v_ip || v_salt, 'UTF8')), 'hex');

  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE SQLSTATE 'PT405' USING MESSAGE = 'Methode non autorisee : appeler cette fonction en POST.';
  END IF;

  -- Sérialise les appels d'une même IP : la limite reste exacte sous des requêtes parallèles.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_bucket, 0));

  SELECT count(*) INTO v_hits
  FROM (
    SELECT 1 FROM public.booking_rate_limits
    WHERE bucket = v_bucket AND created_at > now() - INTERVAL '15 minutes'
    LIMIT 100
  ) recent;

  IF v_hits >= 100 THEN
    RAISE SQLSTATE 'PT429' USING
      MESSAGE = 'Trop de codes d''acces invalides depuis cette adresse. Reessayez dans quelques minutes.',
      HINT    = 'trop_de_requetes';
  END IF;

  RETURN v_bucket;
END;
$_$;

ALTER FUNCTION "public"."rpc_code_guard"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."search_events"("search_query" "text", "max_results" integer DEFAULT 8) RETURNS TABLE("id" "uuid", "name" "text", "client_name" "text", "access_code" "text", "start_date" timestamp with time zone, "status" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT e.id, e.name, e.client_name, e.access_code, e.start_date, e.status
  FROM public.events e
  WHERE unaccent(coalesce(e.name, ''))        ILIKE unaccent('%' || search_query || '%')
     OR unaccent(coalesce(e.client_name, '')) ILIKE unaccent('%' || search_query || '%')
     OR e.access_code                         ILIKE '%' || search_query || '%'
  ORDER BY e.start_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

ALTER FUNCTION "public"."search_events"("search_query" "text", "max_results" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."service_key_allowed"("p_name" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT coalesce(p_name, '') = ANY (ARRAY[
    'BREVO_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'ANTHROPIC_API_KEY',
    'REPLICATE_API_TOKEN',
    'PENNYLANE_API_KEY'
  ]);
$$;

ALTER FUNCTION "public"."service_key_allowed"("p_name" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_service_key"("p_name" "text", "p_value" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_value      text := btrim(coalesce(p_value, ''));
  v_vault_name text := 'service_key:' || coalesce(p_name, '');
  v_secret_id  uuid;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Acces refuse : reserve aux administrateurs de l''application' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_key_allowed(p_name) THEN
    RAISE EXCEPTION 'Cle inconnue : %', p_name USING ERRCODE = '22023';
  END IF;
  IF v_value = '' THEN
    RAISE EXCEPTION 'Cle vide' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_secret_id FROM vault.secrets s WHERE s.name = v_vault_name;
  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(v_value, v_vault_name, 'Cle de service ' || p_name);
  ELSE
    PERFORM vault.update_secret(v_secret_id, v_value);
  END IF;

  -- 4 derniers caractères seulement pour une clé assez longue (sinon rien n'est affiché).
  INSERT INTO public.service_keys (name, vault_secret_id, last4, updated_at)
  VALUES (p_name, v_secret_id, CASE WHEN length(v_value) >= 12 THEN right(v_value, 4) END, now())
  ON CONFLICT (name) DO UPDATE
    SET vault_secret_id = EXCLUDED.vault_secret_id,
        last4           = EXCLUDED.last4,
        updated_at      = EXCLUDED.updated_at;
END;
$$;

ALTER FUNCTION "public"."set_service_key"("p_name" "text", "p_value" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."submit_form_response"("p_code" "text", "p_answers" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_code_bucket TEXT;
  v_ip          TEXT;
  v_bucket      TEXT;
  v_event_id    UUID;
  v_org_id      UUID;
  v_enabled     BOOLEAN;
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object'
     OR octet_length(p_answers::text) > 65536 THEN
    RAISE EXCEPTION 'submit_form_response : reponses invalides' USING ERRCODE = '22023';
  END IF;

  v_code_bucket := public.rpc_code_guard();

  v_ip := public.rpc_client_ip_key();
  IF v_ip IS NOT NULL THEN
    v_bucket := 'form:submit:ip:' || v_ip;
    IF public.kiosk_rate_limited(v_bucket, 20) THEN
      RAISE SQLSTATE 'PT429' USING
        MESSAGE = 'Trop d''envois depuis cette adresse. Reessayez dans quelques minutes.',
        HINT    = 'trop_de_requetes';
    END IF;
    INSERT INTO public.booking_rate_limits (bucket) VALUES (v_bucket);
  END IF;

  SELECT e.id, e.org_id, COALESCE((e.form_config ->> 'enabled')::boolean, false)
    INTO v_event_id, v_org_id, v_enabled
    FROM public.events e
   WHERE e.access_code = p_code
     AND e.status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rpc_code_failed(v_code_bucket);
    RETURN false;
  END IF;

  IF NOT public.org_feature_enabled(v_org_id, 'guest_form') THEN
    RAISE EXCEPTION 'fonctionnalite_desactivee' USING ERRCODE = 'PT404';
  END IF;

  IF NOT v_enabled THEN
    RAISE EXCEPTION 'formulaire_desactive';
  END IF;

  INSERT INTO public.event_form_responses (event_id, answers) VALUES (v_event_id, p_answers);
  RETURN true;
END;
$$;

ALTER FUNCTION "public"."submit_form_response"("p_code" "text", "p_answers" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."track_gallery_event"("p_code" "text", "p_type" "text", "p_count" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bucket   TEXT;
  v_event_id UUID;
  v_org_id   UUID;
BEGIN
  IF p_type IS NULL
     OR p_type NOT IN ('view', 'download', 'download_all', 'download_selection', 'share')
     OR p_count IS NULL
     OR p_count < 1
     OR (p_type IN ('view', 'download', 'share') AND p_count <> 1) THEN
    RAISE EXCEPTION 'track_gallery_event : evenement de galerie invalide' USING ERRCODE = '22023';
  END IF;

  v_bucket := public.rpc_code_guard();

  SELECT e.id, e.org_id INTO v_event_id, v_org_id
  FROM public.events e
  WHERE e.access_code = UPPER(TRIM(p_code))
    AND e.status IN ('active', 'submitted')
  LIMIT 1;

  IF v_event_id IS NULL THEN
    PERFORM public.rpc_code_failed(v_bucket);
    RETURN;
  END IF;

  IF NOT public.org_feature_enabled(v_org_id, 'gallery') THEN
    RAISE EXCEPTION 'fonctionnalite_desactivee' USING ERRCODE = 'PT404';
  END IF;

  IF p_count > (SELECT count(*) FROM public.photos p WHERE p.event_id = v_event_id AND p.status = 'approved') THEN
    RETURN;
  END IF;

  INSERT INTO public.gallery_analytics (event_id, type, count)
  VALUES (v_event_id, p_type, p_count);
END;
$$;

ALTER FUNCTION "public"."track_gallery_event"("p_code" "text", "p_type" "text", "p_count" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS "public"."app_admins" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."app_admins" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."audio_tracks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "public_url" "text" NOT NULL,
    "duration_seconds" integer,
    "file_size_bytes" bigint,
    "sort_order" integer DEFAULT 0,
    "transcript" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."audio_tracks" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_rate_limits" (
    "id" bigint NOT NULL,
    "bucket" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."booking_rate_limits" OWNER TO "postgres";

CREATE SEQUENCE IF NOT EXISTS "public"."booking_rate_limits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."booking_rate_limits_id_seq" OWNER TO "postgres";

ALTER SEQUENCE "public"."booking_rate_limits_id_seq" OWNED BY "public"."booking_rate_limits"."id";

CREATE TABLE IF NOT EXISTS "public"."client_designs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "canvas_json" "jsonb",
    "format" "text",
    "final_png_url" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "review_feedback" "text",
    CONSTRAINT "client_designs_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text"])))
);

ALTER TABLE "public"."client_designs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cron_http_calls" (
    "request_id" bigint NOT NULL,
    "job_name" "text" NOT NULL,
    "timeout_ms" integer NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status_code" integer,
    "timed_out" boolean,
    "error_msg" "text",
    "response_excerpt" "text",
    "responded_at" timestamp with time zone
);

ALTER TABLE "public"."cron_http_calls" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cron_job_alerts" (
    "job_name" "text" NOT NULL,
    "jobid" bigint,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "failing_since" timestamp with time zone,
    "problems" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "last_notified_at" timestamp with time zone,
    "last_recipient" "text",
    "resolved_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."cron_job_alerts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."custom_fonts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."custom_fonts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."decorations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "url" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "category" "text" DEFAULT 'Mes stickers'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "thumbnail_url" "text"
);

ALTER TABLE "public"."decorations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."design_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "canvas_json" "jsonb" NOT NULL,
    "format" "text" NOT NULL,
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."design_versions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email_log_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text",
    "link" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE "public"."email_events" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."email_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "recipient" "text" NOT NULL,
    "type" "text" DEFAULT 'access_code'::"text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'sent'::"text",
    "provider_message_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "lead_id" "uuid",
    "subject" "text",
    "delivered_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "open_count" integer DEFAULT 0 NOT NULL,
    "click_count" integer DEFAULT 0 NOT NULL,
    "last_event" "text",
    "last_event_at" timestamp with time zone,
    "error_reason" "text",
    "prospect_id" "uuid",
    CONSTRAINT "email_logs_scope_chk" CHECK (("num_nonnulls"("event_id", "lead_id", "prospect_id") = 1)),
    CONSTRAINT "email_logs_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'delivered'::"text", 'opened'::"text", 'clicked'::"text", 'soft_bounce'::"text", 'hard_bounce'::"text", 'blocked'::"text", 'spam'::"text", 'invalid'::"text", 'error'::"text", 'unsubscribed'::"text"])))
);

ALTER TABLE "public"."email_logs" OWNER TO "postgres";

COMMENT ON COLUMN "public"."email_logs"."prospect_id" IS 'Prospect du salon destinataire (formules, relance J+10). Exclusif de lead_id et event_id.';

CREATE TABLE IF NOT EXISTS "public"."event_activity" (
    "id" bigint NOT NULL,
    "event_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "photo_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_activity_kind_check" CHECK (("kind" = ANY (ARRAY['kiosk_email'::"text", 'qr_open'::"text"]))),
    CONSTRAINT "event_activity_qr_open_photo_chk" CHECK ((("kind" <> 'qr_open'::"text") OR ("photo_id" IS NOT NULL)))
);

ALTER TABLE "public"."event_activity" OWNER TO "postgres";

COMMENT ON TABLE "public"."event_activity" IS 'LAB-209 : activite comptee cote serveur (envoi e-mail depuis la borne, ouverture par QR code). Ecriture par les edge functions (service_role) seulement. Ni adresse, ni IP, ni identifiant d''invite. photo_id sans FK : la photo peut etre purgee, le compteur reste.';

ALTER TABLE "public"."event_activity" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."event_activity_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."event_form_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."event_form_responses" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."event_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "selected_photo_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "frozen_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_reports_selected_photo_ids_check" CHECK (("cardinality"("selected_photo_ids") <= 6)),
    CONSTRAINT "event_reports_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'revoked'::"text"])))
);

ALTER TABLE "public"."event_reports" OWNER TO "postgres";

COMMENT ON TABLE "public"."event_reports" IS 'LAB-209 : bilan client d''un evenement. metrics = chiffres figes a l''envoi (nombres seulement, aucune donnee d''invite), token = lien public /rapport/{token}, expires_at = frozen_at + 12 mois. Ecriture par build_event_report ; sent_at par l''envoi de l''e-mail (service_role).';

CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "client_name" "text",
    "client_email" "text",
    "access_code" "text" NOT NULL,
    "allowed_formats" "text"[] DEFAULT ARRAY['portrait'::"text", 'landscape'::"text", 'stripV'::"text", 'stripH'::"text"],
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "form_config" "jsonb",
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "photobooth_id" "uuid",
    "photo_gallery_url" "text",
    "delivery_attachment_url" "text",
    "gcal_event_id" "text",
    "album_name" "text",
    "media_purged_at" timestamp with time zone,
    "media_reminder_sent_at" timestamp with time zone,
    "media_reminder_expires_at" timestamp with time zone,
    "guest_responses_exported_at" timestamp with time zone,
    "delivery_links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "events_delivery_links_array" CHECK (("jsonb_typeof"("delivery_links") = 'array'::"text")),
    CONSTRAINT "events_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'submitted'::"text", 'archived'::"text"])))
);

ALTER TABLE "public"."events" OWNER TO "postgres";

COMMENT ON COLUMN "public"."events"."media_purged_at" IS 'LAB-212 : dernière suppression complète des photos et messages audio (fichiers R2 + lignes), 30 jours après expires_at.';

COMMENT ON COLUMN "public"."events"."media_reminder_sent_at" IS 'LAB-212 : envoi du rappel « pensez à télécharger » au client.';

COMMENT ON COLUMN "public"."events"."media_reminder_expires_at" IS 'LAB-212 : expires_at annoncée par le dernier rappel ; une date plus tardive rouvre un rappel.';

COMMENT ON COLUMN "public"."events"."guest_responses_exported_at" IS 'LAB-208 : dernier export des contacts invités par l''admin (rappel d''export du tableau de bord).';

CREATE TABLE IF NOT EXISTS "public"."gallery_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."gallery_analytics" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."kiosk_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "machine_id" "text",
    "alert_type" "text" NOT NULL,
    "detail" "text",
    "recipient" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone
);

ALTER TABLE "public"."kiosk_alerts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."kiosk_guest_responses" (
    "id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "machine_id" "text" NOT NULL,
    "session_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "questions_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "email" "text",
    "phone" "text",
    "marketing_consent" boolean DEFAULT false NOT NULL,
    "consent_text" "text",
    "notice_hash" "text",
    "answered_at" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."kiosk_guest_responses" OWNER TO "postgres";

COMMENT ON TABLE "public"."kiosk_guest_responses" IS 'LAB-208 : réponses au questionnaire de la borne. Écriture par kiosk_record_guest_response, suppression 30 jours après la fin de l''événement (guest_responses_purge_at).';

CREATE TABLE IF NOT EXISTS "public"."kiosk_license_machines" (
    "id" bigint NOT NULL,
    "license_id" "uuid" NOT NULL,
    "machine_id" "text" NOT NULL,
    "machine_name" "text",
    "associated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "replaced_at" timestamp with time zone,
    CONSTRAINT "kiosk_license_machines_check" CHECK ((("replaced_at" IS NULL) OR ("replaced_at" >= "associated_at")))
);

ALTER TABLE "public"."kiosk_license_machines" OWNER TO "postgres";

CREATE SEQUENCE IF NOT EXISTS "public"."kiosk_license_machines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."kiosk_license_machines_id_seq" OWNER TO "postgres";

ALTER SEQUENCE "public"."kiosk_license_machines_id_seq" OWNED BY "public"."kiosk_license_machines"."id";

CREATE TABLE IF NOT EXISTS "public"."kiosk_licenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "machine_id" "text",
    "label" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "activated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "color" "text" DEFAULT '#4f46e5'::"text" NOT NULL,
    "app_version" "text",
    "printer_status" "text",
    "printer_name" "text",
    "printer_status_at" timestamp with time zone,
    "paper_capacity" integer,
    "paper_reset_at" timestamp with time zone,
    "secret" "text",
    "admin_pin_hash" "text",
    "admin_pin_set_at" timestamp with time zone,
    "admin_pin_pushed_at" timestamp with time zone,
    "admin_pin_received_at" timestamp with time zone,
    "update_requested_version" "text",
    "update_requested_at" timestamp with time zone,
    "update_received_at" timestamp with time zone,
    "update_failed_at" timestamp with time zone,
    "update_error" "text",
    "pending_uploads" integer,
    "pending_uploads_at" timestamp with time zone,
    "org_id" "uuid" NOT NULL,
    "retired_at" timestamp with time zone,
    "machine_name" "text",
    "event_push_id" "uuid",
    "event_push_requested_at" timestamp with time zone,
    "event_push_received_at" timestamp with time zone,
    "event_push_applied_at" timestamp with time zone,
    "event_push_error" "text",
    "camera_status" "text",
    "camera_status_at" timestamp with time zone,
    CONSTRAINT "kiosk_licenses_admin_pin_hash_format" CHECK ((("admin_pin_hash" IS NULL) OR ("admin_pin_hash" ~ '^pbkdf2\$[0-9]+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$'::"text"))),
    CONSTRAINT "kiosk_licenses_camera_status_check" CHECK ((("camera_status" IS NULL) OR ("camera_status" = ANY (ARRAY['ok'::"text", 'disconnected'::"text"])))),
    CONSTRAINT "kiosk_licenses_event_push_error_length" CHECK ((("event_push_error" IS NULL) OR ("char_length"("event_push_error") <= 500))),
    CONSTRAINT "kiosk_licenses_update_error_length" CHECK ((("update_error" IS NULL) OR ("char_length"("update_error") <= 500)))
);

ALTER TABLE "public"."kiosk_licenses" OWNER TO "postgres";

COMMENT ON COLUMN "public"."kiosk_licenses"."pending_uploads" IS 'LAB-209 : seances + impressions (+ reponses, consentements) pas encore envoyees, dites au dernier battement de coeur. NULL = inconnu (borne qui ne le transmet pas).';

COMMENT ON COLUMN "public"."kiosk_licenses"."camera_status" IS 'LAB-263 : appareil photo de la borne, ok ou disconnected, dit au dernier battement de coeur qui le connaissait. NULL = jamais dit.';

COMMENT ON COLUMN "public"."kiosk_licenses"."camera_status_at" IS 'LAB-263 : date du dernier battement de coeur qui a dit camera_status.';

CREATE TABLE IF NOT EXISTS "public"."kiosk_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "machine_id" "text" NOT NULL,
    "level" "text" DEFAULT 'error'::"text" NOT NULL,
    "context" "text",
    "message" "text" NOT NULL,
    "stack_trace" "text",
    "app_version" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."kiosk_logs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."kiosk_pairings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "device_key_hash" "text" NOT NULL,
    "machine_id" "text" NOT NULL,
    "machine_name" "text",
    "app_version" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:10:00'::interval) NOT NULL,
    "org_id" "uuid",
    "license_id" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "secret_to_deliver" "text",
    "delivered_at" timestamp with time zone,
    "wrong_key_count" integer DEFAULT 0 NOT NULL,
    "poll_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kiosk_pairings_check" CHECK ((("secret_to_deliver" IS NULL) OR ("status" = 'approved'::"text"))),
    CONSTRAINT "kiosk_pairings_code_check" CHECK (("code" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$'::"text")),
    CONSTRAINT "kiosk_pairings_device_key_hash_check" CHECK (("device_key_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "kiosk_pairings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'delivered'::"text", 'cancelled'::"text"])))
);

ALTER TABLE "public"."kiosk_pairings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."kiosk_photo_consents" (
    "id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "machine_id" "text" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "consent_text" "text" NOT NULL,
    "consented_at" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."kiosk_photo_consents" OWNER TO "postgres";

COMMENT ON TABLE "public"."kiosk_photo_consents" IS 'LAB-208 : consentement photo donné sur la borne, une ligne par séance. Écriture par kiosk_record_photo_consent, suppression avec les photos de l''événement (photo_consents_purge_at).';

CREATE TABLE IF NOT EXISTS "public"."kiosk_releases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version" "text" NOT NULL,
    "exe_url" "text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sha256" "text" NOT NULL,
    CONSTRAINT "kiosk_releases_sha256_format" CHECK (("sha256" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."kiosk_releases" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "lead_id" "uuid"
);

ALTER TABLE "public"."notifications" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "webhook_url" "text",
    "notify_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "form_config" "jsonb",
    "brevo_access_template_id" integer,
    "contact_company" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "alert_config" "jsonb" DEFAULT '{"enabled": false}'::"jsonb" NOT NULL,
    "design_reminders" "jsonb",
    "business_profile" "jsonb",
    "format_bleed" "jsonb" DEFAULT '{}'::"jsonb",
    "kiosk_limit" integer,
    "logo_url" "text",
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "contact_address" "text",
    "email_sender_name" "text",
    "email_sender_email" "text",
    "service_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "organizations_event_report_default_for_check" CHECK (((("business_profile" #>> '{event_report,default_for}'::"text"[]) IS NULL) OR (("business_profile" #>> '{event_report,default_for}'::"text"[]) = ANY (ARRAY['professionnel'::"text", 'tous'::"text", 'aucun'::"text"])))),
    CONSTRAINT "organizations_features_object_chk" CHECK (("jsonb_typeof"("features") = 'object'::"text")),
    CONSTRAINT "organizations_kiosk_limit_check" CHECK ((("kiosk_limit" IS NULL) OR ("kiosk_limit" >= 0))),
    CONSTRAINT "organizations_service_settings_object_chk" CHECK (("jsonb_typeof"("service_settings") = 'object'::"text"))
);

ALTER TABLE "public"."organizations" OWNER TO "postgres";

COMMENT ON COLUMN "public"."organizations"."logo_url" IS 'URL publique du logo de la société (bucket kiosk-backgrounds, org/{org_id}/logo.png ou .jpg), ou NULL. Affiché sur l''accueil de la borne (LAB-257).';

COMMENT ON COLUMN "public"."organizations"."features" IS 'Fonctionnalités activées : { "<id>": true|false }. Clé absente = valeur par défaut du catalogue (src/features/catalog.js, _shared/features.ts). Socle (core, templates) toujours actif.';

COMMENT ON COLUMN "public"."organizations"."contact_address" IS 'Adresse postale de l''entreprise (plusieurs lignes possibles), ou NULL. Paramètres → Entreprise (open core L5).';

COMMENT ON COLUMN "public"."organizations"."email_sender_name" IS 'Nom de l''expéditeur des emails envoyés par l''app, ou NULL (repli : variable FROM_NAME).';

COMMENT ON COLUMN "public"."organizations"."email_sender_email" IS 'Adresse de l''expéditeur des emails (expéditeur validé dans Brevo), ou NULL (repli : variable FROM_EMAIL).';

COMMENT ON COLUMN "public"."organizations"."service_settings" IS 'Reglages non secrets des services : { "assistant_model": "...", "google_calendar_id": "..." }. Cle absente = variable d''environnement du serveur.';

CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "photo_url" "text" NOT NULL,
    "storage_path" "text",
    "thumbnail_url" "text",
    "source" "text" DEFAULT 'kiosk'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "width" integer,
    "height" integer,
    "uploader_name" "text",
    "status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "share_url" "text",
    "local_path" "text",
    "captured_at" timestamp with time zone,
    "media_type" "text" DEFAULT 'photo'::"text" NOT NULL,
    "duration_ms" integer,
    CONSTRAINT "photos_duration_ms_check" CHECK ((("duration_ms" IS NULL) OR (("duration_ms" >= 1) AND ("duration_ms" <= 600000)))),
    CONSTRAINT "photos_media_type_check" CHECK (("media_type" = ANY (ARRAY['photo'::"text", 'gif'::"text", 'boomerang'::"text", 'video'::"text", 'testimonial'::"text"])))
);

ALTER TABLE "public"."photos" OWNER TO "postgres";

COMMENT ON COLUMN "public"."photos"."captured_at" IS 'LAB-209 : heure de debut de la seance (horloge de la borne). NULL = photo non kiosk ou heure refusee (hors bornes).';

COMMENT ON COLUMN "public"."photos"."media_type" IS 'LAB-207 : photo, gif, boomerang, video (borne ou envoi invite / admin), testimonial (borne, jamais public). La lecture se fie a l''extension ; cette colonne sert aux badges et aux filtres.';

COMMENT ON COLUMN "public"."photos"."duration_ms" IS 'LAB-207 : duree d''une animation ou d''une video de la borne, en millisecondes. NULL pour une photo.';

CREATE TABLE IF NOT EXISTS "public"."planning_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "color" "text" DEFAULT '#6b7280'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_event_id" "text",
    "google_calendar_id" "text",
    "org_id" "uuid" DEFAULT "public"."current_owner_org_id"() NOT NULL
);

ALTER TABLE "public"."planning_entries" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."print_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "composite_url" "text",
    "copies" integer DEFAULT 1 NOT NULL,
    "machine_id" "text",
    "printed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."print_logs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."rpc_rate_limit_salt" (
    "id" boolean DEFAULT true NOT NULL,
    "salt" "text" NOT NULL,
    CONSTRAINT "rpc_rate_limit_salt_id_check" CHECK ("id")
);

ALTER TABLE "public"."rpc_rate_limit_salt" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."service_keys" (
    "name" "text" NOT NULL,
    "vault_secret_id" "uuid",
    "last4" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."service_keys" OWNER TO "postgres";

COMMENT ON TABLE "public"."service_keys" IS 'Cles des services saisies dans Parametres > Cles : metadonnees seulement (valeur chiffree dans Vault, nom service_key:<name>). Acces par RPC.';

CREATE TABLE IF NOT EXISTS "public"."support_articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "keywords" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "solution" "text" NOT NULL,
    "image_url" "text",
    "severity" "text" DEFAULT 'minor'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_published" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."support_articles" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."support_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "event_id" "uuid",
    "access_code" "text",
    "client_name" "text",
    "client_phone" "text",
    "message" "text" NOT NULL,
    "urgency" "text" DEFAULT 'normal'::"text" NOT NULL,
    "transcript" "jsonb",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."support_messages" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "format_id" "text" NOT NULL,
    "canvas_json" "jsonb" NOT NULL,
    "preview_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "templates_format_check" CHECK (("format_id" = ANY (ARRAY['portrait'::"text", 'landscape'::"text", 'stripV'::"text", 'stripH'::"text"])))
);

ALTER TABLE "public"."templates" OWNER TO "postgres";

ALTER TABLE ONLY "public"."booking_rate_limits" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_rate_limits_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."kiosk_license_machines" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kiosk_license_machines_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."app_admins"
    ADD CONSTRAINT "app_admins_pkey" PRIMARY KEY ("user_id");

ALTER TABLE ONLY "public"."audio_tracks"
    ADD CONSTRAINT "audio_tracks_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_rate_limits"
    ADD CONSTRAINT "booking_rate_limits_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."client_designs"
    ADD CONSTRAINT "client_designs_event_id_key" UNIQUE ("event_id");

ALTER TABLE ONLY "public"."client_designs"
    ADD CONSTRAINT "client_designs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cron_http_calls"
    ADD CONSTRAINT "cron_http_calls_pkey" PRIMARY KEY ("request_id");

ALTER TABLE ONLY "public"."cron_job_alerts"
    ADD CONSTRAINT "cron_job_alerts_pkey" PRIMARY KEY ("job_name");

ALTER TABLE ONLY "public"."custom_fonts"
    ADD CONSTRAINT "custom_fonts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."decorations"
    ADD CONSTRAINT "decorations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."design_versions"
    ADD CONSTRAINT "design_versions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_dedup_key" UNIQUE ("email_log_id", "event", "occurred_at");

ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_activity"
    ADD CONSTRAINT "event_activity_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_form_responses"
    ADD CONSTRAINT "event_form_responses_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_reports"
    ADD CONSTRAINT "event_reports_event_id_key" UNIQUE ("event_id");

ALTER TABLE ONLY "public"."event_reports"
    ADD CONSTRAINT "event_reports_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_reports"
    ADD CONSTRAINT "event_reports_token_key" UNIQUE ("token");

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_access_code_key" UNIQUE ("access_code");

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gallery_analytics"
    ADD CONSTRAINT "gallery_analytics_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_alerts"
    ADD CONSTRAINT "kiosk_alerts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_guest_responses"
    ADD CONSTRAINT "kiosk_guest_responses_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_license_machines"
    ADD CONSTRAINT "kiosk_license_machines_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_licenses"
    ADD CONSTRAINT "kiosk_licenses_machine_id_key" UNIQUE ("machine_id");

ALTER TABLE ONLY "public"."kiosk_licenses"
    ADD CONSTRAINT "kiosk_licenses_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_logs"
    ADD CONSTRAINT "kiosk_logs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_pairings"
    ADD CONSTRAINT "kiosk_pairings_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_photo_consents"
    ADD CONSTRAINT "kiosk_photo_consents_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_releases"
    ADD CONSTRAINT "kiosk_releases_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."kiosk_releases"
    ADD CONSTRAINT "kiosk_releases_version_key" UNIQUE ("version");

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."planning_entries"
    ADD CONSTRAINT "planning_entries_google_event_id_key" UNIQUE ("google_event_id");

ALTER TABLE ONLY "public"."planning_entries"
    ADD CONSTRAINT "planning_entries_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."print_logs"
    ADD CONSTRAINT "print_logs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."rpc_rate_limit_salt"
    ADD CONSTRAINT "rpc_rate_limit_salt_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."service_keys"
    ADD CONSTRAINT "service_keys_pkey" PRIMARY KEY ("name");

ALTER TABLE ONLY "public"."support_articles"
    ADD CONSTRAINT "support_articles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_pkey" PRIMARY KEY ("id");

CREATE INDEX "audio_tracks_event_id_idx" ON "public"."audio_tracks" USING "btree" ("event_id");

CREATE INDEX "booking_rate_limits_bucket_created_idx" ON "public"."booking_rate_limits" USING "btree" ("bucket", "created_at");

CREATE INDEX "cron_http_calls_job_requested_idx" ON "public"."cron_http_calls" USING "btree" ("job_name", "requested_at" DESC);

CREATE INDEX "cron_http_calls_pending_idx" ON "public"."cron_http_calls" USING "btree" ("request_id") WHERE ("responded_at" IS NULL);

CREATE INDEX "design_versions_event_created" ON "public"."design_versions" USING "btree" ("event_id", "created_at" DESC);

CREATE INDEX "email_events_log_occurred_idx" ON "public"."email_events" USING "btree" ("email_log_id", "occurred_at");

CREATE INDEX "email_events_occurred_idx" ON "public"."email_events" USING "btree" ("occurred_at" DESC);

CREATE INDEX "email_logs_event_id_idx" ON "public"."email_logs" USING "btree" ("event_id", "sent_at" DESC);

CREATE INDEX "email_logs_lead_id_idx" ON "public"."email_logs" USING "btree" ("lead_id", "sent_at" DESC);

CREATE INDEX "email_logs_prospect_id_idx" ON "public"."email_logs" USING "btree" ("prospect_id", "sent_at" DESC) WHERE ("prospect_id" IS NOT NULL);

CREATE INDEX "email_logs_provider_message_id_idx" ON "public"."email_logs" USING "btree" ("provider_message_id") WHERE ("provider_message_id" IS NOT NULL);

CREATE INDEX "email_logs_sent_at_idx" ON "public"."email_logs" USING "btree" ("sent_at" DESC, "id" DESC);

CREATE INDEX "event_activity_event_kind_idx" ON "public"."event_activity" USING "btree" ("event_id", "kind");

CREATE UNIQUE INDEX "event_activity_qr_open_photo_key" ON "public"."event_activity" USING "btree" ("event_id", "photo_id") WHERE ("kind" = 'qr_open'::"text");

CREATE INDEX "event_form_responses_event_id_idx" ON "public"."event_form_responses" USING "btree" ("event_id", "submitted_at" DESC);

CREATE INDEX "events_expires_at_idx" ON "public"."events" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);

CREATE INDEX "idx_client_designs_event" ON "public"."client_designs" USING "btree" ("event_id");

CREATE INDEX "idx_events_access_code" ON "public"."events" USING "btree" ("access_code");

CREATE INDEX "idx_events_org_id" ON "public"."events" USING "btree" ("org_id");

CREATE INDEX "idx_gallery_analytics_event_id" ON "public"."gallery_analytics" USING "btree" ("event_id");

CREATE INDEX "idx_gallery_analytics_type" ON "public"."gallery_analytics" USING "btree" ("type");

CREATE INDEX "idx_kiosk_alerts_dedup" ON "public"."kiosk_alerts" USING "btree" ("event_id", "machine_id", "alert_type", "sent_at" DESC);

CREATE INDEX "idx_kiosk_alerts_open" ON "public"."kiosk_alerts" USING "btree" ("org_id", "resolved_at", "sent_at" DESC);

CREATE INDEX "idx_kiosk_alerts_org" ON "public"."kiosk_alerts" USING "btree" ("org_id", "sent_at" DESC);

CREATE INDEX "idx_kiosk_logs_level" ON "public"."kiosk_logs" USING "btree" ("level");

CREATE INDEX "idx_kiosk_logs_machine_id" ON "public"."kiosk_logs" USING "btree" ("machine_id");

CREATE INDEX "idx_kiosk_logs_occurred_at" ON "public"."kiosk_logs" USING "btree" ("occurred_at" DESC);

CREATE INDEX "idx_kiosk_releases_created" ON "public"."kiosk_releases" USING "btree" ("created_at" DESC);

CREATE INDEX "idx_photos_created_at" ON "public"."photos" USING "btree" ("created_at" DESC);

CREATE INDEX "idx_photos_event_id" ON "public"."photos" USING "btree" ("event_id");

CREATE INDEX "idx_photos_media_type" ON "public"."photos" USING "btree" ("event_id", "media_type") WHERE ("media_type" <> 'photo'::"text");

CREATE INDEX "idx_photos_status" ON "public"."photos" USING "btree" ("status") WHERE ("status" <> 'approved'::"text");

CREATE INDEX "idx_print_logs_event_id" ON "public"."print_logs" USING "btree" ("event_id");

CREATE INDEX "idx_print_logs_printed_at" ON "public"."print_logs" USING "btree" ("printed_at" DESC);

CREATE INDEX "idx_support_articles_org" ON "public"."support_articles" USING "btree" ("org_id");

CREATE INDEX "idx_support_articles_published" ON "public"."support_articles" USING "btree" ("is_published");

CREATE INDEX "idx_support_messages_event" ON "public"."support_messages" USING "btree" ("event_id");

CREATE INDEX "idx_support_messages_status" ON "public"."support_messages" USING "btree" ("status");

CREATE INDEX "kiosk_guest_responses_email_idx" ON "public"."kiosk_guest_responses" USING "btree" ("email") WHERE ("email" IS NOT NULL);

CREATE INDEX "kiosk_guest_responses_event_idx" ON "public"."kiosk_guest_responses" USING "btree" ("event_id", "answered_at" DESC);

CREATE INDEX "kiosk_guest_responses_phone_idx" ON "public"."kiosk_guest_responses" USING "btree" ("phone") WHERE ("phone" IS NOT NULL);

CREATE INDEX "kiosk_license_machines_machine_idx" ON "public"."kiosk_license_machines" USING "btree" ("machine_id");

CREATE UNIQUE INDEX "kiosk_license_machines_open_idx" ON "public"."kiosk_license_machines" USING "btree" ("license_id") WHERE ("replaced_at" IS NULL);

CREATE INDEX "kiosk_licenses_org_idx" ON "public"."kiosk_licenses" USING "btree" ("org_id");

CREATE INDEX "kiosk_pairings_code_idx" ON "public"."kiosk_pairings" USING "btree" ("code", "created_at" DESC);

CREATE INDEX "kiosk_pairings_created_at_idx" ON "public"."kiosk_pairings" USING "btree" ("created_at");

CREATE INDEX "kiosk_pairings_license_idx" ON "public"."kiosk_pairings" USING "btree" ("license_id");

CREATE INDEX "kiosk_pairings_machine_idx" ON "public"."kiosk_pairings" USING "btree" ("machine_id");

CREATE UNIQUE INDEX "kiosk_pairings_pending_code_idx" ON "public"."kiosk_pairings" USING "btree" ("code") WHERE ("status" = 'pending'::"text");

CREATE INDEX "kiosk_photo_consents_event_idx" ON "public"."kiosk_photo_consents" USING "btree" ("event_id", "consented_at" DESC);

CREATE INDEX "kiosk_photo_consents_session_idx" ON "public"."kiosk_photo_consents" USING "btree" ("session_id");

CREATE UNIQUE INDEX "notifications_lead_unread_unique" ON "public"."notifications" USING "btree" ("lead_id", "type") WHERE (("read_at" IS NULL) AND ("lead_id" IS NOT NULL));

CREATE INDEX "notifications_org_idx" ON "public"."notifications" USING "btree" ("org_id", "created_at" DESC);

CREATE UNIQUE INDEX "notifications_unread_unique" ON "public"."notifications" USING "btree" ("event_id", "type") WHERE ("read_at" IS NULL);

CREATE INDEX "organizations_owner_id_idx" ON "public"."organizations" USING "btree" ("owner_id");

CREATE UNIQUE INDEX "photos_storage_path_key" ON "public"."photos" USING "btree" ("storage_path") WHERE ("storage_path" IS NOT NULL);

CREATE INDEX "planning_entries_org_id_idx" ON "public"."planning_entries" USING "btree" ("org_id");

CREATE INDEX "support_messages_org_id_idx" ON "public"."support_messages" USING "btree" ("org_id");

CREATE UNIQUE INDEX "uniq_kiosk_alerts_open" ON "public"."kiosk_alerts" USING "btree" ("event_id", "machine_id", "alert_type") WHERE ("resolved_at" IS NULL);

CREATE OR REPLACE TRIGGER "event_reports_guard_update" BEFORE UPDATE ON "public"."event_reports" FOR EACH ROW EXECUTE FUNCTION "public"."event_reports_guard_update"();

CREATE OR REPLACE TRIGGER "kiosk_licenses_clear_event_push" BEFORE UPDATE OF "retired_at", "machine_id" ON "public"."kiosk_licenses" FOR EACH ROW EXECUTE FUNCTION "public"."kiosk_licenses_clear_event_push"();

CREATE OR REPLACE TRIGGER "kiosk_licenses_guard_update" BEFORE UPDATE ON "public"."kiosk_licenses" FOR EACH ROW EXECUTE FUNCTION "public"."kiosk_licenses_guard_update"();

CREATE OR REPLACE TRIGGER "kiosk_licenses_track_machine" AFTER INSERT OR UPDATE OF "machine_id", "machine_name" ON "public"."kiosk_licenses" FOR EACH ROW EXECUTE FUNCTION "public"."kiosk_licenses_track_machine"();

CREATE OR REPLACE TRIGGER "organizations_guard_kiosk_limit" BEFORE UPDATE OF "kiosk_limit" ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."organizations_guard_kiosk_limit"();

CREATE OR REPLACE TRIGGER "trg_client_designs_updated_at" BEFORE UPDATE ON "public"."client_designs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

ALTER TABLE ONLY "public"."app_admins"
    ADD CONSTRAINT "app_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."audio_tracks"
    ADD CONSTRAINT "audio_tracks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."client_designs"
    ADD CONSTRAINT "client_designs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."design_versions"
    ADD CONSTRAINT "design_versions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_email_log_id_fkey" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_logs"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_activity"
    ADD CONSTRAINT "event_activity_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_form_responses"
    ADD CONSTRAINT "event_form_responses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_reports"
    ADD CONSTRAINT "event_reports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_photobooth_id_fkey" FOREIGN KEY ("photobooth_id") REFERENCES "public"."kiosk_licenses"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."gallery_analytics"
    ADD CONSTRAINT "gallery_analytics_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."kiosk_alerts"
    ADD CONSTRAINT "kiosk_alerts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."kiosk_alerts"
    ADD CONSTRAINT "kiosk_alerts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."kiosk_guest_responses"
    ADD CONSTRAINT "kiosk_guest_responses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."kiosk_license_machines"
    ADD CONSTRAINT "kiosk_license_machines_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."kiosk_licenses"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."kiosk_licenses"
    ADD CONSTRAINT "kiosk_licenses_event_push_id_fkey" FOREIGN KEY ("event_push_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."kiosk_licenses"
    ADD CONSTRAINT "kiosk_licenses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");

ALTER TABLE ONLY "public"."kiosk_licenses"
    ADD CONSTRAINT "kiosk_licenses_update_requested_version_fkey" FOREIGN KEY ("update_requested_version") REFERENCES "public"."kiosk_releases"("version") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "public"."kiosk_pairings"
    ADD CONSTRAINT "kiosk_pairings_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."kiosk_pairings"
    ADD CONSTRAINT "kiosk_pairings_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."kiosk_licenses"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."kiosk_pairings"
    ADD CONSTRAINT "kiosk_pairings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."kiosk_photo_consents"
    ADD CONSTRAINT "kiosk_photo_consents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."planning_entries"
    ADD CONSTRAINT "planning_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."print_logs"
    ADD CONSTRAINT "print_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."support_articles"
    ADD CONSTRAINT "support_articles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;

CREATE POLICY "Public read" ON "public"."templates" FOR SELECT USING (("is_active" = true));

CREATE POLICY "Public read decorations" ON "public"."decorations" FOR SELECT TO "anon" USING (true);

CREATE POLICY "admin_read_own_alerts" ON "public"."kiosk_alerts" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "organizations"."id"
   FROM "public"."organizations"
  WHERE ("organizations"."owner_id" = "auth"."uid"()))));

CREATE POLICY "anon_insert_kiosk_logs" ON "public"."kiosk_logs" FOR INSERT TO "anon" WITH CHECK (true);

CREATE POLICY "anon_read_published_articles" ON "public"."support_articles" FOR SELECT TO "anon" USING (("is_published" = true));

CREATE POLICY "anon_select" ON "public"."custom_fonts" FOR SELECT TO "anon" USING (true);

ALTER TABLE "public"."app_admins" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_admins_read_own" ON "public"."app_admins" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));

ALTER TABLE "public"."audio_tracks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audio_tracks_org_owner_all" ON "public"."audio_tracks" TO "authenticated" USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));

ALTER TABLE "public"."booking_rate_limits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."client_designs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cron_http_calls" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cron_job_alerts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."custom_fonts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_fonts_app_admin_delete" ON "public"."custom_fonts" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "custom_fonts_app_admin_insert" ON "public"."custom_fonts" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "custom_fonts_app_admin_update" ON "public"."custom_fonts" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin")) WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "custom_fonts_authenticated_select" ON "public"."custom_fonts" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."decorations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decorations_app_admin_delete" ON "public"."decorations" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "decorations_app_admin_insert" ON "public"."decorations" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "decorations_app_admin_update" ON "public"."decorations" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin")) WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "decorations_authenticated_select" ON "public"."decorations" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."design_versions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "design_versions_owner_insert" ON "public"."design_versions" FOR INSERT TO "authenticated" WITH CHECK (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = "auth"."uid"()))));

CREATE POLICY "design_versions_owner_select" ON "public"."design_versions" FOR SELECT TO "authenticated" USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = "auth"."uid"()))));

CREATE POLICY "designs_owner_read" ON "public"."client_designs" FOR SELECT TO "authenticated" USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = "auth"."uid"()))));

CREATE POLICY "designs_owner_update" ON "public"."client_designs" FOR UPDATE TO "authenticated" USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = "auth"."uid"()))));

ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_events_owner_select" ON "public"."email_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."email_logs" "l"
     JOIN "public"."events" "ev" ON (("ev"."id" = "l"."event_id")))
  WHERE (("l"."id" = "email_events"."email_log_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."email_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_logs_owner_select" ON "public"."email_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "email_logs"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."event_activity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_activity_owner_select" ON "public"."event_activity" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "event_activity"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."event_form_responses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_form_responses_owner_select" ON "public"."event_form_responses" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "event_form_responses"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."event_reports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_reports_owner_select" ON "public"."event_reports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "event_reports"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

CREATE POLICY "event_reports_owner_update" ON "public"."event_reports" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "event_reports"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"()))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "event_reports"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_owner_all" ON "public"."events" USING (("org_id" IN ( SELECT "organizations"."id"
   FROM "public"."organizations"
  WHERE ("organizations"."owner_id" = "auth"."uid"()))));

ALTER TABLE "public"."gallery_analytics" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gallery_analytics_owner_select" ON "public"."gallery_analytics" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "gallery_analytics"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."kiosk_alerts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."kiosk_guest_responses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_guest_responses_owner_delete" ON "public"."kiosk_guest_responses" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "kiosk_guest_responses"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

CREATE POLICY "kiosk_guest_responses_owner_select" ON "public"."kiosk_guest_responses" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "kiosk_guest_responses"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."kiosk_license_machines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_license_machines_select" ON "public"."kiosk_license_machines" FOR SELECT TO "authenticated" USING (("public"."is_app_admin"() OR ("license_id" IN ( SELECT "l"."id"
   FROM "public"."kiosk_licenses" "l"
  WHERE ("l"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

ALTER TABLE "public"."kiosk_licenses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_licenses_delete" ON "public"."kiosk_licenses" FOR DELETE TO "authenticated" USING ("public"."is_app_admin"());

CREATE POLICY "kiosk_licenses_select" ON "public"."kiosk_licenses" FOR SELECT TO "authenticated" USING (("public"."is_app_admin"() OR ("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"())))));

CREATE POLICY "kiosk_licenses_update" ON "public"."kiosk_licenses" FOR UPDATE TO "authenticated" USING (("public"."is_app_admin"() OR ("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"()))))) WITH CHECK (("public"."is_app_admin"() OR ("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"())))));

ALTER TABLE "public"."kiosk_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_logs_delete" ON "public"."kiosk_logs" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_app_admin"() AS "is_app_admin") OR "public"."kiosk_log_visible"("machine_id", "created_at")));

CREATE POLICY "kiosk_logs_select" ON "public"."kiosk_logs" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_app_admin"() AS "is_app_admin") OR "public"."kiosk_log_visible"("machine_id", "created_at")));

ALTER TABLE "public"."kiosk_pairings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_pairings_select" ON "public"."kiosk_pairings" FOR SELECT TO "authenticated" USING (("public"."is_app_admin"() OR ("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"())))));

ALTER TABLE "public"."kiosk_photo_consents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_photo_consents_admin_select" ON "public"."kiosk_photo_consents" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());

ALTER TABLE "public"."kiosk_releases" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_owner_select" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "organizations"."id"
   FROM "public"."organizations"
  WHERE ("organizations"."owner_id" = "auth"."uid"()))));

CREATE POLICY "notifications_owner_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("org_id" IN ( SELECT "organizations"."id"
   FROM "public"."organizations"
  WHERE ("organizations"."owner_id" = "auth"."uid"())))) WITH CHECK (("org_id" IN ( SELECT "organizations"."id"
   FROM "public"."organizations"
  WHERE ("organizations"."owner_id" = "auth"."uid"()))));

CREATE POLICY "org_owner_all" ON "public"."organizations" USING (("auth"."uid"() = "owner_id"));

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "photos_org_owner_all" ON "public"."photos" TO "authenticated" USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."organizations" "o" ON (("o"."id" = "e"."org_id")))
  WHERE ("o"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));

ALTER TABLE "public"."planning_entries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planning_entries_owner_delete" ON "public"."planning_entries" FOR DELETE TO "authenticated" USING (("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"()))));

CREATE POLICY "planning_entries_owner_insert" ON "public"."planning_entries" FOR INSERT TO "authenticated" WITH CHECK (("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"()))));

CREATE POLICY "planning_entries_owner_select" ON "public"."planning_entries" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"()))));

CREATE POLICY "planning_entries_owner_update" ON "public"."planning_entries" FOR UPDATE TO "authenticated" USING (("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"())))) WITH CHECK (("org_id" IN ( SELECT "o"."id"
   FROM "public"."organizations" "o"
  WHERE ("o"."owner_id" = "auth"."uid"()))));

ALTER TABLE "public"."print_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "print_logs_owner_select" ON "public"."print_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."events" "ev"
  WHERE (("ev"."id" = "print_logs"."event_id") AND ("ev"."org_id" IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"())))))));

CREATE POLICY "releases_admin_delete" ON "public"."kiosk_releases" FOR DELETE TO "authenticated" USING ("public"."is_app_admin"());

CREATE POLICY "releases_admin_insert" ON "public"."kiosk_releases" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_app_admin"());

CREATE POLICY "releases_admin_update" ON "public"."kiosk_releases" FOR UPDATE TO "authenticated" USING ("public"."is_app_admin"()) WITH CHECK ("public"."is_app_admin"());

CREATE POLICY "releases_authenticated_read" ON "public"."kiosk_releases" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."rpc_rate_limit_salt" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."service_keys" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."support_articles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_articles_app_admin_delete" ON "public"."support_articles" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "support_articles_app_admin_insert" ON "public"."support_articles" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "support_articles_app_admin_update" ON "public"."support_articles" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin")) WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "support_articles_authenticated_select" ON "public"."support_articles" FOR SELECT TO "authenticated" USING (("is_published" OR ( SELECT "public"."is_app_admin"() AS "is_app_admin")));

ALTER TABLE "public"."support_messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_messages_owner_select" ON "public"."support_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (( VALUES ("support_messages"."org_id","support_messages"."event_id")) "m"("org_id", "event_id")
     LEFT JOIN "public"."events" "ev" ON (("ev"."id" = "m"."event_id")))
  WHERE (COALESCE("m"."org_id", "ev"."org_id") IN ( SELECT "o"."id"
           FROM "public"."organizations" "o"
          WHERE ("o"."owner_id" = "auth"."uid"()))))));

ALTER TABLE "public"."templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_app_admin_delete" ON "public"."templates" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "templates_app_admin_insert" ON "public"."templates" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "templates_app_admin_select" ON "public"."templates" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

CREATE POLICY "templates_app_admin_update" ON "public"."templates" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_app_admin"() AS "is_app_admin")) WITH CHECK (( SELECT "public"."is_app_admin"() AS "is_app_admin"));

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

-- Droits : on retire d'abord ceux que Supabase accorde par défaut à chaque objet créé ;
-- les GRANT qui suivent sont les droits exacts.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated", "service_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated", "service_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "anon", "authenticated", "service_role";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

REVOKE ALL ON FUNCTION "public"."build_event_report"("p_event_id" "uuid", "p_freeze" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_event_report"("p_event_id" "uuid", "p_freeze" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."build_event_report"("p_event_id" "uuid", "p_freeze" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."cron_health_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cron_health_snapshot"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."cron_http_post"("p_job" "text", "p_function" "text", "p_timeout_ms" integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."current_owner_org_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_owner_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_owner_org_id"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."delete_service_key"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_service_key"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_service_key"("p_name" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_report_default_for"("p_business_profile" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."event_report_default_for"("p_business_profile" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_report_kiosks"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."event_report_kiosks"("p_event_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_report_metrics"("p_event_id" "uuid", "p_previous" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."event_report_metrics"("p_event_id" "uuid", "p_previous" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_report_payload"("p_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."event_report_payload"("p_report_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."event_reports_guard_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."event_reports_guard_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."feature_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feature_catalog"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."feature_flags_enabled"("p_features" "jsonb", "p_feature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feature_flags_enabled"("p_features" "jsonb", "p_feature" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."get_event_form_enabled"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_event_form_enabled"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_event_form_enabled"("p_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_event_report"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_event_report"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_event_report"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_event_report"("p_token" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."get_global_form_config"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_global_form_config"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_global_form_config"() TO "service_role";

GRANT ALL ON FUNCTION "public"."get_org_contact_by_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_org_contact_by_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_org_contact_by_code"("p_code" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."get_org_contact_by_event"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_org_contact_by_event"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_org_contact_by_event"("p_event_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_public_event"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_event"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_event"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_event"("p_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_public_photos"("p_code" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_photos"("p_code" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_photos"("p_code" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_photos"("p_code" "text", "p_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_service_key"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_service_key"("p_name" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."guest_responses_purge_at"("p_end_date" timestamp with time zone, "p_start_date" timestamp with time zone, "p_answered_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guest_responses_purge_at"("p_end_date" timestamp with time zone, "p_start_date" timestamp with time zone, "p_answered_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."guest_responses_purge_at"("p_end_date" timestamp with time zone, "p_start_date" timestamp with time zone, "p_answered_at" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."guest_responses_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guest_responses_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guest_responses_summary"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_app_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_app_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_app_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_app_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_ack_event_request"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid", "p_error" "text", "p_requested_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_ack_event_request"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid", "p_error" "text", "p_requested_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_ack_event_request"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid", "p_error" "text", "p_requested_at" timestamp with time zone) TO "anon";

REVOKE ALL ON FUNCTION "public"."kiosk_cancel_event_request"("p_license_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_cancel_event_request"("p_license_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_cancel_event_request"("p_license_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_check_license"("p_machine_id" "text", "p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_check_license"("p_machine_id" "text", "p_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_check_license"("p_machine_id" "text", "p_secret" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kiosk_check_license"("p_machine_id" "text", "p_secret" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_get_admin_pin"("p_machine_id" "text", "p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_get_admin_pin"("p_machine_id" "text", "p_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_get_admin_pin"("p_machine_id" "text", "p_secret" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kiosk_get_admin_pin"("p_machine_id" "text", "p_secret" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_get_approved_design"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_get_approved_design"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_get_approved_design"("p_machine_id" "text", "p_secret" "text", "p_event_id" "uuid") TO "anon";

REVOKE ALL ON FUNCTION "public"."kiosk_get_event"("p_code" "text", "p_machine_id" "text", "p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_get_event"("p_code" "text", "p_machine_id" "text", "p_secret" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_get_event"("p_code" "text", "p_machine_id" "text", "p_secret" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."kiosk_get_event_request"("p_machine_id" "text", "p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_get_event_request"("p_machine_id" "text", "p_secret" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_get_event_request"("p_machine_id" "text", "p_secret" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."kiosk_get_update_request"("p_machine_id" "text", "p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_get_update_request"("p_machine_id" "text", "p_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_get_update_request"("p_machine_id" "text", "p_secret" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kiosk_get_update_request"("p_machine_id" "text", "p_secret" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_heartbeat"("p_machine_id" "text", "p_secret" "text", "p_app_version" "text", "p_printer_status" "text", "p_printer_name" "text", "p_pending_uploads" integer, "p_camera_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_heartbeat"("p_machine_id" "text", "p_secret" "text", "p_app_version" "text", "p_printer_status" "text", "p_printer_name" "text", "p_pending_uploads" integer, "p_camera_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_heartbeat"("p_machine_id" "text", "p_secret" "text", "p_app_version" "text", "p_printer_status" "text", "p_printer_name" "text", "p_pending_uploads" integer, "p_camera_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kiosk_heartbeat"("p_machine_id" "text", "p_secret" "text", "p_app_version" "text", "p_printer_status" "text", "p_printer_name" "text", "p_pending_uploads" integer, "p_camera_status" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_licenses_clear_event_push"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_licenses_clear_event_push"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_licenses_guard_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_licenses_guard_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_licenses_track_machine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_licenses_track_machine"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_list_accounts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_list_accounts"() TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_list_accounts"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_log_visible"("p_machine_id" "text", "p_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_log_visible"("p_machine_id" "text", "p_created_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_log_visible"("p_machine_id" "text", "p_created_at" timestamp with time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_pairing_approve"("p_code" "text", "p_label" "text", "p_replace_license_id" "uuid", "p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_pairing_approve"("p_code" "text", "p_label" "text", "p_replace_license_id" "uuid", "p_org_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_pairing_approve"("p_code" "text", "p_label" "text", "p_replace_license_id" "uuid", "p_org_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_pairing_lookup"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_pairing_lookup"("p_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_pairing_lookup"("p_code" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_pairing_new_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_pairing_new_code"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_pairing_normalize_code"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_pairing_normalize_code"("p_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_pairing_poll"("p_pairing_id" "uuid", "p_device_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_pairing_poll"("p_pairing_id" "uuid", "p_device_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_pairing_poll"("p_pairing_id" "uuid", "p_device_key" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."kiosk_pairing_start"("p_machine_id" "text", "p_machine_name" "text", "p_app_version" "text", "p_device_key_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_pairing_start"("p_machine_id" "text", "p_machine_name" "text", "p_app_version" "text", "p_device_key_hash" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_pairing_start"("p_machine_id" "text", "p_machine_name" "text", "p_app_version" "text", "p_device_key_hash" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."kiosk_rate_limited"("p_bucket" "text", "p_max" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_rate_limited"("p_bucket" "text", "p_max" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_record_guest_response"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_response_id" "uuid", "p_answered_at" timestamp with time zone, "p_answers" "jsonb", "p_questions" "jsonb", "p_marketing_consent" boolean, "p_consent_text" "text", "p_notice_hash" "text", "p_session_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_record_guest_response"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_response_id" "uuid", "p_answered_at" timestamp with time zone, "p_answers" "jsonb", "p_questions" "jsonb", "p_marketing_consent" boolean, "p_consent_text" "text", "p_notice_hash" "text", "p_session_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_record_guest_response"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_response_id" "uuid", "p_answered_at" timestamp with time zone, "p_answers" "jsonb", "p_questions" "jsonb", "p_marketing_consent" boolean, "p_consent_text" "text", "p_notice_hash" "text", "p_session_ids" "uuid"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_record_logs"("p_machine_id" "text", "p_secret" "text", "p_logs" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_record_logs"("p_machine_id" "text", "p_secret" "text", "p_logs" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_record_logs"("p_machine_id" "text", "p_secret" "text", "p_logs" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_record_photo"("p_code" "text", "p_event_id" "uuid", "p_storage_path" "text", "p_photo_url" "text", "p_machine_id" "text", "p_secret" "text", "p_captured_at" timestamp with time zone, "p_media_type" "text", "p_thumbnail_path" "text", "p_duration_ms" integer, "p_width" integer, "p_height" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_record_photo"("p_code" "text", "p_event_id" "uuid", "p_storage_path" "text", "p_photo_url" "text", "p_machine_id" "text", "p_secret" "text", "p_captured_at" timestamp with time zone, "p_media_type" "text", "p_thumbnail_path" "text", "p_duration_ms" integer, "p_width" integer, "p_height" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_record_photo"("p_code" "text", "p_event_id" "uuid", "p_storage_path" "text", "p_photo_url" "text", "p_machine_id" "text", "p_secret" "text", "p_captured_at" timestamp with time zone, "p_media_type" "text", "p_thumbnail_path" "text", "p_duration_ms" integer, "p_width" integer, "p_height" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_record_photo_consent"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_consent_id" "uuid", "p_session_id" "uuid", "p_consented_at" timestamp with time zone, "p_consent_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_record_photo_consent"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_consent_id" "uuid", "p_session_id" "uuid", "p_consented_at" timestamp with time zone, "p_consent_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_record_photo_consent"("p_code" "text", "p_event_id" "uuid", "p_machine_id" "text", "p_secret" "text", "p_consent_id" "uuid", "p_session_id" "uuid", "p_consented_at" timestamp with time zone, "p_consent_text" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_record_print"("p_code" "text", "p_event_id" "uuid", "p_id" "uuid", "p_session_id" "uuid", "p_copies" integer, "p_printed_at" timestamp with time zone, "p_machine_id" "text", "p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_record_print"("p_code" "text", "p_event_id" "uuid", "p_id" "uuid", "p_session_id" "uuid", "p_copies" integer, "p_printed_at" timestamp with time zone, "p_machine_id" "text", "p_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_record_print"("p_code" "text", "p_event_id" "uuid", "p_id" "uuid", "p_session_id" "uuid", "p_copies" integer, "p_printed_at" timestamp with time zone, "p_machine_id" "text", "p_secret" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_report_update_failure"("p_machine_id" "text", "p_secret" "text", "p_version" "text", "p_error" "text", "p_requested_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_report_update_failure"("p_machine_id" "text", "p_secret" "text", "p_version" "text", "p_error" "text", "p_requested_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."kiosk_report_update_failure"("p_machine_id" "text", "p_secret" "text", "p_version" "text", "p_error" "text", "p_requested_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."kiosk_report_update_failure"("p_machine_id" "text", "p_secret" "text", "p_version" "text", "p_error" "text", "p_requested_at" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_request_event"("p_license_id" "uuid", "p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_request_event"("p_license_id" "uuid", "p_event_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_request_event"("p_license_id" "uuid", "p_event_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_request_update"("p_license_id" "uuid", "p_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_request_update"("p_license_id" "uuid", "p_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kiosk_request_update"("p_license_id" "uuid", "p_version" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."kiosk_retire_license"("p_license_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_retire_license"("p_license_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_retire_license"("p_license_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."kiosk_set_org_limit"("p_org_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kiosk_set_org_limit"("p_org_id" "uuid", "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."kiosk_set_org_limit"("p_org_id" "uuid", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_service_keys"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_service_keys"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_service_keys"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."media_purge_candidates"("p_cutoff" timestamp with time zone, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."media_purge_candidates"("p_cutoff" timestamp with time zone, "p_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."org_feature_enabled"("p_org_id" "uuid", "p_feature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_feature_enabled"("p_org_id" "uuid", "p_feature" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."organizations_guard_kiosk_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."organizations_guard_kiosk_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."photo_consents_purge_at"("p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."photo_consents_purge_at"("p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."photo_consents_purge_at"("p_expires_at" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."public_features_by_code"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_features_by_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."public_features_by_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_features_by_code"("p_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."rpc_client_ip_key"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_client_ip_key"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."rpc_code_failed"("p_bucket" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_code_failed"("p_bucket" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."rpc_code_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_code_guard"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."search_events"("search_query" "text", "max_results" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_events"("search_query" "text", "max_results" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_events"("search_query" "text", "max_results" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."service_key_allowed"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."service_key_allowed"("p_name" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_service_key"("p_name" "text", "p_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_service_key"("p_name" "text", "p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_service_key"("p_name" "text", "p_value" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."submit_form_response"("p_code" "text", "p_answers" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_form_response"("p_code" "text", "p_answers" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_form_response"("p_code" "text", "p_answers" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_form_response"("p_code" "text", "p_answers" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."track_gallery_event"("p_code" "text", "p_type" "text", "p_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."track_gallery_event"("p_code" "text", "p_type" "text", "p_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."track_gallery_event"("p_code" "text", "p_type" "text", "p_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_gallery_event"("p_code" "text", "p_type" "text", "p_count" integer) TO "service_role";

GRANT ALL ON TABLE "public"."app_admins" TO "service_role";
GRANT SELECT ON TABLE "public"."app_admins" TO "authenticated";

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."audio_tracks" TO "authenticated";
GRANT ALL ON TABLE "public"."audio_tracks" TO "service_role";

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_rate_limits" TO "service_role";

GRANT ALL ON SEQUENCE "public"."booking_rate_limits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_rate_limits_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."client_designs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_designs" TO "service_role";

GRANT ALL ON TABLE "public"."cron_http_calls" TO "service_role";

GRANT ALL ON TABLE "public"."cron_job_alerts" TO "service_role";

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."custom_fonts" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_fonts" TO "service_role";
GRANT SELECT ON TABLE "public"."custom_fonts" TO "anon";

GRANT SELECT ON TABLE "public"."decorations" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."decorations" TO "authenticated";
GRANT ALL ON TABLE "public"."decorations" TO "service_role";

GRANT ALL ON TABLE "public"."design_versions" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."design_versions" TO "authenticated";

GRANT ALL ON TABLE "public"."email_events" TO "service_role";
GRANT SELECT ON TABLE "public"."email_events" TO "authenticated";

GRANT ALL ON TABLE "public"."email_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."email_logs" TO "authenticated";

GRANT ALL ON TABLE "public"."event_activity" TO "service_role";
GRANT SELECT ON TABLE "public"."event_activity" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."event_activity_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."event_activity_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."event_activity_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."event_form_responses" TO "service_role";
GRANT SELECT ON TABLE "public"."event_form_responses" TO "authenticated";

GRANT ALL ON TABLE "public"."event_reports" TO "service_role";
GRANT SELECT ON TABLE "public"."event_reports" TO "authenticated";

GRANT UPDATE("status") ON TABLE "public"."event_reports" TO "authenticated";

GRANT UPDATE("selected_photo_ids") ON TABLE "public"."event_reports" TO "authenticated";

GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."gallery_analytics" TO "anon";
GRANT ALL ON TABLE "public"."gallery_analytics" TO "service_role";
GRANT SELECT ON TABLE "public"."gallery_analytics" TO "authenticated";

GRANT ALL ON TABLE "public"."kiosk_alerts" TO "anon";
GRANT ALL ON TABLE "public"."kiosk_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."kiosk_alerts" TO "service_role";

GRANT ALL ON TABLE "public"."kiosk_guest_responses" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."kiosk_guest_responses" TO "authenticated";

GRANT ALL ON TABLE "public"."kiosk_license_machines" TO "service_role";
GRANT SELECT ON TABLE "public"."kiosk_license_machines" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."kiosk_license_machines_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."kiosk_licenses" TO "service_role";
GRANT DELETE ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("id") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("machine_id") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("label"),UPDATE("label") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("is_active"),UPDATE("is_active") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("activated_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("last_seen_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("created_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("color"),UPDATE("color") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("app_version") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("printer_status") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("printer_name") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("printer_status_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("paper_capacity"),UPDATE("paper_capacity") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("paper_reset_at"),UPDATE("paper_reset_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("admin_pin_set_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("admin_pin_pushed_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("admin_pin_received_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("update_requested_version") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("update_requested_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("update_received_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("update_failed_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("update_error") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("pending_uploads") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("pending_uploads_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("org_id"),UPDATE("org_id") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("retired_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("machine_name") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("event_push_id") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("event_push_requested_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("event_push_received_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("event_push_applied_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("event_push_error") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("camera_status") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT SELECT("camera_status_at") ON TABLE "public"."kiosk_licenses" TO "authenticated";

GRANT INSERT ON TABLE "public"."kiosk_logs" TO "anon";
GRANT SELECT,DELETE ON TABLE "public"."kiosk_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."kiosk_logs" TO "service_role";

GRANT ALL ON TABLE "public"."kiosk_pairings" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("machine_id") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("machine_name") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("app_version") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("status") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("expires_at") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("org_id") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("license_id") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("approved_by") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("approved_at") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("delivered_at") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT SELECT("created_at") ON TABLE "public"."kiosk_pairings" TO "authenticated";

GRANT ALL ON TABLE "public"."kiosk_photo_consents" TO "service_role";
GRANT SELECT ON TABLE "public"."kiosk_photo_consents" TO "authenticated";

GRANT ALL ON TABLE "public"."kiosk_releases" TO "anon";
GRANT ALL ON TABLE "public"."kiosk_releases" TO "authenticated";
GRANT ALL ON TABLE "public"."kiosk_releases" TO "service_role";

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";

GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";

GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";

GRANT ALL ON TABLE "public"."planning_entries" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."planning_entries" TO "authenticated";

GRANT MAINTAIN ON TABLE "public"."print_logs" TO "anon";
GRANT ALL ON TABLE "public"."print_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."print_logs" TO "authenticated";

GRANT ALL ON TABLE "public"."rpc_rate_limit_salt" TO "service_role";

GRANT ALL ON TABLE "public"."service_keys" TO "service_role";

GRANT SELECT ON TABLE "public"."support_articles" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."support_articles" TO "authenticated";
GRANT ALL ON TABLE "public"."support_articles" TO "service_role";

GRANT ALL ON TABLE "public"."support_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."support_messages" TO "authenticated";

GRANT SELECT ON TABLE "public"."templates" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."templates" TO "authenticated";
GRANT ALL ON TABLE "public"."templates" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- Données de départ

INSERT INTO "public"."templates" ("name", "format_id", "canvas_json", "preview_url", "is_active", "sort_order", "tags")
SELECT "name", "format_id", "canvas_json", "preview_url", "is_active", "sort_order", "tags" FROM jsonb_populate_recordset(NULL::"public"."templates", '[
{"name":"Vierge — Portrait","format_id":"portrait","canvas_json":{"objects":[]},"preview_url":null,"is_active":true,"sort_order":1,"tags":[]},
{"name":"Vierge — Paysage","format_id":"landscape","canvas_json":{"objects":[]},"preview_url":null,"is_active":true,"sort_order":2,"tags":[]},
{"name":"Vierge — Bandelette V","format_id":"stripV","canvas_json":{"objects":[]},"preview_url":null,"is_active":true,"sort_order":3,"tags":[]},
{"name":"Vierge — Bandelette H","format_id":"stripH","canvas_json":{"objects":[]},"preview_url":null,"is_active":true,"sort_order":4,"tags":[]}
]'::jsonb);

INSERT INTO "public"."support_articles" ("org_id", "category", "title", "keywords", "solution", "image_url", "severity", "sort_order", "is_published")
SELECT "org_id", "category", "title", "keywords", "solution", "image_url", "severity", "sort_order", "is_published" FROM jsonb_populate_recordset(NULL::"public"."support_articles", '[
{"org_id":null,"category":"Démarrage","title":"Écran noir / le photobooth ne s''allume pas","keywords":["écran noir","ne s''allume pas","pas de courant","éteint","rien ne s''allume"],"solution":"1. Vérifiez d''abord si le flash est allumé (selon votre modèle, il se trouve sur l''appareil photo ou sur le photobooth lui-même).\n2. Si le flash est éteint : il n''y a probablement pas de courant sur la prise. Testez une autre prise électrique.\n3. Si le flash est allumé : débranchez le photobooth de la prise, attendez 30 secondes, puis rebranchez.","image_url":null,"severity":"blocking","sort_order":10,"is_published":true},
{"org_id":null,"category":"Démarrage","title":"L''application ne se lance pas / le bureau Windows est visible","keywords":["application ne se lance pas","bureau windows","pas l''app","écran windows"],"solution":"Débranchez le photobooth de la prise, attendez 30 secondes, puis rebranchez. L''application se relance automatiquement au démarrage.","image_url":null,"severity":"blocking","sort_order":11,"is_published":true},
{"org_id":null,"category":"Démarrage","title":"Tout est figé / l''écran ne répond plus","keywords":["figé","planté","bloqué","ne répond plus","écran gelé"],"solution":"Débranchez le photobooth de la prise, attendez 30 secondes, puis rebranchez.","image_url":null,"severity":"blocking","sort_order":12,"is_published":true},
{"org_id":null,"category":"Imprimante","title":"Plus d''impression : rien ne sort quand on lance l''impression","keywords":["imprimante","n''imprime plus","rien ne sort","papier","film","bourrage","impression"],"solution":"Regardez les voyants de l''imprimante (POWER, RIBBON, PAPER, ERROR) pour identifier le problème :\n\n• Voyant PAPER — Fin du papier : installez un nouveau rouleau de papier.\n• Voyant RIBBON — Fin du ruban : installez un nouveau ruban.\n• Porte ouverte (pas de papier) : réinstallez correctement le papier puis refermez bien le mécanisme.\n• Porte ouverte : refermez bien le mécanisme.\n• Erreur de papier : réinstallez correctement le papier.\n• Erreur de ruban : réinstallez correctement le ruban.\n• Voyants RIBBON et PAPER qui clignotent en alternance (erreur de taille du support) : contactez le loueur.\n• Voyant ERROR — Erreur système : basculez le commutateur ON/Standby pour réinitialiser. Si l''imprimante ne repart pas, contactez le loueur.\n• Refroidissement de la tête : l''imprimante refroidit, l''erreur disparaît toute seule. Patientez quelques instants.\n\nEn cas de bourrage papier :\n1. Relâchez le levier d''ouverture, tirez le mécanisme et retirez la cassette à ruban.\n2. Tirez doucement sur le papier coincé, sans forcer (vous risqueriez d''endommager l''imprimante).\n3. Coupez aux ciseaux la partie froissée ou partiellement imprimée, bien droit (sinon le papier se recoincera).\n4. Remettez le papier et le ruban en place, refermez. L''imprimante se réinitialise (~30 secondes) et sort 4 impressions blanches : c''est normal.\n\nVidéo pour retirer et remettre le papier : https://www.youtube.com/watch?v=Zzl-L60KPQ4&t=17s","image_url":"/support/dnp-ds620-voyants.png","severity":"blocking","sort_order":20,"is_published":true},
{"org_id":null,"category":"Imprimante","title":"Le bouton « Imprimer » a disparu de l''écran","keywords":["bouton imprimer","plus de bouton","limite","quota","nombre d''impressions","disparu"],"solution":"La limite d''impressions prévue sur votre devis a été atteinte, il n''est donc plus possible d''imprimer.\nBonne nouvelle : vous pouvez continuer à prendre des photos numériques en illimité — elles sont bien enregistrées et restent disponibles.","image_url":null,"severity":"annoying","sort_order":21,"is_published":true},
{"org_id":null,"category":"Imprimante","title":"Les bandelettes ne sont plus coupées en deux (5×15 cm)","keywords":["bandelette","format","découpe","5x15","10x15","coupe","tirage"],"solution":"Contactez le loueur, il réglera le problème de format.","image_url":null,"severity":"annoying","sort_order":22,"is_published":true},
{"org_id":null,"category":"Photo","title":"« Appareil non détecté » / pas d''aperçu vidéo à l''écran","keywords":["appareil non détecté","aperçu","pas d''image","vidéo","caméra","appareil photo"],"solution":"Contactez le loueur.","image_url":null,"severity":"blocking","sort_order":30,"is_published":true},
{"org_id":null,"category":"Photo","title":"Photos trop sombres, trop claires ou toutes noires","keywords":["photo noire","trop sombre","trop claire","flash","luminosité","sombre"],"solution":"Réglez le flash (à l''intérieur du photobooth ou sur le photobooth selon le modèle).\nFaites deux photos d''essai en augmentant puis en baissant la puissance avec le bouton, jusqu''à obtenir le bon éclairage.","image_url":null,"severity":"annoying","sort_order":31,"is_published":true},
{"org_id":null,"category":"Partage","title":"Le bouton QR code ne réagit pas","keywords":["qr code","ne fonctionne pas","internet","réseau","partage","pas cliquable"],"solution":"C''est dû à une absence de connexion internet sur la borne sur le moment. Ce n''est pas grave : dès que le réseau revient, les photos sont automatiquement mises en ligne et disponibles.","image_url":null,"severity":"annoying","sort_order":40,"is_published":true},
{"org_id":null,"category":"Application","title":"« Licence non activée »","keywords":["licence","non activée","licence non activée","activation"],"solution":"Contactez le loueur pour réactiver la licence.","image_url":null,"severity":"blocking","sort_order":50,"is_published":true},
{"org_id":null,"category":"Application","title":"L''écran demande un code événement","keywords":["code événement","code","demande un code"],"solution":"Saisissez le code que vous avez reçu par email lors de la réservation.","image_url":null,"severity":"blocking","sort_order":51,"is_published":true},
{"org_id":null,"category":"Application","title":"L''écran demande un code PIN","keywords":["code pin","pin","mot de passe"],"solution":"C''est l''accès administrateur, réservé au loueur. N''y touchez pas et contactez le loueur si besoin.","image_url":null,"severity":"annoying","sort_order":52,"is_published":true},
{"org_id":null,"category":"Application","title":"Mauvais modèle / mauvais design affiché","keywords":["mauvais template","mauvais design","modèle","décor"],"solution":"Contactez le loueur pour resynchroniser le bon design.","image_url":null,"severity":"annoying","sort_order":53,"is_published":true},
{"org_id":null,"category":"Installation","title":"Il me manque un câble ou une pièce","keywords":["câble manquant","pièce manquante","oublié","il manque"],"solution":"Contactez le loueur.","image_url":null,"severity":"annoying","sort_order":60,"is_published":true}
]'::jsonb);

INSERT INTO "public"."rpc_rate_limit_salt" ("salt")
VALUES (encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'))
ON CONFLICT ("id") DO NOTHING;

-- Storage : buckets et politiques

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('app-releases', 'app-releases', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('decorations', 'decorations', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('designs', 'designs', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('fonts', 'fonts', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('kiosk-backgrounds', 'kiosk-backgrounds', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('photos', 'photos', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('template-backgrounds', 'template-backgrounds', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('thumbnails', 'thumbnails', 't', NULL, NULL) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read backgrounds" ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((bucket_id = 'template-backgrounds'::text));

CREATE POLICY app_releases_admin_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'app-releases'::text) AND public.is_app_admin()));

CREATE POLICY app_releases_admin_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'app-releases'::text) AND public.is_app_admin()));

CREATE POLICY app_releases_admin_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'app-releases'::text) AND public.is_app_admin()))
  WITH CHECK (((bucket_id = 'app-releases'::text) AND public.is_app_admin()));

CREATE POLICY app_releases_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((bucket_id = 'app-releases'::text));

CREATE POLICY decorations_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((bucket_id = 'decorations'::text));

CREATE POLICY designs_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((bucket_id = 'designs'::text));

CREATE POLICY designs_service_insert ON storage.objects AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK ((bucket_id = 'designs'::text));

CREATE POLICY designs_service_update ON storage.objects AS PERMISSIVE FOR UPDATE TO service_role
  USING ((bucket_id = 'designs'::text));

CREATE POLICY fonts_read ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING ((bucket_id = 'fonts'::text));

CREATE POLICY kiosk_bg_admin_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'kiosk-backgrounds'::text));

CREATE POLICY kiosk_bg_admin_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'kiosk-backgrounds'::text));

CREATE POLICY kiosk_bg_admin_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'kiosk-backgrounds'::text));

CREATE POLICY kiosk_bg_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((bucket_id = 'kiosk-backgrounds'::text));

CREATE POLICY storage_decorations_app_admin_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'decorations'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_decorations_app_admin_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'decorations'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_decorations_app_admin_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'decorations'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)))
  WITH CHECK (((bucket_id = 'decorations'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_fonts_app_admin_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'fonts'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_fonts_app_admin_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'fonts'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_fonts_app_admin_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'fonts'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)))
  WITH CHECK (((bucket_id = 'fonts'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_fonts_authenticated_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'fonts'::text));

CREATE POLICY storage_template_backgrounds_app_admin_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'template-backgrounds'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_template_backgrounds_app_admin_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'template-backgrounds'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

CREATE POLICY storage_template_backgrounds_app_admin_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'template-backgrounds'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)))
  WITH CHECK (((bucket_id = 'template-backgrounds'::text) AND ( SELECT public.is_app_admin() AS is_app_admin)));

-- Tâches planifiées (pg_cron)

SELECT cron.schedule('check-cron-alerts', '3-59/15 * * * *', '
  DO $cmd$
  DECLARE
    v_request_id BIGINT;
  BEGIN
    v_request_id := net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''project_url'')
                 || ''/functions/v1/check-cron-alerts'',
      headers := jsonb_build_object(
        ''Content-Type'',  ''application/json'',
        ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'')
      ),
      body    := ''{}''::jsonb,
      timeout_milliseconds := 30000
    );
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION ''Secrets Vault project_url / service_role_key absents : check-cron-alerts non appelée'';
    END IF;
    BEGIN
      INSERT INTO public.cron_http_calls (request_id, job_name, timeout_ms)
      VALUES (v_request_id, ''check-cron-alerts'', 30000);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING ''check-cron-alerts : appel % non tracé dans cron_http_calls (%)'', v_request_id, SQLERRM;
    END;
  END
  $cmd$;
  ');

SELECT cron.schedule('check-kiosk-alerts', '*/5 * * * *', 'SELECT public.cron_http_post(''check-kiosk-alerts'', ''check-kiosk-alerts'', 20000)');

SELECT cron.schedule('media-expiry', '15 9 * * *', 'SELECT public.cron_http_post(''media-expiry'', ''media-expiry'', 120000)');

SELECT cron.schedule('purge-booking-rate-limits', '0 3 * * *', ' DELETE FROM public.booking_rate_limits WHERE created_at < NOW() - INTERVAL ''48 hours'' ');

SELECT cron.schedule('purge-cron-history', '7 3 * * *', '
  DELETE FROM cron.job_run_details d
   WHERE COALESCE(d.end_time, d.start_time) < NOW() - INTERVAL ''14 days''
     AND d.runid NOT IN (
       SELECT DISTINCT ON (k.jobid) k.runid
         FROM cron.job_run_details k
        ORDER BY k.jobid, k.start_time DESC NULLS LAST
     )
     AND d.runid NOT IN (
       SELECT DISTINCT ON (k.jobid) k.runid
         FROM cron.job_run_details k
        WHERE k.status IN (''succeeded'', ''failed'')
        ORDER BY k.jobid, k.start_time DESC NULLS LAST
     )
  ');

SELECT cron.schedule('purge-kiosk-guest-responses', '15 3 * * *', '
  DELETE FROM public.kiosk_guest_responses r
   USING public.events e
   WHERE e.id = r.event_id
     AND public.guest_responses_purge_at(e.end_date, e.start_date, r.answered_at) < now()
  ');

SELECT cron.schedule('purge-kiosk-photo-consents', '20 3 * * *', '
  DELETE FROM public.kiosk_photo_consents c
   USING public.events e
   WHERE e.id = c.event_id
     AND public.photo_consents_purge_at(e.expires_at) < now()
  ');

SELECT cron.schedule('send-access-emails', '15 8 * * *', 'SELECT public.cron_http_post(''send-access-emails'', ''send-access-emails'', 20000)');

SELECT cron.schedule('send-delivery', '0 9 * * *', 'SELECT public.cron_http_post(''send-delivery'', ''send-delivery'', 20000)');

SELECT cron.schedule('send-design-reminders', '0 8 * * *', 'SELECT public.cron_http_post(''send-design-reminders'', ''send-design-reminders'', 20000)');
