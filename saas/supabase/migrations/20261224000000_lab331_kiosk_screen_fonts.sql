-- LAB-331 — Polices des textes vivants des écrans de la borne.
-- La publication d'un écran (/admin/ecrans-borne) range, à côté de ses images, un fichier TTF ou OTF
-- par police utilisée par un texte vivant (org/{org_id}/screen-{kind}-v{n}-font-{i}.ttf|otf) : la
-- borne le télécharge et écrit le texte dans cette police. Le bucket kiosk-backgrounds accepte donc
-- aussi font/ttf et font/otf ; chemins, policies et taille maximale (10 Mo) inchangés (LAB-282).
--
-- Idempotente.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'application/json', 'font/ttf', 'font/otf']
 WHERE id = 'kiosk-backgrounds';
