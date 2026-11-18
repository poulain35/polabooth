import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FEATURES, FEATURE_IDS, disableWithDependents, enableWithDependencies, getFeature, isFeatureEnabled,
} from './catalog.js';
import * as server from '../../supabase/functions/_shared/features.ts';
import { PRIVATE_HISTORY } from '../../scripts/private-history.mjs';

const SPEC_IDS = [
  'core', 'templates', 'client_design', 'gallery', 'guest_form', 'event_report', 'delivery_email',
  'kiosk_alerts', 'planning', 'google_calendar', 'ai_visuals', 'help', 'assistant', 'booking',
  'prospects', 'invoicing', 'audio_guestbook',
];
const PRIVATE_IDS = ['planning', 'google_calendar', 'ai_visuals', 'assistant', 'booking', 'prospects', 'invoicing', 'audio_guestbook'];
// Privées mais actives par défaut (version allégée, LAB-421 et LAB-422) : rien ne change pour les
// entreprises existantes.
const PRIVATE_DEFAULT_ON = ['planning', 'google_calendar', 'ai_visuals', 'assistant'];
const ALL_TRUE = Object.fromEntries(SPEC_IDS.map((id) => [id, true]));

test('catalogue : les 17 fonctionnalités de la spec, champs complets', () => {
  assert.deepEqual(FEATURE_IDS, SPEC_IDS);
  for (const f of FEATURES) {
    assert.ok(f.label && f.description, f.id);
    assert.ok(Array.isArray(f.dependsOn) && Array.isArray(f.requiredKeys), f.id);
    assert.equal(f.visibility, PRIVATE_IDS.includes(f.id) ? 'private' : 'open', f.id);
    assert.equal(f.core, f.id === 'core' || f.id === 'templates', f.id);
    assert.equal(f.defaultEnabled, f.visibility === 'open' || PRIVATE_DEFAULT_ON.includes(f.id), f.id);
    for (const dep of f.dependsOn) assert.ok(getFeature(dep), `${f.id} → ${dep}`);
  }
  assert.deepEqual(
    Object.fromEntries(FEATURES.filter((f) => f.dependsOn.length).map((f) => [f.id, f.dependsOn])),
    {
      client_design: ['templates'], delivery_email: ['gallery'], google_calendar: ['planning'],
      ai_visuals: ['templates'], assistant: ['help'], booking: ['client_design'], invoicing: ['booking'],
    },
  );
});

test('catalogue : aucun cycle de dépendances', () => {
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 'done') return;
    assert.notEqual(state.get(id), 'visiting', `cycle : ${[...path, id].join(' → ')}`);
    state.set(id, 'visiting');
    for (const dep of getFeature(id).dependsOn) visit(dep, [...path, id]);
    state.set(id, 'done');
  };
  for (const id of FEATURE_IDS) visit(id, []);
});

test('catalogue : une fonctionnalité ouverte ne dépend jamais d\'une privée', () => {
  for (const f of FEATURES.filter((x) => x.visibility === 'open')) {
    for (const dep of f.dependsOn) assert.equal(getFeature(dep).visibility, 'open', `${f.id} → ${dep}`);
  }
});

test('isFeatureEnabled : clé absente = valeur par défaut', () => {
  for (const features of [{}, null, undefined]) {
    assert.equal(isFeatureEnabled(features, 'gallery'), true);
    assert.equal(isFeatureEnabled(features, 'assistant'), true);
    assert.equal(isFeatureEnabled(features, 'booking'), false);
    assert.equal(isFeatureEnabled(features, 'audio_guestbook'), false);
  }
  assert.equal(isFeatureEnabled({ gallery: 'oui' }, 'gallery'), true, 'valeur non booléenne ignorée');
});

test('isFeatureEnabled : socle toujours actif, id inconnu inactif', () => {
  assert.equal(isFeatureEnabled({ core: false, templates: false }, 'core'), true);
  assert.equal(isFeatureEnabled({ core: false, templates: false }, 'templates'), true);
  assert.equal(isFeatureEnabled({ client_design: true, templates: false }, 'client_design'), true);
  assert.equal(isFeatureEnabled(ALL_TRUE, 'inconnue'), false);
});

test('isFeatureEnabled : dépendance inactive (directe ou indirecte) = inactive', () => {
  assert.equal(isFeatureEnabled({ gallery: false, delivery_email: true }, 'delivery_email'), false);
  assert.equal(isFeatureEnabled({ help: false }, 'assistant'), false);
  assert.equal(isFeatureEnabled({ invoicing: true }, 'invoicing'), false, 'booking absent = privé inactif');
  assert.equal(isFeatureEnabled({ invoicing: true, booking: true, client_design: false }, 'invoicing'), false);
  assert.equal(isFeatureEnabled({ invoicing: true, booking: true }, 'invoicing'), true);
});

