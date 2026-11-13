// LAB-229 (spec LAB-207, ticket 2) : type de média des photos et envoi des animations de la borne.
// Contrôles statiques de la migration, du script de vérification dev, des écritures media_type
// (invités, admin) et de la suppression de l'affiche.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261129000000_photos_media_type.sql';
const SIGNATURE = 'TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER, INTEGER';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const raw = readPrivateHistory(new URL(MIGRATION, DIR));
const sql = strip(raw);
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const fn = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const src = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
const check = readPrivateHistory(new URL('../../tests/lab229_photos_media_type_check.sql', import.meta.url));

/** Corps de kiosk_record_photo (de CREATE à la fin du bloc $$). */
function body(): string {
  const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_record_photo(');
  assert.ok(i >= 0);
  const start = sql.indexOf('AS $$', i);
  return flat(sql.slice(i, sql.indexOf('$$;', start + 5)));
}

test('migration : horodatage unique, juste après LAB-227, SQL sans accent', { skip: PRIVATE_HISTORY }, () => {
  const stamps = all.map((f) => f.slice(0, 14));
  assert.equal(stamps.filter((s) => s === '20261129000000').length, 1);
  assert.equal(new Set(stamps).size, stamps.length, 'horodatages uniques');
  const before = all.filter((f) => f < MIGRATION);
  assert.ok(before.at(-1)!.startsWith('20261128000000'), before.at(-1));
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/);
});

test('colonnes media_type et duration_ms : défaut photo, contraintes, reprise des vidéos', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS media_type\s+TEXT\s+NOT NULL DEFAULT 'photo',/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS duration_ms INTEGER;/);
  assert.match(flat(sql), /CHECK \(media_type IN \('photo', 'gif', 'boomerang', 'video', 'testimonial'\)\)/);
  assert.match(flat(sql), /CHECK \(duration_ms IS NULL OR duration_ms BETWEEN 1 AND 600000\)/);
  // Contraintes rejouables.
  assert.ok(sql.indexOf('DROP CONSTRAINT IF EXISTS photos_media_type_check') < sql.indexOf('ADD CONSTRAINT photos_media_type_check'));
  // Même liste d'extensions que saas/src/utils/media.js.
  assert.match(flat(sql), /UPDATE public\.photos SET media_type = 'video' WHERE media_type = 'photo' AND split_part\(coalesce\(storage_path, photo_url\), '\?', 1\) ~\* '\[\.\]\(mp4\|mov\|m4v\|webm\)\$';/);
  assert.match(src('utils/media.js'), /mp4\|mov\|m4v\|webm/);
  assert.match(flat(sql), /CREATE INDEX IF NOT EXISTS idx_photos_media_type ON public\.photos \(event_id, media_type\) WHERE media_type <> 'photo';/);
});

test('kiosk_record_photo : ancienne signature supprimée, une seule création, paramètres par défaut', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ\);/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.kiosk_record_photo\(/g) ?? []).length, 1);
  assert.ok(sql.indexOf('DROP FUNCTION IF EXISTS public.kiosk_record_photo(') < sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_record_photo('));
  const b = body();
  assert.match(b, /^CREATE OR REPLACE FUNCTION public\.kiosk_record_photo\( p_code TEXT, p_event_id UUID, p_storage_path TEXT, p_photo_url TEXT, p_machine_id TEXT, p_secret TEXT, p_captured_at TIMESTAMPTZ DEFAULT NULL, p_media_type TEXT DEFAULT 'photo', p_thumbnail_path TEXT DEFAULT NULL, p_duration_ms INTEGER DEFAULT NULL, p_width INTEGER DEFAULT NULL, p_height INTEGER DEFAULT NULL\) RETURNS UUID/);
  assert.match(b, /SECURITY DEFINER/);
  assert.match(b, /SET search_path = public, pg_temp/);
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.kiosk_record_photo\\(${SIGNATURE}\\) FROM PUBLIC, authenticated;`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.kiosk_record_photo\\(${SIGNATURE}\\) TO anon, service_role;`));
});

test('kiosk_record_photo : identification en P0001, refus définitifs en 22023, dans cet ordre', { skip: PRIVATE_HISTORY }, () => {
  const b = body();
  // Identification (P0001 par défaut) : la borne réessaie.
  assert.match(b, /RAISE EXCEPTION 'kiosk_record_photo : licence kiosk invalide ou inactive';/);
  assert.match(b, /RAISE EXCEPTION 'kiosk_record_photo : evenement introuvable ou cloture';/);
  assert.match(b, /AND secret <> '' AND secret = p_secret/);
  assert.match(b, /e\.access_code = UPPER\(TRIM\(p_code\)\) AND e\.status IN \('active', 'submitted'\)/);
  // Refus définitifs : la borne arrête de renvoyer.
  const refusals = ['type de media invalide', 'chemin de media invalide', 'URL de media invalide', 'affiche invalide',
    'affiche obligatoire pour un format anime', 'duree invalide', 'dimensions invalides', 'chemin de media deja utilise'];
  for (const m of refusals) {
    assert.ok(b.includes(`RAISE EXCEPTION 'kiosk_record_photo : ${m}' USING ERRCODE = '22023';`), m);
  }
  assert.equal((b.match(/RAISE EXCEPTION/g) ?? []).length, 2 + refusals.length);
  assert.ok(b.indexOf('licence kiosk') < b.indexOf('evenement introuvable'), 'licence vérifiée en premier');
  assert.ok(b.indexOf('evenement introuvable') < b.indexOf('type de media invalide'), 'identification avant le contenu');
  // Témoignage refusé tant que la galerie publique ne l'exclut pas.
  assert.match(b, /p_media_type IS NULL OR p_media_type NOT IN \('photo', 'gif', 'boomerang', 'video'\)/);
});

