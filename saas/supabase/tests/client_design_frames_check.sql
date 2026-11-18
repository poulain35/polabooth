-- LAB-311 — Vérification des cadres multiples par événement (client_designs.slot et label,
-- design_versions.slot) et du champ frames de kiosk_get_approved_design, à lancer APRÈS la migration
-- 20261222000000_client_design_frames.sql (SQL Editor ou API de gestion, rôle postgres).
--
-- Tout se passe dans une transaction annulée (ROLLBACK final) : aucune donnée n'est modifiée.
-- Chaque contrôle lève une erreur « LAB-311 KO : … » en cas d'échec ; si le script va jusqu'au
-- bout, la dernière requête affiche « LAB-311 OK ».
--
-- Contrôles :
--   0. Structure : slot (smallint NOT NULL, défaut 1) sur les deux tables, label (text) sur
--      client_designs, CHECK slot 1 à 4, CHECK un seul écran d'accueil, CHECK label 24 caractères,
--      UNIQUE (event_id, kind, slot) seul, index (event_id, kind, slot, created_at DESC), droits de
--      la RPC inchangés (anon et service_role seulement).
--   1. Contraintes : slot hors de 1 à 4 refusé, écran d'accueil en slot 2 refusé, label de
--      25 caractères refusé, deux lignes au même (événement, kind, slot) refusées, quatre cadres
--      acceptés, upsert ON CONFLICT (event_id, kind, slot) sans slot qui ne touche que le cadre 1.
--   2. Borne (anon) : cadre validé au plus petit slot, avec label ; frames = autres cadres validés
--      triés par slot seulement si frame_choice.enabled vaut true (null si absent, faux ou
--      « "true" » texte ; [] s'il n'y a pas d'autre cadre) ; home_design inchangé ; NULL sans cadre
--      validé ; rien pour l'événement d'un autre compte ; licence fausse refusée.
--
-- Aucun secret réel, aucun identifiant de projet, aucune donnée personnelle.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 0. Structure (rôle postgres)
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_designs', 'design_versions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t AND column_name = 'slot'
                      AND data_type = 'smallint' AND is_nullable = 'NO' AND column_default = '1') THEN
      RAISE EXCEPTION 'LAB-311 KO : %.slot absente ou mal definie', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = ('public.' || t)::regclass AND contype = 'c'
                      AND pg_get_constraintdef(oid) = 'CHECK (((slot >= 1) AND (slot <= 4)))') THEN
      RAISE EXCEPTION 'LAB-311 KO : CHECK slot 1 a 4 absent sur %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'client_designs' AND column_name = 'label'
                    AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'LAB-311 KO : client_designs.label absente ou mal definie';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.client_designs'::regclass AND conname = 'client_designs_home_slot_check'
                    AND pg_get_constraintdef(oid) = 'CHECK (((kind = ''print''::text) OR (slot = 1)))') THEN
    RAISE EXCEPTION 'LAB-311 KO : CHECK un seul ecran d''accueil absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.client_designs'::regclass AND conname = 'client_designs_label_check'
                    AND pg_get_constraintdef(oid) = 'CHECK (((label IS NULL) OR (char_length(label) <= 24)))') THEN
    RAISE EXCEPTION 'LAB-311 KO : CHECK label 24 caracteres absent';
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.client_designs'::regclass AND contype = 'u';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conrelid = 'public.client_designs'::regclass AND contype = 'u'
                              AND conname = 'client_designs_event_id_kind_slot_key'
                              AND pg_get_constraintdef(oid) = 'UNIQUE (event_id, kind, slot)') THEN
    RAISE EXCEPTION 'LAB-311 KO : client_designs doit avoir UNIQUE (event_id, kind, slot) et rien d''autre';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'design_versions'
                    AND indexname = 'design_versions_event_kind_slot_created'
                    AND indexdef ILIKE '%(event_id, kind, slot, created_at DESC)') THEN
    RAISE EXCEPTION 'LAB-311 KO : index design_versions (event_id, kind, slot, created_at DESC) absent';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'design_versions_event_kind_created') THEN
    RAISE EXCEPTION 'LAB-311 KO : ancien index design_versions_event_kind_created encore present';
  END IF;

  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'kiosk_get_approved_design';
  IF n <> 1 THEN RAISE EXCEPTION 'LAB-311 KO : % signature(s) de kiosk_get_approved_design', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE pronamespace = 'public'::regnamespace AND proname = 'kiosk_get_approved_design'
                    AND prosecdef AND 'search_path=public, pg_temp' = ANY (proconfig)) THEN
    RAISE EXCEPTION 'LAB-311 KO : kiosk_get_approved_design sans SECURITY DEFINER ou search_path';
  END IF;
  IF NOT has_function_privilege('anon', 'public.kiosk_get_approved_design(text, text, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.kiosk_get_approved_design(text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'LAB-311 KO : EXECUTE manquant sur kiosk_get_approved_design';
  END IF;
  IF has_function_privilege('authenticated', 'public.kiosk_get_approved_design(text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'LAB-311 KO : kiosk_get_approved_design ouverte a authenticated';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. Données de test et contraintes (rôle postgres)
-- ────────────────────────────────────────────────────────────
SELECT set_config('request.headers', '', true);
SELECT set_config('lab311.ua', gen_random_uuid()::text, true);
SELECT set_config('lab311.ub', gen_random_uuid()::text, true);

-- Insère un cadre 'print' et garde son id dans lab311.f_<événement>_<slot>.
CREATE FUNCTION pg_temp.lab311_frame(p_key text, p_slot smallint, p_status text, p_label text, p_format text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.client_designs (event_id, slot, label, canvas_json, format, final_png_url, status)
  VALUES (current_setting('lab311.e_' || p_key)::uuid, p_slot, p_label,
          jsonb_build_object('objects', '[]'::jsonb, 'lab', p_key || '_' || p_slot), p_format,
          'https://example.test/lab311/' || p_key || '/' || p_slot || '.png', p_status)
  RETURNING id INTO v;
  PERFORM set_config('lab311.f_' || p_key || '_' || p_slot, v::text, true);
END $$;

DO $$
DECLARE
  oa    uuid;
  ob    uuid;
  v_id  uuid;
  v_id2 uuid;
  k     text;
  cfg   jsonb;
BEGIN
  FOREACH k IN ARRAY ARRAY[current_setting('lab311.ua'), current_setting('lab311.ub')] LOOP
    INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (k::uuid, 'authenticated', 'authenticated', 'lab311.' || left(k, 8) || '@example.test', now(), now());
  END LOOP;

  INSERT INTO public.organizations (owner_id, name, created_at)
  VALUES (current_setting('lab311.ua')::uuid, 'LAB-311 compte A', '2000-01-01') RETURNING organizations.id INTO oa;
  INSERT INTO public.organizations (owner_id, name, created_at)
  VALUES (current_setting('lab311.ub')::uuid, 'LAB-311 compte B', '2000-01-01') RETURNING organizations.id INTO ob;

  -- single : un cadre validé, sans frame_choice                 → frames null (comme avant)
  -- off    : cadres 1, 2, 3 validés, frame_choice absent        → cadre 1, frames null
  -- false  : idem, enabled = false                              → frames null
  -- text   : idem, enabled = "true" (texte)                     → frames null
  -- on     : enabled = true ; 1 validé, 2 envoyé, 3 et 4 validés, écran d'accueil validé
  --                                                             → cadre 1, frames [3, 4], home_design
  -- first  : enabled = true ; 1 refusé, 2 et 3 validés          → cadre 2, frames [3]
  -- alone  : enabled = true ; seul le cadre 1 validé            → frames []
  -- none   : enabled = true ; cadre 1 en brouillon              → NULL
  -- other  : compte B, enabled = true, cadres 1 et 2 validés    → rien pour la borne de A
  FOREACH k IN ARRAY ARRAY['single', 'off', 'false', 'text', 'on', 'first', 'alone', 'none', 'other'] LOOP
    cfg := CASE k
      WHEN 'single' THEN '{"kiosk":{}}'
      WHEN 'off'    THEN '{"kiosk":{"home":{"personalized":true,"client_design":true}}}'
      WHEN 'false'  THEN '{"kiosk":{"frame_choice":{"enabled":false,"max_frames":3}}}'
      WHEN 'text'   THEN '{"kiosk":{"frame_choice":{"enabled":"true","max_frames":3}}}'
      WHEN 'on'     THEN '{"kiosk":{"home":{"personalized":true,"client_design":true},"frame_choice":{"enabled":true,"max_frames":4}}}'
      ELSE               '{"kiosk":{"frame_choice":{"enabled":true,"max_frames":3}}}'
    END;
    INSERT INTO public.events (org_id, name, access_code, status, start_date, end_date, form_config)
    VALUES (CASE k WHEN 'other' THEN ob ELSE oa END, 'LAB-311 ' || k,
            'L311' || upper(substr(md5(gen_random_uuid()::text), 1, 8)), 'active',
            now() - interval '1 hour', now() + interval '6 hours', cfg)
    RETURNING events.id INTO v_id;
    PERFORM set_config('lab311.e_' || k, v_id::text, true);
  END LOOP;

  -- Cadres insérés dans le désordre : l'ordre de la réponse doit venir de slot.
  PERFORM pg_temp.lab311_frame('single', 1::smallint, 'approved', NULL, 'portrait');
  FOREACH k IN ARRAY ARRAY['off', 'false', 'text'] LOOP
    PERFORM pg_temp.lab311_frame(k, 3::smallint, 'approved', 'Bande', 'stripV');
    PERFORM pg_temp.lab311_frame(k, 1::smallint, 'approved', 'Cadre 1', 'portrait');
    PERFORM pg_temp.lab311_frame(k, 2::smallint, 'approved', 'Cadre 2', 'landscape');
  END LOOP;
  PERFORM pg_temp.lab311_frame('on', 4::smallint, 'approved', 'Paysage', 'landscape');
  PERFORM pg_temp.lab311_frame('on', 2::smallint, 'submitted', 'En attente', 'portrait');
  PERFORM pg_temp.lab311_frame('on', 3::smallint, 'approved', 'Bande de 24 caracteres!!', 'stripV');
  PERFORM pg_temp.lab311_frame('on', 1::smallint, 'approved', 'Portrait', 'portrait');
  PERFORM pg_temp.lab311_frame('first', 3::smallint, 'approved', 'Trois', 'stripV');
  PERFORM pg_temp.lab311_frame('first', 1::smallint, 'rejected', 'Un', 'portrait');
  PERFORM pg_temp.lab311_frame('first', 2::smallint, 'approved', 'Deux', 'portrait');
  PERFORM pg_temp.lab311_frame('alone', 1::smallint, 'approved', NULL, 'portrait');
  PERFORM pg_temp.lab311_frame('none', 1::smallint, 'draft', NULL, 'portrait');
  PERFORM pg_temp.lab311_frame('other', 1::smallint, 'approved', NULL, 'portrait');
  PERFORM pg_temp.lab311_frame('other', 2::smallint, 'approved', NULL, 'portrait');

  INSERT INTO public.client_designs (event_id, kind, canvas_json, format, final_png_url, status)
  VALUES (current_setting('lab311.e_on')::uuid, 'home', '{"objects":[]}', 'home',
          'https://example.test/lab311/on/home.png', 'approved')
  RETURNING client_designs.id INTO v_id2;
  PERFORM set_config('lab311.h_on', v_id2::text, true);

  v_id := current_setting('lab311.e_alone')::uuid;

  -- Défaut : slot 1 sans label.
  IF (SELECT slot FROM public.client_designs WHERE id = v_id2) IS DISTINCT FROM 1::smallint THEN
    RAISE EXCEPTION 'LAB-311 KO : client_designs.slot ne vaut pas 1 par defaut';
  END IF;

  -- Écran d'accueil unique : slot 2 refusé, même sur un événement sans écran.
  BEGIN
    INSERT INTO public.client_designs (event_id, kind, slot, format, status) VALUES (v_id, 'home', 2, 'home', 'draft');
    RAISE EXCEPTION 'LAB-311 KO : deuxieme ecran d''accueil (slot 2) accepte';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.client_designs (event_id, kind, format, status)
    VALUES (current_setting('lab311.e_on')::uuid, 'home', 'home', 'draft');
    RAISE EXCEPTION 'LAB-311 KO : deuxieme ecran d''accueil (slot 1) accepte';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Numéros de cadre : 1 à 4, un seul par numéro.
  FOREACH k IN ARRAY ARRAY['0', '5', '-1'] LOOP
    BEGIN
      INSERT INTO public.client_designs (event_id, slot, format, status) VALUES (v_id, k::smallint, 'portrait', 'draft');
      RAISE EXCEPTION 'LAB-311 KO : slot % accepte', k;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.client_designs (event_id, slot, format, status) VALUES (v_id, 1, 'portrait', 'draft');
    RAISE EXCEPTION 'LAB-311 KO : deux cadres au slot 1 acceptes';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.client_designs (event_id, slot, format, status) VALUES (v_id, 2, 'portrait', 'draft');
  INSERT INTO public.client_designs (event_id, slot, format, status) VALUES (v_id, 4, 'stripV', 'draft');

  -- Nom : 24 caractères au plus (caractères, pas octets).
  INSERT INTO public.client_designs (event_id, slot, label, format, status)
  VALUES (v_id, 3, repeat(chr(233), 24), 'portrait', 'draft');
  BEGIN
    UPDATE public.client_designs SET label = repeat('a', 25) WHERE event_id = v_id AND slot = 3;
    RAISE EXCEPTION 'LAB-311 KO : label de 25 caracteres accepte';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- design_versions : slot 1 par défaut, 1 à 4.
  INSERT INTO public.design_versions (event_id, canvas_json, format) VALUES (v_id, '{}', 'portrait')
  RETURNING design_versions.id INTO v_id2;
  IF (SELECT slot FROM public.design_versions WHERE id = v_id2) IS DISTINCT FROM 1::smallint THEN
    RAISE EXCEPTION 'LAB-311 KO : design_versions.slot ne vaut pas 1 par defaut';
  END IF;
  INSERT INTO public.design_versions (event_id, slot, canvas_json, format) VALUES (v_id, 4, '{}', 'stripV');
  BEGIN
    INSERT INTO public.design_versions (event_id, slot, canvas_json, format) VALUES (v_id, 5, '{}', 'portrait');
    RAISE EXCEPTION 'LAB-311 KO : design_versions.slot 5 accepte';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Upsert du modèle photo sans slot (comme autosave-design aujourd'hui) : seul le cadre 1 change.
DO $$
DECLARE
  v_ev uuid := current_setting('lab311.e_off')::uuid;
BEGIN
  INSERT INTO public.client_designs (event_id, kind, canvas_json, format, status)
  VALUES (v_ev, 'print', '{"lab":"upsert"}', 'portrait', 'approved')
  ON CONFLICT (event_id, kind, slot) DO UPDATE SET canvas_json = EXCLUDED.canvas_json;
  IF (SELECT canvas_json ->> 'lab' FROM public.client_designs WHERE id = current_setting('lab311.f_off_1')::uuid)
     IS DISTINCT FROM 'upsert' THEN
    RAISE EXCEPTION 'LAB-311 KO : upsert ON CONFLICT (event_id, kind, slot) sans effet sur le cadre 1';
  END IF;
  IF (SELECT count(*) FROM public.client_designs
       WHERE event_id = v_ev AND canvas_json ->> 'lab' = 'upsert') <> 1 THEN
    RAISE EXCEPTION 'LAB-311 KO : l''upsert du cadre 1 a touche un autre cadre';
  END IF;
  -- Remet le canvas d'origine pour la comparaison côté borne.
  UPDATE public.client_designs SET canvas_json = jsonb_build_object('objects', '[]'::jsonb, 'lab', 'off_1')
   WHERE id = current_setting('lab311.f_off_1')::uuid;
END $$;

-- Bornes A et B (rôle postgres), secrets de test aléatoires.
DO $$
BEGIN
  PERFORM set_config('lab311.mka', 'lab311_ka_' || substr(md5(gen_random_uuid()::text), 1, 10), true);
  PERFORM set_config('lab311.mkb', 'lab311_kb_' || substr(md5(gen_random_uuid()::text), 1, 10), true);
  PERFORM set_config('lab311.ska', 'ks_' || md5(gen_random_uuid()::text), true);
  PERFORM set_config('lab311.skb', 'ks_' || md5(gen_random_uuid()::text), true);
  INSERT INTO public.kiosk_licenses (machine_id, machine_name, label, org_id, is_active, secret_hash, activated_at)
  SELECT current_setting('lab311.mka'), 'PC-LAB311-KA', 'Borne KA', o.id, true, public.kiosk_secret_hash(current_setting('lab311.ska')), now()
    FROM public.organizations o WHERE o.owner_id = current_setting('lab311.ua')::uuid;
  INSERT INTO public.kiosk_licenses (machine_id, machine_name, label, org_id, is_active, secret_hash, activated_at)
  SELECT current_setting('lab311.mkb'), 'PC-LAB311-KB', 'Borne KB', o.id, true, public.kiosk_secret_hash(current_setting('lab311.skb')), now()
    FROM public.organizations o WHERE o.owner_id = current_setting('lab311.ub')::uuid;
END $$;

-- Cadre attendu dans frames, construit comme la RPC.
CREATE FUNCTION pg_temp.lab311_expected(p_key text, p_slot int, p_label text, p_format text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'id', current_setting('lab311.f_' || p_key || '_' || p_slot),
    'slot', p_slot,
    'label', p_label,
    'format', p_format,
    'canvas_json', jsonb_build_object('objects', '[]'::jsonb, 'lab', p_key || '_' || p_slot),
    'final_png_url', 'https://example.test/lab311/' || p_key || '/' || p_slot || '.png');
$$;

SELECT set_config('lab311.x_on', jsonb_build_array(
         pg_temp.lab311_expected('on', 3, 'Bande de 24 caracteres!!', 'stripV'),
         pg_temp.lab311_expected('on', 4, 'Paysage', 'landscape'))::text, true);
SELECT set_config('lab311.x_first', jsonb_build_array(pg_temp.lab311_expected('first', 3, 'Trois', 'stripV'))::text, true);

-- ────────────────────────────────────────────────────────────
-- 2. Côté borne (rôle anon)
-- ────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

DO $$
DECLARE
  r    json;
  keys text[];
  k    text;
  call text := 'SELECT public.kiosk_get_approved_design($1, $2, $3::uuid)';
BEGIN
  -- single : même réponse qu'avant, plus label et frames à null.
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_single');
  IF r IS NULL THEN RAISE EXCEPTION 'LAB-311 KO : aucun design pour l''evenement single'; END IF;
  SELECT array_agg(x ORDER BY x) INTO keys FROM json_object_keys(r) AS x;
  IF keys IS DISTINCT FROM ARRAY['canvas_json', 'final_png_url', 'format', 'frames', 'home_design', 'id', 'label'] THEN
    RAISE EXCEPTION 'LAB-311 KO : forme de la reponse inattendue : %', keys;
  END IF;
  IF r ->> 'id' IS DISTINCT FROM current_setting('lab311.f_single_1')
     OR r ->> 'final_png_url' IS DISTINCT FROM 'https://example.test/lab311/single/1.png'
     OR r ->> 'format' IS DISTINCT FROM 'portrait'
     OR json_typeof(r -> 'label') <> 'null'
     OR json_typeof(r -> 'frames') <> 'null'
     OR json_typeof(r -> 'home_design') <> 'null' THEN
    RAISE EXCEPTION 'LAB-311 KO : reponse single fausse : %', r;
  END IF;

  -- Choix coupé (absent, faux, texte) : cadre 1, frames null.
  FOREACH k IN ARRAY ARRAY['off', 'false', 'text'] LOOP
    EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_' || k);
    IF r ->> 'id' IS DISTINCT FROM current_setting('lab311.f_' || k || '_1') OR r ->> 'label' IS DISTINCT FROM 'Cadre 1' THEN
      RAISE EXCEPTION 'LAB-311 KO : cadre principal faux pour % : %', k, r;
    END IF;
    IF json_typeof(r -> 'frames') <> 'null' THEN
      RAISE EXCEPTION 'LAB-311 KO : frames devrait valoir null pour % : %', k, r -> 'frames';
    END IF;
  END LOOP;
  -- off a l'écran d'accueil activé mais pas validé : home_design toujours null.
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_off');
  IF json_typeof(r -> 'home_design') <> 'null' THEN RAISE EXCEPTION 'LAB-311 KO : home_design invente pour off'; END IF;

  -- on : cadre 1 avec label, frames [3, 4] (2 non validé), home_design inchangé.
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_on');
  IF r ->> 'id' IS DISTINCT FROM current_setting('lab311.f_on_1') OR r ->> 'label' IS DISTINCT FROM 'Portrait'
     OR r ->> 'format' IS DISTINCT FROM 'portrait' THEN
    RAISE EXCEPTION 'LAB-311 KO : cadre principal faux pour on : %', r;
  END IF;
  IF (r -> 'frames')::jsonb IS DISTINCT FROM current_setting('lab311.x_on')::jsonb THEN
    RAISE EXCEPTION 'LAB-311 KO : frames faux pour on : %', r -> 'frames';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO keys FROM json_object_keys(r -> 'frames' -> 0) AS x;
  IF keys IS DISTINCT FROM ARRAY['canvas_json', 'final_png_url', 'format', 'id', 'label', 'slot'] THEN
    RAISE EXCEPTION 'LAB-311 KO : forme d''un cadre de frames inattendue : %', keys;
  END IF;
  IF json_typeof(r -> 'frames' -> 0 -> 'slot') <> 'number' THEN
    RAISE EXCEPTION 'LAB-311 KO : frames[].slot n''est pas un nombre';
  END IF;
  IF (r -> 'home_design')::jsonb IS DISTINCT FROM jsonb_build_object(
       'id', current_setting('lab311.h_on'), 'final_png_url', 'https://example.test/lab311/on/home.png') THEN
    RAISE EXCEPTION 'LAB-311 KO : home_design faux pour on : %', r -> 'home_design';
  END IF;

  -- first : cadre 1 refusé → cadre 2 principal, frames [3].
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_first');
  IF r ->> 'id' IS DISTINCT FROM current_setting('lab311.f_first_2') OR r ->> 'label' IS DISTINCT FROM 'Deux' THEN
    RAISE EXCEPTION 'LAB-311 KO : le plus petit slot valide n''est pas renvoye : %', r;
  END IF;
  IF (r -> 'frames')::jsonb IS DISTINCT FROM current_setting('lab311.x_first')::jsonb THEN
    RAISE EXCEPTION 'LAB-311 KO : frames faux pour first : %', r -> 'frames';
  END IF;

  -- alone : choix actif, un seul cadre validé (les brouillons ne comptent pas) → frames [].
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_alone');
  IF r ->> 'id' IS DISTINCT FROM current_setting('lab311.f_alone_1') OR (r -> 'frames')::jsonb IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'LAB-311 KO : reponse alone fausse : %', r;
  END IF;

  -- none : aucun cadre validé → NULL.
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_none');
  IF r IS NOT NULL THEN RAISE EXCEPTION 'LAB-311 KO : reponse sans cadre valide : %', r; END IF;

  -- other : la borne de A ne lit rien de B ; la borne de B lit ses deux cadres.
  EXECUTE call INTO r USING current_setting('lab311.mka'), current_setting('lab311.ska'), current_setting('lab311.e_other');
  IF r IS NOT NULL THEN RAISE EXCEPTION 'LAB-311 KO : la borne de A lit les cadres de B'; END IF;
  EXECUTE call INTO r USING current_setting('lab311.mkb'), current_setting('lab311.skb'), current_setting('lab311.e_other');
  IF r ->> 'id' IS DISTINCT FROM current_setting('lab311.f_other_1')
     OR r -> 'frames' -> 0 ->> 'id' IS DISTINCT FROM current_setting('lab311.f_other_2') THEN
    RAISE EXCEPTION 'LAB-311 KO : la borne de B ne lit pas ses cadres : %', r;
  END IF;

  BEGIN
    EXECUTE call INTO r USING current_setting('lab311.mka'), 'ks_faux', current_setting('lab311.e_on');
    RAISE EXCEPTION 'LAB-311 KO : licence fausse acceptee';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT 'LAB-311 OK' AS result;

ROLLBACK;