test('isFeatureEnabled : tout à true (prod après la migration) = tout actif', () => {
  for (const id of SPEC_IDS) assert.equal(isFeatureEnabled(ALL_TRUE, id), true, id);
});

test('enableWithDependencies : active les dépendances et les nomme', () => {
  assert.deepEqual(enableWithDependencies({}, 'invoicing'), {
    features: { invoicing: true, booking: true },
    changed: ['booking'],
  });
  assert.deepEqual(enableWithDependencies({ client_design: false }, 'invoicing'), {
    features: { client_design: true, invoicing: true, booking: true },
    changed: ['client_design', 'booking'],
  });
  assert.deepEqual(enableWithDependencies({ help: false, assistant: false }, 'assistant'), {
    features: { help: true, assistant: true },
    changed: ['help'],
  });
});

test('enableWithDependencies : sans dépendance inactive, rien d\'autre ne change', () => {
  assert.deepEqual(enableWithDependencies({ gallery: false, delivery_email: false }, 'gallery'), {
    features: { gallery: true, delivery_email: false },
    changed: [],
  });
  assert.deepEqual(enableWithDependencies({}, 'audio_guestbook'), { features: { audio_guestbook: true }, changed: [] });
});

test('enableWithDependencies : nomme aussi une fonctionnalité réactivée par effet de bord', () => {
  // booking était coché mais inactif faute de client_design.
  assert.deepEqual(enableWithDependencies({ client_design: false, booking: true }, 'client_design'), {
    features: { client_design: true, booking: true },
    changed: ['booking'],
  });
});

test('disableWithDependents : désactive ce qui dépend, directement ou non', () => {
  assert.deepEqual(disableWithDependents(ALL_TRUE, 'client_design'), {
    features: { ...ALL_TRUE, client_design: false, booking: false, invoicing: false },
    changed: ['booking', 'invoicing'],
  });
  assert.deepEqual(disableWithDependents({}, 'gallery'), {
    features: { gallery: false, delivery_email: false },
    changed: ['delivery_email'],
  });
  assert.deepEqual(disableWithDependents({}, 'client_design'), {
    features: { client_design: false },
    changed: [],
  }, 'booking déjà inactif par défaut');
});

test('disableWithDependents : sans dépendant actif, rien d\'autre ne change', () => {
  assert.deepEqual(disableWithDependents(ALL_TRUE, 'audio_guestbook'), {
    features: { ...ALL_TRUE, audio_guestbook: false },
    changed: [],
  });
});

test('enable / disable : socle et id inconnu sans effet, entrée jamais modifiée', () => {
  const input = Object.freeze({ gallery: true });
  for (const fn of [enableWithDependencies, disableWithDependents]) {
    assert.deepEqual(fn(input, 'core'), { features: { gallery: true }, changed: [] });
    assert.deepEqual(fn(input, 'templates'), { features: { gallery: true }, changed: [] });
    assert.deepEqual(fn(input, 'inconnue'), { features: { gallery: true }, changed: [] });
  }
  disableWithDependents(input, 'gallery');
  assert.deepEqual(input, { gallery: true });
});

test('enable puis disable : retour au même état effectif', () => {
  for (const id of SPEC_IDS) {
    const { features: on } = enableWithDependencies({}, id);
    assert.equal(isFeatureEnabled(on, id), true, id);
    const { features: off } = disableWithDependents(on, id);
    assert.equal(isFeatureEnabled(off, id), getFeature(id).core, id);
  }
});

test('migration : met à true chaque id du catalogue pour les entreprises existantes', { skip: PRIVATE_HISTORY }, () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261211000000_org_features.sql', import.meta.url), 'utf8');
  const block = sql.match(/SET features = jsonb_build_object\(([\s\S]*?)\) \|\| features/);
  assert.ok(block, 'UPDATE introuvable');
  const ids = [...block[1].matchAll(/'([a-z_]+)',\s*true/g)].map((m) => m[1]);
  assert.deepEqual(ids, FEATURE_IDS);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
});

test('parité front / serveur : catalogue et isFeatureEnabled identiques', () => {
  assert.deepEqual(server.FEATURES, FEATURES);
  assert.deepEqual(server.FEATURE_IDS, FEATURE_IDS);
  const cases = [
    {}, null, ALL_TRUE, { gallery: false }, { help: false, assistant: true }, { booking: true },
    { booking: true, invoicing: true }, { client_design: false, booking: true, invoicing: true },
    { core: false, templates: false }, { gallery: 'oui' },
  ];
  for (const features of cases) {
    for (const id of [...SPEC_IDS, 'inconnue']) {
      assert.equal(server.isFeatureEnabled(features, id), isFeatureEnabled(features, id), `${id} ${JSON.stringify(features)}`);
    }
  }
});
