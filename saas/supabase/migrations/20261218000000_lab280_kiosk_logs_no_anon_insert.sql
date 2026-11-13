-- LAB-280 (spec docs/specs/LAB-128-verrouillage-rls.md, DEV-6) : plus aucun accès direct d'anon à
-- kiosk_logs. La borne envoie ses journaux par la RPC kiosk_record_logs (LAB-278, PolaKiosk 1.0.16),
-- qui vérifie sa licence ; l'INSERT anonyme direct n'a plus d'usage.
--
-- À appliquer seulement APRÈS la validation de la borne (LAB-279) et, en prod, après l'installation
-- de PolaKiosk 1.0.16 sur les PC : une borne plus ancienne perdrait ses journaux (refus 401/403).
--
-- Lecture et suppression par l'admin (authenticated) inchangées. Vérification :
-- supabase/tests/lab128_kiosk_logs_check.sql et lab128_cleanup_check.sql.

DROP POLICY IF EXISTS "anon_insert_kiosk_logs" ON public.kiosk_logs;

REVOKE ALL ON public.kiosk_logs FROM anon;
