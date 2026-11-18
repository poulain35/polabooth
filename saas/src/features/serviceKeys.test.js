import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SERVICE_KEYS, SERVICE_KEY_NAMES, SERVICE_SETTINGS, getServiceKey, keyGroups, mergeServiceSettings, moduleSettingFields,
} from './serviceKeys.js';
import { FEATURES, getFeature } from './catalog.js';
import * as server from '../../supabase/functions/_shared/service-keys.ts';
import { PRIVATE_HISTORY } from '../../scripts/private-history.mjs';
import moduleCatalogs from '../modules/catalog.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// Clés des modules privés installés : déclarées par leur catalogue (src/modules/<id>/catalog.js, LAB-403).
const MODULE_KEYS = moduleCatalogs.flatMap((m) => m.serviceKeys ?? []).map((k) => k.name);
const MODULE_GROUPS = moduleCatalogs.filter((m) => m.serviceKeys?.length).map((m) => m.id);
const EXPECTED = ['BREVO_API_KEY', ...MODULE_KEYS];
// Réglages des modules privés installés (serviceSettings de leur catalogue, LAB-421).
const MODULE_SETTINGS = Object.assign({}, ...moduleCatalogs.map((m) => m.serviceSettings ?? {}));

test('catalogue des clés : clés ouvertes puis celles des modules, champs complets, fonctionnalité connue', () => {
  assert.deepEqual(SERVICE_KEY_NAMES, EXPECTED);
  for (const k of SERVICE_KEYS) {
    assert.ok(k.label && k.help, k.name);
    assert.equal(typeof k.testable, 'boolean', k.name);
    assert.ok(k.feature === null || getFeature(k.feature), `${k.name} → ${k.feature}`);
    assert.equal(getServiceKey(k.name), k);
  }
  assert.equal(getServiceKey('BREVO_API_KEY').feature, null, 'emails = socle');
  assert.equal(getServiceKey('inconnue'), null);
});

test('parité front / serveur : catalogue des clés et réglages identiques', () => {
  assert.deepEqual(server.SERVICE_KEYS, SERVICE_KEYS);
  assert.deepEqual(server.SERVICE_KEY_NAMES, SERVICE_KEY_NAMES);
  assert.deepEqual(server.SERVICE_SETTINGS, SERVICE_SETTINGS);
});

test('cohérence avec le catalogue des fonctionnalités : chaque requiredKey est une clé de cette fonctionnalité', () => {
  for (const feature of FEATURES) {
    for (const name of feature.requiredKeys) {
      assert.equal(getServiceKey(name)?.feature, feature.id, `${feature.id} → ${name}`);
    }
  }
  for (const key of SERVICE_KEYS.filter((k) => k.feature)) {
    assert.ok(getFeature(key.feature).requiredKeys.includes(key.name), `${key.name} absent de ${key.feature}.requiredKeys`);
  }
  for (const setting of Object.values(SERVICE_SETTINGS)) assert.ok(getFeature(setting.feature));
});

