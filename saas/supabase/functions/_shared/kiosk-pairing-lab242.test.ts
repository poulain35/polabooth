// LAB-242 : association des bornes par code (migration kiosk_pairing) et alertes au compte de la borne.
// Contrôles statiques ; le comportement est vérifié par supabase/tests/lab242_kiosk_pairing_check.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const MIGRATION = '20261203000000_kiosk_pairing.sql';
const raw = readPrivateHistory(new URL(`../../migrations/${MIGRATION}`, import.meta.url));
const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const alerts = readFileSync(new URL('../check-kiosk-alerts/index.ts', import.meta.url), 'utf8');

const fnBody = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('migration : SQL sans accents, se termine par le rechargement du schéma', { skip: PRIVATE_HISTORY }, () => {
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(sql.trimEnd(), /NOTIFY pgrst, 'reload schema';$/);
});

test('migration : RPC SECURITY DEFINER avec search_path fixé', { skip: PRIVATE_HISTORY }, () => {
  for (const fn of ['kiosk_pairing_start', 'kiosk_pairing_poll', 'kiosk_pairing_lookup', 'kiosk_pairing_approve',
                    'kiosk_retire_license', 'kiosk_request_update', 'kiosk_get_event', 'kiosk_check_license',
                    'kiosk_heartbeat', 'kiosk_log_visible']) {
    const body = fnBody(fn);
    assert.match(body, /SECURITY DEFINER/, fn);
    assert.match(body, /SET search_path = public, pg_temp/, fn);
  }
});

test('migration : la borne (anon) n’appelle que start, poll et kiosk_get_event parmi les nouvelles RPC', { skip: PRIVATE_HISTORY }, () => {
  const anon = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)\([^)]*\)\s+TO ([^;]+);/g)]
    .filter((m) => /\banon\b/.test(m[2]))
    .map((m) => m[1])
    .sort();
  assert.deepEqual(anon, ['kiosk_check_license', 'kiosk_get_event', 'kiosk_heartbeat', 'kiosk_pairing_poll', 'kiosk_pairing_start']);
  assert.doesNotMatch(sql, /GRANT[^;]*\bON (TABLE )?public\.kiosk_\w+[^;]*TO[^;]*\banon\b/);
});

test('migration : le secret n’est jamais lisible ni modifiable par le SaaS', { skip: PRIVATE_HISTORY }, () => {
  for (const m of sql.matchAll(/GRANT (SELECT|UPDATE|INSERT) \(([^)]*)\) ON public\.(kiosk_licenses|kiosk_pairings) TO authenticated;/g)) {
    assert.doesNotMatch(m[2], /\bsecret\b|secret_to_deliver|device_key_hash|admin_pin_hash/, `${m[1]} ${m[3]}`);
  }
  assert.doesNotMatch(sql, /GRANT (SELECT|UPDATE|INSERT|ALL)[^(;]*\bON (TABLE )?public\.(kiosk_licenses|kiosk_pairings) TO [^;]*authenticated/);
});

test('migration : kiosk_get_event limitée au compte de la borne, même forme de retour', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.kiosk_get_event\(TEXT\);/);
  const body = fnBody('kiosk_get_event');
  assert.match(body, /l\.secret <> ''\s+AND l\.secret = p_secret/);
  assert.match(body, /l\.retired_at IS NULL/);
  assert.match(body, /AND e\.org_id = v_org/);
  assert.match(body, /'form_config', json_build_object\('kiosk', e\.form_config -> 'kiosk'\)/);
});

test('migration : reprise des bornes existantes sans compte deviné', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /JOIN public\.app_admins/);
  assert.match(sql, /ALTER COLUMN org_id SET NOT NULL/);
  assert.doesNotMatch(raw, /@/);
});

test('check-kiosk-alerts : bornes du compte (non retirées), puis leurs événements', () => {
  assert.match(alerts, /\.from\('kiosk_licenses'\)[\s\S]*?\.eq\('org_id', org\.id\)[\s\S]*?\.is\('retired_at', null\)/);
  assert.match(alerts, /\.from\('events'\)[\s\S]*?\.in\('photobooth_id', \[\.\.\.licenseById\.keys\(\)\]\)/);
  assert.doesNotMatch(alerts, /\.from\('events'\)[\s\S]*?\.eq\('org_id', org\.id\)/);
});
