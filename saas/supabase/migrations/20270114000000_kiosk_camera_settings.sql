-- LAB-426 : réglages de l'appareil photo par borne (spec docs/specs/reglages-appareil-photo.md).
--
-- La borne lit sur le Canon le mode de la molette, les valeurs actuelles (vitesse, ouverture, ISO,
-- balance des blancs, kelvins) et les valeurs que l'appareil accepte. Elle l'envoie au battement de cœur.
-- Le SaaS affiche ce rapport et peut demander d'autres valeurs, prises dans ces listes. La borne relève
-- la demande, l'applique de retour à l'accueil (jamais pendant une prise de vue) et rend compte.
--
-- 1. kiosk_licenses.camera_report (jsonb, écrit par kiosk_heartbeat seulement) :
--      { model, mode, settable, values: {tv, av, iso, wb, kelvin},
--        options: {tv: [{code, label}], av: [...], iso: [...], wb: [...], kelvin: [...]}, at, received_at }
--    Les codes sont ceux de Canon (entiers) ; le serveur ne les interprète pas, il vérifie seulement qu'une
--    valeur demandée figure dans la liste rapportée. Taille bornée (32 Kio).
-- 2. kiosk_licenses.camera_request (jsonb) :
--      { values, requested_at, requested_by, status, received_at, applied_at, result, error }
--    status : pending (demandé), received (relevé par la borne), applied (appliqué), refused (refusé).
-- 3. kiosk_heartbeat : nouveau paramètre p_camera_report DEFAULT NULL. NULL ou rapport illisible : rien
--    ne change (une ancienne borne reste acceptée, le battement de cœur passe toujours).
-- 4. set_kiosk_camera_settings(p_license_id, p_values) : SaaS, propriétaire (ou super-admin).
--    kiosk_get_camera_request(p_machine_id, p_secret) et kiosk_ack_camera_request(...) : borne, licence vérifiée.
-- 5. Borne retirée ou passée sur un autre PC : rapport et demande effacés.
--
-- Rien dans form_config ni dans le .pola (réglage par borne, pas par événement). Migration publique (cœur).
-- Ancienne signature du battement de cœur supprimée (pas de surcharge).
-- Idempotente : IF NOT EXISTS, DROP ... IF EXISTS, CREATE OR REPLACE. Aucun secret, aucune donnée.

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kiosk_licenses
  ADD COLUMN IF NOT EXISTS camera_report  jsonb,
  ADD COLUMN IF NOT EXISTS camera_request jsonb;

ALTER TABLE public.kiosk_licenses DROP CONSTRAINT IF EXISTS kiosk_licenses_camera_report_check;
ALTER TABLE public.kiosk_licenses
  ADD CONSTRAINT kiosk_licenses_camera_report_check
  CHECK (camera_report IS NULL
         OR (jsonb_typeof(camera_report) = 'object' AND octet_length(camera_report::text) <= 32768));

ALTER TABLE public.kiosk_licenses DROP CONSTRAINT IF EXISTS kiosk_licenses_camera_request_check;
ALTER TABLE public.kiosk_licenses
  ADD CONSTRAINT kiosk_licenses_camera_request_check
  CHECK (camera_request IS NULL
         OR (jsonb_typeof(camera_request) = 'object' AND octet_length(camera_request::text) <= 4096));

COMMENT ON COLUMN public.kiosk_licenses.camera_report IS
  'LAB-426 : réglages de l''appareil photo lus par la borne (mode, valeurs, listes permises, codes Canon). Écrit par kiosk_heartbeat seulement.';
COMMENT ON COLUMN public.kiosk_licenses.camera_request IS
  'LAB-426 : réglages demandés depuis le SaaS (set_kiosk_camera_settings) et leur suivi (pending, received, applied, refused).';

-- Lecture par le SaaS (s'ajoute aux colonnes déjà lisibles) ; aucune écriture directe.
GRANT SELECT (camera_report, camera_request) ON public.kiosk_licenses TO authenticated;

-- ── 2. Borne retirée ou autre PC : rapport et demande effacés ───────────────────────────────

CREATE OR REPLACE FUNCTION public.kiosk_licenses_clear_camera()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.retired_at IS NOT NULL AND OLD.retired_at IS NULL)
     OR NEW.machine_id IS DISTINCT FROM OLD.machine_id THEN
    NEW.camera_report  := NULL;
    NEW.camera_request := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_licenses_clear_camera() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS kiosk_licenses_clear_camera ON public.kiosk_licenses;
