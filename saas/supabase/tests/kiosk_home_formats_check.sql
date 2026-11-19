-- Accueil de la borne par format du cadre photo — vérification de la contrainte kiosk_screens_kind_check
-- et de la RPC kiosk_get_screens, à lancer en dev APRÈS la migration 20270117000000_kiosk_home_formats.sql
-- (SQL Editor ou API de gestion, rôle postgres).
--
-- Tout se passe dans une transaction annulée (ROLLBACK final) : aucune donnée n'est modifiée.
-- Chaque contrôle lève une erreur « ACCUEIL-FORMATS KO : … » ; si le script va jusqu'au bout, la dernière
-- requête affiche « ACCUEIL-FORMATS OK ».
--
-- Contrôles :
--   0. Structure : une seule signature, SECURITY DEFINER + search_path, EXECUTE pour anon et pas authenticated.
--   1. Données : comptes A et B, borne KA (A) ; événements A (paysage, bandelettes, portrait, sans cadre,
--      cadre paysage non validé, plusieurs cadres) et B.
--   2. Contrainte : les 5 sortes acceptées, une autre refusée.
--   3. RPC : variante du format, repli sur l'accueil portrait (variante non publiée), cadre principal =
--      plus petit slot validé, événement d'un autre compte vide, licence fausse refusée.
--
-- Aucun secret réel, aucun identifiant de projet, aucune donnée personnelle.

BEGIN;

