-- LAB-423 : le secret des bornes n'est plus gardé en clair dans la base, seulement son empreinte SHA-256.
--
-- Avant : kiosk_licenses.secret (et kiosk_pairings.secret_to_deliver, le temps de la remise) contenaient
-- le secret de chaque borne en clair. Une fuite de la base (sauvegarde, export, requête de diagnostic)
-- donnait de quoi se faire passer pour n'importe quelle borne.
--
-- 1. kiosk_licenses.secret_hash : SHA-256 hexadécimal (64 caractères) du secret, rempli depuis les secrets
--    existants. Les bornes associées gardent leur secret : aucune nouvelle association n'est nécessaire.
-- 2. public.kiosk_secret_hash(secret) et public.kiosk_secret_matches(hash, secret) : SECURITY DEFINER,
--    search_path figé, fermées à PUBLIC, anon et authenticated (seules les RPC kiosk s'en servent).
--    Un secret vide ou NULL n'a pas d'empreinte et n'est jamais accepté (même règle qu'avant : secret <> '').
-- 3. Toutes les RPC kiosk qui vérifiaient secret = p_secret comparent l'empreinte (mêmes signatures, les
--    droits d'exécution sont gardés).
-- 4. Association (LAB-241) : le secret est créé par kiosk_pairing_poll au moment où il est remis à la borne,
--    seule son empreinte est écrite, il n'est rendu qu'une fois. L'approbation efface l'empreinte de la
--    licence visée (l'ancien secret cesse de marcher dès l'approbation, comme avant).
-- 5. Les colonnes en clair kiosk_licenses.secret et kiosk_pairings.secret_to_deliver sont supprimées
--    plutôt que vidées : un lecteur oublié échoue franchement au lieu de comparer ou de réécrire du clair.
--
-- Déploiement : la fonction get-kiosk-upload-url compare aussi l'empreinte. La redéployer juste après cette
-- migration (l'ancienne version lit la colonne secret, supprimée ici).
-- Aucun changement côté borne (elle envoie toujours p_secret) ni dans le .pola.
-- Idempotente : ADD COLUMN IF NOT EXISTS, remplissage seulement si la colonne en clair existe encore,
-- CREATE OR REPLACE, DROP COLUMN IF EXISTS.

ALTER TABLE public.kiosk_licenses ADD COLUMN IF NOT EXISTS secret_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.kiosk_licenses'::regclass AND conname = 'kiosk_licenses_secret_hash_format'
  ) THEN
    ALTER TABLE public.kiosk_licenses ADD CONSTRAINT kiosk_licenses_secret_hash_format
      CHECK (secret_hash IS NULL OR secret_hash ~ '^[0-9a-f]{64}$');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_secret_hash(p_secret TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_secret IS NULL OR p_secret = '' THEN NULL
              ELSE encode(sha256(convert_to(p_secret, 'UTF8')), 'hex') END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_secret_matches(p_secret_hash TEXT, p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_secret_hash = public.kiosk_secret_hash(p_secret), false);
$$;

REVOKE ALL ON FUNCTION public.kiosk_secret_hash(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_secret_matches(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Remplissage depuis le clair, tant que la colonne existe (SQL dynamique : rejouer la migration reste possible).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kiosk_licenses' AND column_name = 'secret'
  ) THEN
    EXECUTE 'UPDATE public.kiosk_licenses SET secret_hash = public.kiosk_secret_hash(secret)
              WHERE secret_hash IS NULL AND secret IS NOT NULL AND secret <> ''''';
  END IF;
END;
$$;

-- RPC kiosk : comparaison de l'empreinte au lieu du clair.

CREATE OR REPLACE FUNCTION public.kiosk_check_license(p_machine_id text, p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT is_active
    FROM public.kiosk_licenses
    WHERE machine_id = p_machine_id
      AND retired_at IS NULL
      AND public.kiosk_secret_matches(secret_hash, p_secret)
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.kiosk_heartbeat(
  p_machine_id      text,
  p_secret          text,
  p_app_version     text,
  p_printer_status  text,
  p_printer_name    text,
  p_pending_uploads int  DEFAULT NULL,
  p_camera_status   text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    AND public.kiosk_secret_matches(secret_hash, p_secret);
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_get_event(p_code TEXT, p_machine_id TEXT, p_secret TEXT)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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
     AND public.kiosk_secret_matches(l.secret_hash, p_secret);
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

CREATE OR REPLACE FUNCTION public.kiosk_get_event_request(p_machine_id text, p_secret text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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
     AND public.kiosk_secret_matches(l.secret_hash, p_secret)
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

CREATE OR REPLACE FUNCTION public.kiosk_ack_event_request(
  p_machine_id   text,
  p_secret       text,
  p_event_id     uuid,
  p_error        text        DEFAULT NULL,
  p_requested_at timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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
     AND public.kiosk_secret_matches(l.secret_hash, p_secret)
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
     AND public.kiosk_secret_matches(l.secret_hash, p_secret);
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
     AND public.kiosk_secret_matches(l.secret_hash, p_secret);
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

CREATE OR REPLACE FUNCTION public.kiosk_get_admin_pin(p_machine_id text, p_secret text)
RETURNS TABLE (pin_hash text, pin_set_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT l.id INTO v_id
  FROM public.kiosk_licenses l
  WHERE l.machine_id = p_machine_id
    AND l.is_active
    AND public.kiosk_secret_matches(l.secret_hash, p_secret)
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

CREATE OR REPLACE FUNCTION public.kiosk_get_update_request(p_machine_id text, p_secret text)
RETURNS TABLE (version text, exe_url text, sha256 text, requested_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT l.id INTO v_id
  FROM public.kiosk_licenses l
  WHERE l.machine_id = p_machine_id
    AND l.is_active
    AND public.kiosk_secret_matches(l.secret_hash, p_secret)
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

CREATE OR REPLACE FUNCTION public.kiosk_report_update_failure(
  p_machine_id   text,
  p_secret       text,
  p_version      text,
  p_error        text,
  p_requested_at timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.kiosk_licenses l SET
    update_failed_at = now(),
    update_error     = left(COALESCE(NULLIF(btrim(p_error), ''), 'Échec sans détail'), 500)
  WHERE l.machine_id = p_machine_id
    AND l.is_active
    AND public.kiosk_secret_matches(l.secret_hash, p_secret)
    AND l.update_requested_version = p_version
    AND l.update_requested_at IS NOT NULL
    AND (p_requested_at IS NULL OR l.update_requested_at = p_requested_at)
    AND (l.update_failed_at IS NULL OR l.update_failed_at < l.update_requested_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_record_photo(
  p_code           TEXT,
  p_event_id       UUID,
  p_storage_path   TEXT,
  p_photo_url      TEXT,
  p_machine_id     TEXT,
  p_secret         TEXT,
  p_captured_at    TIMESTAMPTZ DEFAULT NULL,
  p_media_type     TEXT        DEFAULT 'photo',
  p_thumbnail_path TEXT        DEFAULT NULL,
  p_duration_ms    INTEGER     DEFAULT NULL,
  p_width          INTEGER     DEFAULT NULL,
  p_height         INTEGER     DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
      AND public.kiosk_secret_matches(secret_hash, p_secret)
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
$$;

CREATE OR REPLACE FUNCTION public.kiosk_record_print(
  p_code       TEXT,
  p_event_id   UUID,
  p_id         UUID,
  p_session_id UUID,
  p_copies     INT,
  p_printed_at TIMESTAMPTZ,
  p_machine_id TEXT,
  p_secret     TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses
    WHERE machine_id = p_machine_id
      AND is_active
      AND public.kiosk_secret_matches(secret_hash, p_secret)
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

CREATE OR REPLACE FUNCTION public.kiosk_record_photo_consent(
  p_code         text,
  p_event_id     uuid,
  p_machine_id   text,
  p_secret       text,
  p_consent_id   uuid,
  p_session_id   uuid,
  p_consented_at timestamptz,
  p_consent_text text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expires_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_licenses l
    WHERE l.machine_id = p_machine_id
      AND l.is_active
      AND public.kiosk_secret_matches(l.secret_hash, p_secret)
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

CREATE OR REPLACE FUNCTION public.kiosk_record_guest_response(
  p_code              text,
  p_event_id          uuid,
  p_machine_id        text,
  p_secret            text,
  p_response_id       uuid,
  p_answered_at       timestamptz,
  p_answers           jsonb,
  p_questions         jsonb,
  p_marketing_consent boolean,
  p_consent_text      text,
  p_notice_hash       text,
  p_session_ids       uuid[])
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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
      AND public.kiosk_secret_matches(l.secret_hash, p_secret)
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
      AND public.kiosk_secret_matches(secret_hash, p_secret)
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


-- Association : le secret est créé à la remise, seule son empreinte est écrite.

CREATE OR REPLACE FUNCTION public.kiosk_pairing_start(
  p_machine_id      TEXT,
  p_machine_name    TEXT,
  p_app_version     TEXT,
  p_device_key_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  UPDATE public.kiosk_pairings SET status = 'cancelled'
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
$$;

CREATE OR REPLACE FUNCTION public.kiosk_pairing_approve(
  p_code               TEXT,
  p_label              TEXT,
  p_replace_license_id UUID DEFAULT NULL,
  p_org_id             UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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

  IF v_target IS NULL THEN
    INSERT INTO public.kiosk_licenses (machine_id, machine_name, app_version, label, org_id, is_active, secret_hash, activated_at)
    VALUES (v_row.machine_id, v_row.machine_name, v_row.app_version, v_label, v_org.id, true, NULL, now())
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
      secret_hash  = NULL,
      activated_at = now()
    WHERE id = v_target;
  END IF;

  -- Une approbation plus ancienne de la même borne, pas encore remise, ne doit plus livrer de secret.
  UPDATE public.kiosk_pairings SET status = 'cancelled'
   WHERE license_id = v_target AND status = 'approved' AND id <> v_row.id;

  UPDATE public.kiosk_pairings SET
    status            = 'approved',
    org_id            = v_org.id,
    license_id        = v_target,
    approved_by       = v_uid,
    approved_at       = now()
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

CREATE OR REPLACE FUNCTION public.kiosk_pairing_poll(p_pairing_id UUID, p_device_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     public.kiosk_pairings%ROWTYPE;
  v_key     TEXT := lower(btrim(COALESCE(p_device_key, '')));
  v_key_ok  BOOLEAN := false;
  v_label   TEXT;
  v_org     TEXT;
  v_secret  TEXT;
BEGIN
  SELECT * INTO v_row FROM public.kiosk_pairings WHERE id = p_pairing_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.status IN ('delivered', 'cancelled') THEN
    RETURN jsonb_build_object('status', v_row.status);
  END IF;

  IF v_row.poll_count + 1 > 400 THEN
    UPDATE public.kiosk_pairings SET poll_count = v_row.poll_count + 1, status = 'cancelled'
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
             status = 'cancelled'
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

  -- Le secret est créé au moment de la remise : la base n'en garde que l'empreinte, il n'est rendu qu'une fois.
  v_secret := 'ks_' || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.kiosk_licenses SET secret_hash = public.kiosk_secret_hash(v_secret)
   WHERE id = v_row.license_id AND retired_at IS NULL;
  IF NOT FOUND THEN
    UPDATE public.kiosk_pairings SET poll_count = v_row.poll_count + 1, status = 'cancelled'
     WHERE id = v_row.id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  UPDATE public.kiosk_pairings
     SET poll_count = v_row.poll_count + 1, status = 'delivered', delivered_at = now()
   WHERE id = v_row.id;

  SELECT l.label, o.name INTO v_label, v_org
    FROM public.kiosk_licenses l
    JOIN public.organizations o ON o.id = l.org_id
   WHERE l.id = v_row.license_id;

  RETURN jsonb_build_object(
    'status',     'approved',
    'secret',     v_secret,
    'license_id', v_row.license_id,
    'label',      v_label,
    'org_name',   v_org,
    'org_id',     v_row.org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_retire_license(p_license_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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
     SET retired_at = COALESCE(retired_at, now()), is_active = false, secret_hash = NULL
   WHERE id = p_license_id
  RETURNING retired_at INTO v_retired;

  UPDATE public.kiosk_pairings SET status = 'cancelled'
   WHERE license_id = p_license_id AND status = 'approved';

  RETURN jsonb_build_object('id', p_license_id, 'retired_at', v_retired);
END;
$$;

ALTER TABLE public.kiosk_pairings DROP COLUMN IF EXISTS secret_to_deliver;
ALTER TABLE public.kiosk_licenses DROP COLUMN IF EXISTS secret;

COMMENT ON COLUMN public.kiosk_licenses.secret_hash IS
  'SHA-256 hexadecimal du secret de la borne (LAB-423). Le secret en clair n''est jamais garde : il est rendu une seule fois par kiosk_pairing_poll.';

NOTIFY pgrst, 'reload schema';
