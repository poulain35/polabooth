-- Couleurs des bornes dans le calendrier : une couleur distincte par borne, prise dans une palette.
--
-- Avant : kiosk_licenses.color valait '#4f46e5' par défaut, donc toutes les bornes d'un compte
-- avaient la même couleur dans le calendrier tant que l'admin ne les changeait pas une à une.
--
-- 1. kiosk_license_next_color(org) : la couleur de la palette la moins utilisée par les bornes en
--    service du compte (à égalité, la première de la palette). Huit couleurs lisibles sous un texte
--    blanc (contraste d'au moins 4,5), la première étant le bleu de l'admin.
-- 2. Déclencheur BEFORE INSERT : une borne créée sans couleur reçoit la prochaine couleur de son
--    compte. La colonne reste NOT NULL mais perd sa valeur par défaut (le déclencheur la remplace).
-- 3. Reprise : les bornes encore à l'ancienne couleur par défaut reçoivent chacune une couleur de la
--    palette, les bornes en service d'abord, par date d'activation. Une couleur déjà choisie par
--    l'admin n'est pas touchée.
--
-- La couleur ne sert qu'à l'admin du SaaS (calendrier, journaux) : ni la borne ni le .pola ne la
-- lisent. L'admin peut toujours la changer (droit UPDATE sur la colonne inchangé).
-- Idempotente : CREATE OR REPLACE, DROP ... IF EXISTS, reprise sans effet au second passage.
-- Vérification : supabase/tests/kiosk_license_colors_check.sql.

-- ── 1. Prochaine couleur d'un compte ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kiosk_license_next_color(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.color
  FROM unnest(ARRAY[
    '#3F51E0', -- bleu
    '#BC5316', -- orange
    '#1B7F53', -- vert
    '#7C4DDB', -- violet
    '#C23B6E', -- rose
    '#12808F', -- sarcelle
    '#9A6A08', -- ambre
    '#5A6478'  -- ardoise
  ]) WITH ORDINALITY AS p(color, pos)
  LEFT JOIN public.kiosk_licenses l
    ON lower(l.color) = lower(p.color)
   AND l.org_id IS NOT DISTINCT FROM p_org_id
   AND l.retired_at IS NULL
  GROUP BY p.color, p.pos
  ORDER BY count(l.id), p.pos
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.kiosk_license_next_color(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Couleur posée à la création ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kiosk_licenses_set_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.color IS NULL THEN
    NEW.color := public.kiosk_license_next_color(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_licenses_set_color() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS kiosk_licenses_set_color ON public.kiosk_licenses;
CREATE TRIGGER kiosk_licenses_set_color
  BEFORE INSERT ON public.kiosk_licenses
  FOR EACH ROW EXECUTE FUNCTION public.kiosk_licenses_set_color();

ALTER TABLE public.kiosk_licenses ALTER COLUMN color DROP DEFAULT;

-- ── 3. Reprise des bornes à l'ancienne couleur par défaut ────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, org_id
    FROM public.kiosk_licenses
    WHERE lower(color) = '#4f46e5'
    ORDER BY org_id, (retired_at IS NOT NULL), activated_at, id
  LOOP
    UPDATE public.kiosk_licenses
    SET color = public.kiosk_license_next_color(r.org_id)
    WHERE id = r.id;
  END LOOP;
END;
$$;