test('kiosk_record_photo : MP4 pour une animation, affiche poster.jpg du même dossier', { skip: PRIVATE_HISTORY }, () => {
  const b = body();
  assert.match(b, /v_ext := CASE WHEN p_media_type = 'photo' THEN '\(\[jJ\]\[pP\]\[eE\]\?\[gG\]\|\[pP\]\[nN\]\[gG\]\)' ELSE '\[mM\]\[pP\]4' END;/);
  assert.match(b, /'\/\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\*\[\.\]' \|\| v_ext \|\| '\$'/);
  assert.match(b, /p_storage_path LIKE '%\.\.%'/);
  assert.match(b, /p_thumbnail_path <> regexp_replace\(p_storage_path, '\/\[\^\/\]\+\$', ''\) \|\| '\/poster\.jpg'/);
  assert.match(b, /v_thumb_url := left\(p_photo_url, length\(p_photo_url\) - length\(p_storage_path\)\) \|\| p_thumbnail_path;/);
  assert.match(b, /ELSIF p_media_type <> 'photo' THEN RAISE EXCEPTION 'kiosk_record_photo : affiche obligatoire/);
  assert.match(b, /p_duration_ms IS NOT NULL AND \(p_media_type = 'photo' OR p_duration_ms NOT BETWEEN 1 AND 600000\)/);
  assert.match(b, /\(p_width IS NULL\) <> \(p_height IS NULL\)/);
});

test('kiosk_record_photo : ligne écrite et idempotence conservées (LAB-213, LAB-227)', { skip: PRIVATE_HISTORY }, () => {
  const b = body();
  assert.match(b, /INSERT INTO public\.photos \(event_id, photo_url, storage_path, thumbnail_url, source, status, captured_at, media_type, duration_ms, width, height\) VALUES \(p_event_id, p_photo_url, p_storage_path, v_thumb_url, 'kiosk', 'approved', v_captured_at, p_media_type, p_duration_ms, p_width, p_height\)/);
  assert.match(b, /ON CONFLICT \(storage_path\) WHERE storage_path IS NOT NULL DO NOTHING/);
  assert.match(b, /p\.storage_path = p_storage_path AND p\.event_id = p_event_id AND p\.source = 'kiosk'/);
  assert.match(b, /p_captured_at >= COALESCE\(e\.start_date, e\.created_at\) - INTERVAL '1 day'/);
  assert.match(b, /p_captured_at <= now\(\) \+ INTERVAL '1 hour'/);
});

test('media_type écrit pour les envois des invités et de l\'admin', () => {
  const guest = fn('record-guest-photo/index.ts');
  assert.match(guest, /const VIDEO_EXT = \/\\\.\(mp4\|mov\|m4v\|webm\)\$\/i;/);
  assert.match(guest, /media_type:\s+VIDEO_EXT\.test\(storagePath\) \? 'video' : 'photo'/);
  const lib = src('lib/supabase.js');
  assert.match(lib, /import \{ isVideoUrl \}\s+from '\.\.\/utils\/media\.js';/);
  assert.match(lib, /source: 'admin', media_type: isVideoUrl\(storage_path \?\? photo_url\) \? 'video' : 'photo'/);
});

test('delete-photo supprime aussi l\'affiche (mêmes clés que media-expiry)', () => {
  const del = fn('delete-photo/index.ts');
  assert.match(del, /import \{ photoKeys \}\s+from '\.\.\/media-expiry\/logic\.ts';/);
  assert.match(del, /\.select\('id, storage_path, thumbnail_url'\)/);
  assert.match(del, /photoKeys\(photo, photosPublicBaseUrl\(\)\)/);
  assert.match(fn('media-expiry/index.ts'), /'id, storage_path, thumbnail_url'/);
});

test('script de vérification dev : transaction annulée, contrôles des critères', { skip: PRIVATE_HISTORY }, () => {
  assert.match(check, /^BEGIN;$/m);
  assert.match(check, /ROLLBACK;\s*$/);
  assert.doesNotMatch(strip(check), /\bCOMMIT\b/i);
  assert.match(check, /SELECT 'LAB-229 OK' AS result;/);
  for (const m of ['GIF accepté sans affiche', 'affiche d\'\'une autre séance acceptée', 'MP4 accepté pour une photo',
    'témoignage accepté avant le lot 2', 'renvoi du GIF = nouvelle ligne', 'GIF accepté avec un faux secret',
    'signature(s) de kiosk_record_photo']) {
    assert.ok(check.includes(m), m);
  }
  assert.match(check, /SQLSTATE <> 'P0001'/);
  assert.match(check, /WHEN invalid_parameter_value/);
  assert.doesNotMatch(check, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i, 'aucun identifiant réel');
});

test('saas/CLAUDE.md documente LAB-229', { skip: PRIVATE_HISTORY }, () => {
  const doc = readFileSync(new URL('../../../CLAUDE.md', import.meta.url), 'utf8');
  assert.match(doc, /LAB-229/);
  assert.match(doc, /20261129000000_photos_media_type\.sql/);
  assert.match(doc, /media_type/);
  assert.match(doc, /duration_ms/);
  assert.match(doc, /p_thumbnail_path/);
  assert.match(doc, /poster\.jpg/);
  assert.match(doc, /kind/);
});
