-- Vérification des couleurs des bornes, à lancer en dev APRÈS la migration
-- 20261231000000_kiosk_license_colors.sql (SQL Editor ou API de gestion, rôle postgres).
--
-- Tout se passe dans une transaction annulée (ROLLBACK final) : aucune donnée n'est modifiée.
-- Chaque contrôle lève une erreur « COULEURS KO : … » en cas d'échec ; si le script va jusqu'au
-- bout, la dernière requête affiche « COULEURS OK ».
--
-- Contrôles :
--   0. Structure : colonne NOT NULL sans valeur par défaut, déclencheur présent, fonctions non
--      appelables par anon ni authenticated, plus aucune borne à l'ancienne couleur.
--   1. Neuf bornes créées sans couleur dans un compte neuf : les huit couleurs de la palette dans
--      l'ordre, puis de nouveau la première.
--   2. Une couleur donnée à la création est gardée.
--   3. Une borne retirée libère sa couleur pour la borne suivante.
--
-- Aucun secret réel, aucun identifiant de projet, aucune donnée personnelle.

BEGIN;

DO $$
DECLARE
  v_org    uuid;
  v_user   uuid := gen_random_uuid();
  v_colors text[];
  v_color  text;
  n        int;
  PALETTE CONSTANT text[] := ARRAY['#3F51E0', '#BC5316', '#1B7F53', '#7C4DDB', '#C23B6E', '#12808F', '#9A6A08', '#5A6478'];
BEGIN
  -- ── 0. Structure ──
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'kiosk_licenses' AND column_name = 'color'
    AND is_nullable = 'NO' AND column_default IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'COULEURS KO : color doit être NOT NULL et sans valeur par défaut'; END IF;

  SELECT count(*) INTO n FROM pg_trigger
  WHERE tgrelid = 'public.kiosk_licenses'::regclass AND tgname = 'kiosk_licenses_set_color' AND NOT tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 'COULEURS KO : déclencheur kiosk_licenses_set_color absent'; END IF;

  IF has_function_privilege('anon', 'public.kiosk_license_next_color(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.kiosk_license_next_color(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'COULEURS KO : kiosk_license_next_color appelable par anon ou authenticated';
  END IF;

  SELECT count(*) INTO n FROM public.kiosk_licenses WHERE lower(color) = '#4f46e5';
  IF n <> 0 THEN RAISE EXCEPTION 'COULEURS KO : % borne(s) encore à l''ancienne couleur', n; END IF;

  -- ── 1. Compte neuf : la palette dans l'ordre ──
  INSERT INTO auth.users (id, email) VALUES (v_user, 'couleurs-' || v_user || '@example.invalid');
  INSERT INTO public.organizations (name, owner_id) VALUES ('Compte de test couleurs', v_user) RETURNING id INTO v_org;

  FOR i IN 1..9 LOOP
    INSERT INTO public.kiosk_licenses (machine_id, label, org_id)
    VALUES ('couleurs-' || v_org || '-' || i, 'Borne ' || i, v_org)
    RETURNING color INTO v_color;
    v_colors := v_colors || v_color;
  END LOOP;
  IF v_colors[1:8] <> PALETTE THEN RAISE EXCEPTION 'COULEURS KO : palette attendue dans l''ordre, reçu %', v_colors; END IF;
  IF v_colors[9] <> PALETTE[1] THEN RAISE EXCEPTION 'COULEURS KO : la neuvième borne reprend la première couleur, reçu %', v_colors[9]; END IF;

  -- ── 2. Couleur donnée : gardée ──
  INSERT INTO public.kiosk_licenses (machine_id, label, org_id, color)
  VALUES ('couleurs-' || v_org || '-choisie', 'Borne choisie', v_org, '#123456')
  RETURNING color INTO v_color;
  IF v_color <> '#123456' THEN RAISE EXCEPTION 'COULEURS KO : couleur donnée remplacée par %', v_color; END IF;

  -- ── 3. Borne retirée : sa couleur redevient la moins utilisée ──
  -- Après 9 bornes : bleu ×2, les autres ×1. On retire les deux bleues et l'orange : la suivante est bleue.
  UPDATE public.kiosk_licenses SET retired_at = now(), is_active = false
  WHERE org_id = v_org AND lower(color) IN (lower(PALETTE[1]), lower(PALETTE[2]));
  INSERT INTO public.kiosk_licenses (machine_id, label, org_id)
  VALUES ('couleurs-' || v_org || '-apres', 'Borne après retrait', v_org)
  RETURNING color INTO v_color;
  IF v_color <> PALETTE[1] THEN RAISE EXCEPTION 'COULEURS KO : couleur libérée attendue %, reçu %', PALETTE[1], v_color; END IF;
END;
$$;

ROLLBACK;

SELECT 'COULEURS OK' AS resultat;