test('migration : liste blanche SQL = catalogue, RPC réservées, pas d\'accent dans le SQL exécutable', { skip: PRIVATE_HISTORY }, () => {
  const raw = read('../../supabase/migrations/20261213000000_service_keys.sql');
  const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  const allowed = sql.match(/FUNCTION public\.service_key_allowed[\s\S]*?ARRAY\[([\s\S]*?)\]/);
  assert.ok(allowed, 'liste blanche introuvable');
  // Même ensemble (l'ordre du catalogue suit les modules installés, LAB-421).
  assert.deepEqual([...allowed[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort(), [...SERVICE_KEY_NAMES].sort());
  assert.doesNotMatch(sql, /[À-ÿ]/, 'accent dans le SQL exécutable');

  const body = (name) => {
    const start = sql.indexOf(`FUNCTION public.${name}(`);
    assert.ok(start >= 0, name);
    return sql.slice(start, sql.indexOf('$$;', start));
  };
  for (const fn of ['set_service_key', 'delete_service_key', 'list_service_keys']) {
    assert.match(body(fn), /SECURITY DEFINER/, fn);
    assert.match(body(fn), /SET search_path = ''/, fn);
    assert.match(body(fn), /IF NOT public\.is_app_admin\(\) THEN\s+RAISE EXCEPTION [^;]+ERRCODE = '42501'/, fn);
  }
  assert.match(body('get_service_key'), /SECURITY DEFINER/);
  assert.match(body('get_service_key'), /vault\.decrypted_secrets/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_service_key\(text\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_service_key\(text\) TO service_role;/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.get_service_key\(text\) TO [^;]*authenticated/);
  assert.match(sql, /ALTER TABLE public\.service_keys ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*service_keys/);
  // Aucune RPC admin ne renvoie la valeur.
  assert.match(body('set_service_key'), /RETURNS void/);
  assert.match(body('list_service_keys'), /RETURNS TABLE \(name text, last4 text, updated_at timestamptz\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS service_settings jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /CHECK \(jsonb_typeof\(service_settings\) = 'object'\)/);
});

test('mergeServiceSettings : fusion, valeur vide retirée, clé inconnue ignorée', () => {
  assert.deepEqual(mergeServiceSettings(null, { pirate: 'x' }), {});
  assert.deepEqual(mergeServiceSettings(Object.freeze({ autre: 1 }), { pirate: 'x' }), { autre: 1 });
  assert.deepEqual(mergeServiceSettings([], {}), {});
  // Un réglage déclaré par un module installé (aucun dans le dépôt public).
  const id = Object.keys(SERVICE_SETTINGS)[0];
  if (!id) return;
  const stored = Object.freeze({ [id]: 'ancien@x', autre: 1 });
  assert.deepEqual(mergeServiceSettings(stored, { [id]: ' agenda@x ' }), { [id]: 'agenda@x', autre: 1 });
  assert.deepEqual(mergeServiceSettings(stored, { [id]: '  ' }), { autre: 1 });
  assert.deepEqual(mergeServiceSettings(null, { pirate: 'x', [id]: 'm' }), { [id]: 'm' });
});

test('keyGroups : par défaut (Brevo, tout installé), toutes les sections et toutes les clés', () => {
  const groups = keyGroups();
  assert.deepEqual(groups.map((g) => g.feature), [null, ...MODULE_GROUPS]);
  assert.match(groups[0].help, /Brevo/);
  assert.deepEqual(groups.flatMap((g) => g.keys.map((k) => k.name)).sort(), [...SERVICE_KEY_NAMES].sort());
  for (const g of groups) assert.ok(g.keys.every((k) => k.feature === g.feature));
});

test('keyGroups : module privé absent du build = section masquée ; SMTP = pas de clé Brevo', () => {
  const groups = keyGroups({ installed: (id) => !MODULE_GROUPS.includes(id), emailProvider: 'smtp' });
  assert.deepEqual(groups.map((g) => g.feature), [null]);
  assert.deepEqual(groups[0].keys, []);
  assert.match(groups[0].help, /SMTP/);
  assert.doesNotMatch(groups[0].help, /Brevo/);
  assert.ok(!groups.flatMap((g) => g.keys).some((k) => k.name === 'BREVO_API_KEY' || MODULE_KEYS.includes(k.name)));
});

test('réglages des modules : repris dans SERVICE_SETTINGS, champ de leur section de Paramètres > Clés', () => {
  for (const [id, setting] of Object.entries(MODULE_SETTINGS)) {
    assert.deepEqual(SERVICE_SETTINGS[id], { feature: setting.feature, envName: setting.envName }, id);
    assert.equal(mergeServiceSettings({}, { [id]: ' x ' })[id], 'x', id);
    // Avec un libellé : champ affiché par Paramètres > Clés ; sans : le module l'affiche lui-même (LAB-422).
    const shown = moduleSettingFields(setting.feature).some((f) => f.id === id);
    if (setting.label) assert.ok(setting.help && setting.placeholder && shown, id);
    else assert.equal(shown, false, id);
  }
  assert.deepEqual(moduleSettingFields('assistant'), [], 'modèle de l\'assistant : rendu par son module');
  assert.deepEqual(moduleSettingFields('inconnue'), []);
});
