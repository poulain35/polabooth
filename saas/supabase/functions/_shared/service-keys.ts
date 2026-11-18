// Clés des services, côté serveur (open core, étape 1, lot L6).
// Copie conforme de src/features/serviceKeys.js (test de parité dans src/features/serviceKeys.test.js) :
// toute modification se fait dans les deux fichiers et dans la liste blanche de la migration
// 20261213000000_service_keys.sql.
// Les clés d'une fonctionnalité privée sont déclarées par son module (_shared/modules/<id>/catalog.ts,
// lu par _shared/private-modules.ts, LAB-403) et viennent après celles du code ouvert.
// Sans import Deno/esm.sh : testé sous `node --test`.

import type { FeatureId } from './features.ts';
import { PRIVATE_MODULES } from './private-modules.ts';

export interface ServiceKey {
  name: string;
  label: string;
  feature: FeatureId | null;
  help: string;
  testable: boolean;
}

/**
 * Test d'une clé par un appel en lecture seule chez le fournisseur (test-service-key).
 * `skip` : message si le test ne doit pas être fait (simulation active, par exemple), sinon null.
 * `group` : clés testées ensemble, tester l'une teste tout le groupe (LAB-421) ; `values` contient alors
 * la valeur de chacune, `missing` complète le message si l'une manque, `ok` remplace « Clé valide. ».
 */
export interface KeyTest {
  request(value: string, values: Record<string, string>): { url: string; init: RequestInit };
  skip?(env: (name: string) => string | undefined): string | null;
  group?: { names: string[]; missing: string; ok: string };
}

const OPEN_SERVICE_KEYS: ServiceKey[] = [
  {
    name: 'BREVO_API_KEY',
    label: 'Clé API Brevo',
    feature: null,
    help: 'Dans Brevo : Paramètres, SMTP et API, onglet Clés API.',
    testable: true,
  },
];

export const SERVICE_KEYS: ServiceKey[] = [
  ...OPEN_SERVICE_KEYS,
  ...PRIVATE_MODULES.flatMap((m) => m.serviceKeys ?? []),
];

export const SERVICE_KEY_NAMES: string[] = SERVICE_KEYS.map((k) => k.name);

const BY_NAME = new Map<string, ServiceKey>(SERVICE_KEYS.map((k) => [k.name, k]));

export function getServiceKey(name: string): ServiceKey | null {
  return BY_NAME.get(name) ?? null;
}

/** Réglage non secret d'un service (organizations.service_settings), lu par getServiceSetting. */
export interface ServiceSetting {
  feature: FeatureId;
  envName: string;
}

// Réglages déclarés par les modules privés (serviceSettings de leur catalogue, LAB-421 et LAB-422).
export const SERVICE_SETTINGS: Record<string, ServiceSetting> = Object.assign(
  {},
  ...PRIVATE_MODULES.map((m) => m.serviceSettings ?? {}),
);
