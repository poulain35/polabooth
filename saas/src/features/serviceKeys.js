// Clés des services saisies dans Paramètres > Clés (open core, étape 1, lot L6).
// Copie conforme côté serveur : supabase/functions/_shared/service-keys.ts (test de parité dans
// serviceKeys.test.js, qui vérifie aussi la liste blanche de la migration 20261213000000_service_keys.sql
// et les requiredKeys du catalogue des fonctionnalités). Toute modification se fait dans les trois.
//
// `name` : nom de la variable d'environnement de repli (getSecret dans _shared/secrets.ts).
// `feature` : id du catalogue des fonctionnalités, null pour le socle (emails).
// Les clés d'une fonctionnalité privée sont déclarées par son module (src/modules/<id>/catalog.js, lu par
// src/modules/catalog.js, LAB-403) et viennent après celles du code ouvert.

import moduleCatalogs from '../modules/catalog.js';

const OPEN_SERVICE_KEYS = [
  {
    name: 'BREVO_API_KEY',
    label: 'Clé API Brevo',
    feature: null,
    help: 'Dans Brevo : Paramètres, SMTP et API, onglet Clés API.',
    testable: true,
  },
];

export const SERVICE_KEYS = [
  ...OPEN_SERVICE_KEYS,
  ...moduleCatalogs.flatMap((m) => m.serviceKeys ?? []),
];

export const SERVICE_KEY_NAMES = SERVICE_KEYS.map((k) => k.name);

const BY_NAME = new Map(SERVICE_KEYS.map((k) => [k.name, k]));

export function getServiceKey(name) {
  return BY_NAME.get(name) ?? null;
}

// Sections de Paramètres > Clés : socle (emails) puis une section par fonctionnalité qui utilise des clés
// (celles des modules privés en dernier).
const KEY_GROUPS = [
  { feature: null, title: 'Emails', help: 'Socle : tous les envois d\'emails passent par Brevo.' },
  ...moduleCatalogs.filter((m) => m.serviceKeys?.length).map((m) => ({ feature: m.id })),
];

const SMTP_EMAILS_HELP = 'Socle : les emails partent par le serveur SMTP réglé à l\'installation (instance.env). Aucune clé à saisir ici.';

/**
 * Sections affichées, chacune avec ses clés (`keys`). `installed(featureId)` : faux pour une fonctionnalité
 * privée dont le module n'est pas dans le build (section masquée). `emailProvider` « smtp » : pas de clé
 * Brevo, les emails passent par le SMTP de l'instance.
 */
export function keyGroups({ installed = () => true, emailProvider = 'brevo' } = {}) {
  const smtp = emailProvider === 'smtp';
  return KEY_GROUPS
    .filter((group) => !group.feature || installed(group.feature))
    .map((group) => ({
      ...group,
      ...(smtp && group.feature === null ? { help: SMTP_EMAILS_HELP } : {}),
      keys: SERVICE_KEYS.filter((k) => k.feature === group.feature && !(smtp && k.name === 'BREVO_API_KEY')),
    }));
}

// Réglages non secrets des services (organizations.service_settings). Ceux d'un module privé sont
// déclarés par son catalogue (serviceSettings ; avec un libellé, leur champ s'affiche dans Paramètres > Clés,
// LAB-421 ; sans libellé, le module affiche lui-même son réglage, ex. modèle de l'assistant, LAB-422).
const MODULE_SETTINGS = Object.assign({}, ...moduleCatalogs.map((m) => m.serviceSettings ?? {}));

export const SERVICE_SETTINGS = Object.fromEntries(
  Object.entries(MODULE_SETTINGS).map(([id, s]) => [id, { feature: s.feature, envName: s.envName }]),
);

/** Champs texte des réglages déclarés par les modules pour la section `feature` de Paramètres > Clés. */
export function moduleSettingFields(feature) {
  return Object.entries(MODULE_SETTINGS)
    .filter(([, s]) => s.feature === feature && s.label)
    .map(([id, s]) => ({ id, label: s.label, help: s.help, placeholder: s.placeholder }));
}

/**
 * Fusionne `patch` dans les réglages relus en base. Une valeur vide retire la clé (le serveur
 * reprend alors la variable d'environnement). Clés inconnues ignorées.
 */
export function mergeServiceSettings(stored, patch) {
  const next = { ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in SERVICE_SETTINGS)) continue;
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) next[key] = text;
    else delete next[key];
  }
  return next;
}
