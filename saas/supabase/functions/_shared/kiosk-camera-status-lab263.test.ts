// LAB-263 : état de l'appareil photo remonté par le battement de cœur (migration kiosk_camera_status).
// Contrôles statiques de la migration et de la lecture par check-kiosk-alerts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const MIGRATION = '20261215000000_kiosk_camera_status.sql';
const raw = readPrivateHistory(new URL(`../../migrations/${MIGRATION}`, import.meta.url));
const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const alerts = readFileSync(new URL('../check-kiosk-alerts/index.ts', import.meta.url), 'utf8');

const body = () => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_heartbeat(');
  assert.ok(start >= 0, 'kiosk_heartbeat introuvable');
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('migration : SQL sans accents, se termine par le rechargement du schéma', { skip: PRIVATE_HISTORY }, () => {
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(sql.trimEnd(), /NOTIFY pgrst, 'reload schema';$/);
});

test('migration : colonnes, contrainte et lecture par le SaaS seulement', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS camera_status\s+text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS camera_status_at\s+timestamptz/);
  assert.match(flat(sql), /CHECK \(camera_status IS NULL OR camera_status IN \('ok', 'disconnected'\)\)/);
  assert.match(sql, /GRANT SELECT \(camera_status, camera_status_at\) ON public\.kiosk_licenses TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT (UPDATE|INSERT)[^;]*kiosk_licenses/);
  assert.doesNotMatch(sql, /GRANT[^;]*\bON (TABLE )?public\.kiosk_\w+[^;]*TO[^;]*\banon\b/);
});

test('kiosk_heartbeat : ancienne signature supprimée avant la nouvelle, droits inchangés', { skip: PRIVATE_HISTORY }, () => {
  const drop = 'DROP FUNCTION IF EXISTS public.kiosk_heartbeat(text, text, text, text, text, int);';
  assert.ok(sql.includes(drop));
  assert.ok(sql.indexOf(drop) < sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_heartbeat('));
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.kiosk_heartbeat\(text, text, text, text, text, int, text\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_heartbeat\(text, text, text, text, text, int, text\) TO anon;/);
  const b = flat(body());
  assert.match(b, /SECURITY DEFINER/);
  assert.match(b, /SET search_path = public, pg_temp/);
  assert.match(b, /secret <> '' AND secret = p_secret/);
});

test('kiosk_heartbeat : p_camera_status DEFAULT NULL, un NULL ne touche pas à l’état connu', { skip: PRIVATE_HISTORY }, () => {
  const b = flat(body());
  assert.match(b, /p_pending_uploads int DEFAULT NULL, p_camera_status text DEFAULT NULL\)/);
  // Seules les deux valeurs connues écrivent ; NULL ou autre valeur → état et date conservés.
  assert.match(b, /camera_status = CASE WHEN p_camera_status IN \('ok', 'disconnected'\) THEN p_camera_status ELSE camera_status END/);
  assert.match(b, /camera_status_at = CASE WHEN p_camera_status IN \('ok', 'disconnected'\) THEN now\(\) ELSE camera_status_at END/);
  // Le reste du battement de cœur est inchangé.
  assert.match(b, /last_seen_at = now\(\)/);
  assert.match(b, /pending_uploads = CASE WHEN p_pending_uploads IS NULL THEN NULL ELSE GREATEST\(p_pending_uploads, 0\) END/);
});

test('check-kiosk-alerts lit camera_status', () => {
  assert.match(alerts, /\.from\('kiosk_licenses'\)\s*\.select\('[^']*\bcamera_status\b[^']*'\)/);
});
