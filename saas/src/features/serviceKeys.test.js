import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GOOGLE_KEY_NAMES, SERVICE_KEYS, SERVICE_KEY_NAMES, SERVICE_SETTINGS, getServiceKey, keyGroups, mergeServiceSettings,
} from './serviceKeys.js';
import { FEATURES, getFeature } from './catalog.js';
import { ASSISTANT_MODELS, ASSISTANT_MODEL_LINKS, PRICES_CHECKED_ON, VISUAL_MODELS } from './aiModels.js';
import * as server from '../../supabase/functions/_shared/service-keys.ts';
import { PRIVATE_HISTORY } from '../../scripts/private-history.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const EXPECTED = [
  'BREVO_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'ANTHROPIC_API_KEY', 'REPLICATE_API_TOKEN', 'PENNYLANE_API_KEY',
];

test('catalogue des clés : les 7 clés, champs complets, fonctionnalité connue', () => {
  assert.deepEqual(SERVICE_KEY_NAMES, EXPECTED);
  for (const k of SERVICE_KEYS) {
    assert.ok(k.label && k.help, k.name);
    assert.equal(typeof k.testable, 'boolean', k.name);
    assert.ok(k.feature === null || getFeature(k.feature), `${k.name} → ${k.feature}`);
    assert.equal(getServiceKey(k.name), k);
  }
  assert.equal(getServiceKey('BREVO_API_KEY').feature, null, 'emails = socle');
  assert.equal(getServiceKey('inconnue'), null);
  for (const name of GOOGLE_KEY_NAMES) assert.equal(getServiceKey(name).feature, 'google_calendar');
});

test('parité front / serveur : catalogue des clés et réglages identiques', () => {
  assert.deepEqual(server.SERVICE_KEYS, SERVICE_KEYS);
  assert.deepEqual(server.SERVICE_KEY_NAMES, SERVICE_KEY_NAMES);
  assert.deepEqual(server.GOOGLE_KEY_NAMES, GOOGLE_KEY_NAMES);
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
  assert.deepEqual([...allowed[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]), SERVICE_KEY_NAMES);
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
  const stored = Object.freeze({ assistant_model: 'claude-haiku-5-5', autre: 1 });
  assert.deepEqual(mergeServiceSettings(stored, { google_calendar_id: ' agenda@x ' }), {
    assistant_model: 'claude-haiku-5-5', autre: 1, google_calendar_id: 'agenda@x',
  });
  assert.deepEqual(mergeServiceSettings(stored, { assistant_model: '  ' }), { autre: 1 });
  assert.deepEqual(mergeServiceSettings(null, { pirate: 'x', assistant_model: 'm' }), { assistant_model: 'm' });
  assert.deepEqual(mergeServiceSettings([], {}), {});
});

test('aide au choix des modèles : forme et ids alignés sur les fonctions serveur', () => {
  assert.deepEqual(ASSISTANT_MODELS.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  for (const m of ASSISTANT_MODELS) assert.ok(m.label && m.summary && m.price, m.id);
  assert.match(ASSISTANT_MODEL_LINKS.models, /^https:\/\//);
  assert.match(ASSISTANT_MODEL_LINKS.pricing, /^https:\/\//);
  assert.match(PRICES_CHECKED_ON, /^\d{2}\/\d{2}\/\d{4}$/);

  const generate = read('../../supabase/functions/generate-background/index.ts');
  const remove = read('../../supabase/functions/remove-background/index.ts');
  for (const m of VISUAL_MODELS) {
    assert.ok(m.label && m.use, m.id);
    assert.equal(m.url, `https://replicate.com/${m.id}`);
    assert.ok(generate.includes(`'${m.id}'`) || remove.includes(`'${m.id}'`), `${m.id} absent des fonctions`);
  }
  for (const m of generate.matchAll(/'(black-forest-labs\/[a-z0-9.-]+)'/g)) {
    assert.ok(VISUAL_MODELS.some((v) => v.id === m[1]), `${m[1]} absent de l'aide`);
  }
});

test('keyGroups : par défaut (Brevo, tout installé), toutes les sections et toutes les clés', () => {
  const groups = keyGroups();
  assert.deepEqual(groups.map((g) => g.feature), [null, 'google_calendar', 'assistant', 'ai_visuals', 'invoicing']);
  assert.match(groups[0].help, /Brevo/);
  assert.deepEqual(groups.flatMap((g) => g.keys.map((k) => k.name)).sort(), [...SERVICE_KEY_NAMES].sort());
  for (const g of groups) assert.ok(g.keys.every((k) => k.feature === g.feature));
});

test('keyGroups : module privé absent du build = section masquée ; SMTP = pas de clé Brevo', () => {
  const groups = keyGroups({ installed: (id) => id !== 'invoicing', emailProvider: 'smtp' });
  assert.deepEqual(groups.map((g) => g.feature), [null, 'google_calendar', 'assistant', 'ai_visuals']);
  assert.deepEqual(groups[0].keys, []);
  assert.match(groups[0].help, /SMTP/);
  assert.doesNotMatch(groups[0].help, /Brevo/);
  assert.ok(!groups.flatMap((g) => g.keys).some((k) => k.name === 'BREVO_API_KEY' || k.name === 'PENNYLANE_API_KEY'));
});