-- ── 0. Structure ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'kiosk_get_screens';
  IF n <> 1 THEN RAISE EXCEPTION 'ACCUEIL-FORMATS KO : % signature(s) de kiosk_get_screens', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'kiosk_get_screens'
                   AND prosecdef AND 'search_path=public, pg_temp' = ANY (proconfig)) THEN
    RAISE EXCEPTION 'ACCUEIL-FORMATS KO : kiosk_get_screens sans SECURITY DEFINER ou search_path';
  END IF;
  IF NOT has_function_privilege('anon', 'public.kiosk_get_screens(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCUEIL-FORMATS KO : anon ne peut pas appeler kiosk_get_screens';
  END IF;
  IF has_function_privilege('authenticated', 'public.kiosk_get_screens(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCUEIL-FORMATS KO : authenticated peut appeler kiosk_get_screens';
  END IF;
END $$;

-- ── 1. Données ───────────────────────────────────────────────────────────────────────────────
SELECT set_config('request.headers', '', true);
SELECT set_config('hf.ua', gen_random_uuid()::text, true);
SELECT set_config('hf.ub', gen_random_uuid()::text, true);
SELECT set_config('hf.mka', 'hf_ka_' || substr(md5(gen_random_uuid()::text), 1, 10), true);
SELECT set_config('hf.ska', 'ks_' || md5(gen_random_uuid()::text), true);

DO $$
DECLARE
  u  text;
  oa uuid;
  ob uuid;
  e  uuid;
  k  text;
BEGIN
  FOREACH u IN ARRAY ARRAY[current_setting('hf.ua'), current_setting('hf.ub')] LOOP
    INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (u::uuid, 'authenticated', 'authenticated', 'hf.' || left(u, 8) || '@example.test', now(), now());
  END LOOP;
  INSERT INTO public.organizations (owner_id, name, created_at)
  VALUES (current_setting('hf.ua')::uuid, 'Accueil formats A', '2000-01-01') RETURNING organizations.id INTO oa;
  INSERT INTO public.organizations (owner_id, name, created_at)
  VALUES (current_setting('hf.ub')::uuid, 'Accueil formats B', '2000-01-01') RETURNING organizations.id INTO ob;
  PERFORM set_config('hf.oa', oa::text, true);
  PERFORM set_config('hf.ob', ob::text, true);

  INSERT INTO public.kiosk_licenses (machine_id, machine_name, label, org_id, is_active, secret_hash, activated_at)
  VALUES (current_setting('hf.mka'), 'PC-HF-KA', 'Borne KA', oa, true,
          public.kiosk_secret_hash(current_setting('hf.ska')), now());

  -- Un événement par cas ; 'other' appartient au compte B.
  FOREACH k IN ARRAY ARRAY['landscape', 'stripH', 'stripV', 'portrait', 'none', 'pending', 'multi', 'other'] LOOP
    INSERT INTO public.events (org_id, name, access_code, status, start_date, end_date, form_config)
    VALUES (CASE k WHEN 'other' THEN ob ELSE oa END, 'Accueil formats ' || k,
            'HF' || upper(substr(md5(gen_random_uuid()::text), 1, 8)), 'active',
            now() - interval '1 hour', now() + interval '6 hours', '{}'::jsonb)
    RETURNING events.id INTO e;
    PERFORM set_config('hf.e_' || k, e::text, true);
    IF k IN ('landscape', 'stripH', 'stripV', 'portrait', 'other') THEN
      INSERT INTO public.client_designs (event_id, slot, canvas_json, format, final_png_url, status)
      VALUES (e, 1, '{"objects":[]}', CASE k WHEN 'other' THEN 'landscape' ELSE k END,
              'https://example.test/hf/' || k || '.png', 'approved');
    ELSIF k = 'pending' THEN
      INSERT INTO public.client_designs (event_id, slot, canvas_json, format, final_png_url, status)
      VALUES (e, 1, '{"objects":[]}', 'landscape', 'https://example.test/hf/pending.png', 'submitted');
    ELSIF k = 'multi' THEN
      -- Slot 1 en attente, slot 2 bandelette verticale validée, slot 3 paysage validé : cadre principal = slot 2.
      INSERT INTO public.client_designs (event_id, slot, canvas_json, format, final_png_url, status) VALUES
        (e, 1, '{"objects":[]}', 'landscape', 'https://example.test/hf/m1.png', 'submitted'),
        (e, 2, '{"objects":[]}', 'stripV',    'https://example.test/hf/m2.png', 'approved'),
        (e, 3, '{"objects":[]}', 'landscape', 'https://example.test/hf/m3.png', 'approved');
    END IF;
  END LOOP;

  -- Compte A : portrait, paysage, bandelette verticale et partage publiés ; bandelette horizontale en
  -- brouillon seulement (published NULL). Compte B : accueil portrait publié.
  INSERT INTO public.kiosk_screens (org_id, kind, published, published_version) VALUES
    (oa, 'home',           '{"kind":"home","tag":"portrait"}',  1),
    (oa, 'home_landscape', '{"kind":"home","tag":"landscape"}', 1),
    (oa, 'home_strip_v',   '{"kind":"home","tag":"stripV"}',    1),
    (oa, 'result',         '{"kind":"result","tag":"result"}',  1),
    (ob, 'home',           '{"kind":"home","tag":"b"}',         1);
  INSERT INTO public.kiosk_screens (org_id, kind, draft_json) VALUES (oa, 'home_strip_h', '{"objects":[]}');
END $$;

-- ── 2. Contrainte ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.kiosk_screens (org_id, kind) VALUES (current_setting('hf.ob')::uuid, 'home_square');
    RAISE EXCEPTION 'ACCUEIL-FORMATS KO : sorte inconnue acceptée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.kiosk_screens (org_id, kind) VALUES
    (current_setting('hf.ob')::uuid, 'home_landscape'), (current_setting('hf.ob')::uuid, 'home_strip_h'),
    (current_setting('hf.ob')::uuid, 'home_strip_v'), (current_setting('hf.ob')::uuid, 'result');
END $$;

-- ── 3. RPC (rôle anon) ───────────────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;

DO $$
DECLARE
  r   jsonb;
  k   text;
  exp text;
BEGIN
  FOR k, exp IN SELECT * FROM (VALUES
      ('landscape', 'landscape'), ('stripV', 'stripV'), ('stripH', 'portrait'), ('portrait', 'portrait'),
      ('none', 'portrait'), ('pending', 'portrait'), ('multi', 'stripV')) AS t(key, tag) LOOP
    r := public.kiosk_get_screens(current_setting('hf.e_' || k)::uuid, current_setting('hf.mka'), current_setting('hf.ska'));
    IF r->'home'->>'tag' IS DISTINCT FROM exp THEN
      RAISE EXCEPTION 'ACCUEIL-FORMATS KO : événement % → accueil %, attendu %', k, r->'home'->>'tag', exp;
    END IF;
    IF r->'home'->>'kind' IS DISTINCT FROM 'home' OR r->'result'->>'tag' IS DISTINCT FROM 'result' THEN
      RAISE EXCEPTION 'ACCUEIL-FORMATS KO : événement % → réponse %', k, r;
    END IF;
  END LOOP;

  r := public.kiosk_get_screens(current_setting('hf.e_other')::uuid, current_setting('hf.mka'), current_setting('hf.ska'));
  IF r IS DISTINCT FROM '{"home":null,"result":null}'::jsonb THEN
    RAISE EXCEPTION 'ACCUEIL-FORMATS KO : événement d''un autre compte → %', r;
  END IF;

  BEGIN
    PERFORM public.kiosk_get_screens(current_setting('hf.e_landscape')::uuid, current_setting('hf.mka'), 'ks_faux');
    RAISE EXCEPTION 'ACCUEIL-FORMATS KO : licence fausse acceptée';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;

SELECT 'ACCUEIL-FORMATS OK' AS result;

ROLLBACK;