CREATE TRIGGER kiosk_licenses_clear_camera
  BEFORE UPDATE OF retired_at, machine_id ON public.kiosk_licenses
  FOR EACH ROW EXECUTE FUNCTION public.kiosk_licenses_clear_camera();

-- ── 3. Battement de cœur ────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.kiosk_heartbeat(text, text, text, text, text, int, text);

-- Même corps que 20270112000423_kiosk_secret_hash.sql, plus camera_report.
CREATE OR REPLACE FUNCTION public.kiosk_heartbeat(
  p_machine_id      text,
  p_secret          text,
  p_app_version     text,
  p_printer_status  text,
  p_printer_name    text,
  p_pending_uploads int   DEFAULT NULL,
  p_camera_status   text  DEFAULT NULL,
  p_camera_report   jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report_ok boolean := p_camera_report IS NOT NULL
                         AND jsonb_typeof(p_camera_report) = 'object'
                         AND octet_length(p_camera_report::text) <= 32000;
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
    camera_status_at   = CASE WHEN p_camera_status IN ('ok', 'disconnected') THEN now() ELSE camera_status_at END,
    camera_report      = CASE WHEN v_report_ok
                              THEN p_camera_report || jsonb_build_object('received_at', now())
                              ELSE camera_report END
  WHERE machine_id = p_machine_id
    AND retired_at IS NULL
    AND public.kiosk_secret_matches(secret_hash, p_secret);
END;
$$;
REVOKE ALL ON FUNCTION public.kiosk_heartbeat(text, text, text, text, text, int, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_heartbeat(text, text, text, text, text, int, text, jsonb) TO anon, service_role;

-- ── 4. Demande (SaaS) ───────────────────────────────────────────────────────────────────────

-- p_values : objet dont les clés sont parmi tv, av, iso, wb, kelvin (au moins une), chaque valeur un code
-- présent dans camera_report.options de la borne. Une nouvelle demande remplace la précédente (le dernier
-- changement gagne). Réponse : la demande enregistrée.
CREATE OR REPLACE FUNCTION public.set_kiosk_camera_settings(p_license_id uuid, p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_admin   boolean;
  v_retired timestamptz;
  v_active  boolean;
  v_report  jsonb;
  v_key     text;
  v_value   jsonb;
  v_label   text;
  v_request jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_kiosk_camera_settings : connexion requise' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_app_admin();

  SELECT l.retired_at, l.is_active, l.camera_report INTO v_retired, v_active, v_report
    FROM public.kiosk_licenses l
   WHERE l.id = p_license_id
     AND (v_admin OR l.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = v_uid))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borne introuvable dans votre compte.' USING ERRCODE = '42501';
  END IF;
  IF v_retired IS NOT NULL THEN
    RAISE EXCEPTION 'Cette borne est retirée.' USING ERRCODE = '55000';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'Cette borne est désactivée : réactivez-la avant de changer ses réglages.' USING ERRCODE = '55000';
  END IF;
  IF v_report IS NULL OR jsonb_typeof(v_report -> 'options') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'La borne n''a pas encore envoyé les réglages de son appareil photo.' USING ERRCODE = '55000';
  END IF;
  IF (v_report -> 'settable') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Molette de l''appareil sur % : mettez-la sur M pour changer les réglages.',
      COALESCE(NULLIF(v_report ->> 'mode', ''), 'un autre mode') USING ERRCODE = '55000';
  END IF;

  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' OR p_values = '{}'::jsonb THEN
    RAISE EXCEPTION 'Aucun réglage à changer.' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_values) LOOP
    v_label := CASE v_key
      WHEN 'tv' THEN 'vitesse' WHEN 'av' THEN 'ouverture' WHEN 'iso' THEN 'ISO'
      WHEN 'wb' THEN 'balance des blancs' WHEN 'kelvin' THEN 'température de couleur' END;
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Réglage inconnu : %.', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value) <> 'number'
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(v_report -> 'options' -> v_key) = 'array'
                       THEN v_report -> 'options' -> v_key ELSE '[]'::jsonb END) o
          WHERE o -> 'code' = v_value) THEN
      RAISE EXCEPTION 'Valeur non proposée par l''appareil pour la %.', v_label USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_request := jsonb_build_object(
    'values',       p_values,
    'requested_at', now(),
    'requested_by', v_uid,
    'status',       'pending');

  UPDATE public.kiosk_licenses l SET camera_request = v_request WHERE l.id = p_license_id;
  RETURN v_request;
END;
$$;

-- ── 5. Relève et compte rendu (borne) ───────────────────────────────────────────────────────

-- Demande en attente (pending ou received) : { values, requested_at }, sinon NULL. La première relève
-- passe la demande en received.
CREATE OR REPLACE FUNCTION public.kiosk_get_camera_request(p_machine_id text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      uuid;
  v_request jsonb;
BEGIN
  SELECT l.id, l.camera_request INTO v_id, v_request
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND public.kiosk_secret_matches(l.secret_hash, p_secret)
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_get_camera_request : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  IF v_request IS NULL OR v_request ->> 'status' NOT IN ('pending', 'received') THEN
    RETURN NULL;
  END IF;

  IF v_request ->> 'status' = 'pending' THEN
    UPDATE public.kiosk_licenses l
       SET camera_request = l.camera_request || jsonb_build_object('status', 'received', 'received_at', now())
     WHERE l.id = v_id;
  END IF;

  RETURN jsonb_build_object('values', v_request -> 'values', 'requested_at', v_request -> 'requested_at');
END;
$$;

-- p_status : applied (p_values = valeurs relues sur l'appareil) ou refused (p_error = raison, 500 caractères
-- au plus). Ignoré (false) si la demande a été remplacée entre-temps (p_requested_at différent) ou déjà
-- close.
CREATE OR REPLACE FUNCTION public.kiosk_ack_camera_request(
  p_machine_id   text,
  p_secret       text,
  p_requested_at timestamptz,
  p_status       text,
  p_values       jsonb DEFAULT NULL,
  p_error        text  DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_error  text := left(NULLIF(btrim(COALESCE(p_error, '')), ''), 500);
  v_result jsonb := CASE WHEN jsonb_typeof(p_values) = 'object' AND octet_length(p_values::text) <= 1024
                         THEN p_values END;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('applied', 'refused') THEN
    RAISE EXCEPTION 'kiosk_ack_camera_request : état inconnu' USING ERRCODE = '22023';
  END IF;

  SELECT l.id INTO v_id
    FROM public.kiosk_licenses l
   WHERE l.machine_id = p_machine_id
     AND l.is_active
     AND l.retired_at IS NULL
     AND public.kiosk_secret_matches(l.secret_hash, p_secret)
   FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'kiosk_ack_camera_request : licence de la borne invalide' USING ERRCODE = '42501';
  END IF;

  UPDATE public.kiosk_licenses l SET
    camera_request = l.camera_request || jsonb_build_object(
      'status',      p_status,
      'received_at', COALESCE(l.camera_request -> 'received_at', to_jsonb(now())),
      'applied_at',  CASE WHEN p_status = 'applied' THEN to_jsonb(now()) END,
      'result',      CASE WHEN p_status = 'applied' THEN v_result END,
      'error',       CASE WHEN p_status = 'refused' THEN to_jsonb(COALESCE(v_error, 'Refusé sans détail')) END)
  WHERE l.id = v_id
    AND l.camera_request IS NOT NULL
    AND l.camera_request ->> 'status' IN ('pending', 'received')
    AND (l.camera_request ->> 'requested_at')::timestamptz = p_requested_at;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_kiosk_camera_settings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_get_camera_request(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_ack_camera_request(text, text, timestamptz, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_kiosk_camera_settings(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_get_camera_request(text, text) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_ack_camera_request(text, text, timestamptz, text, jsonb, text) TO anon, service_role;

NOTIFY pgrst, 'reload schema';
