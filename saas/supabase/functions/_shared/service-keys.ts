// Clés des services, côté serveur (open core, étape 1, lot L6).
// Copie conforme de src/features/serviceKeys.js (test de parité dans src/features/serviceKeys.test.js) :
// toute modification se fait dans les deux fichiers et dans la liste blanche de la migration
// 20261213000000_service_keys.sql.
// Sans import Deno/esm.sh : testé sous `node --test`.

import type { FeatureId } from './features.ts';

export interface ServiceKey {
  name: string;
  label: string;
  feature: FeatureId | null;
  help: string;
  testable: boolean;
}

export const SERVICE_KEYS: ServiceKey[] = [
  {
    name: 'BREVO_API_KEY',
    label: 'Clé API Brevo',
    feature: null,
    help: 'Dans Brevo : Paramètres, SMTP et API, onglet Clés API.',
    testable: true,
  },
  {
    name: 'GOOGLE_CLIENT_ID',
    label: 'ID client Google',
    feature: 'google_calendar',
    help: 'Dans Google Cloud Console : API et services, Identifiants, ID client OAuth.',
    testable: true,
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    label: 'Secret client Google',
    feature: 'google_calendar',
    help: 'Affiché avec l\'ID client, dans Google Cloud Console.',
    testable: true,
  },
  {
    name: 'GOOGLE_REFRESH_TOKEN',
    label: 'Jeton d\'actualisation Google',
    feature: 'google_calendar',
    help: 'Obtenu une fois avec l\'ID et le secret client (par exemple avec OAuth Playground), avec accès à Google Agenda.',
    testable: true,
  },
  {
    name: 'ANTHROPIC_API_KEY',
    label: 'Clé API Claude (Anthropic)',
    feature: 'assistant',
    help: 'Dans la console Claude (platform.claude.com) : Settings, API keys.',
    testable: true,
  },
  {
    name: 'REPLICATE_API_TOKEN',
    label: 'Jeton API Replicate',
    feature: 'ai_visuals',
    help: 'Sur replicate.com : Account settings, API tokens.',
    testable: true,
  },
  {
    name: 'PENNYLANE_API_KEY',
    label: 'Jeton API Pennylane',
    feature: 'invoicing',
    help: 'Dans Pennylane : Paramètres, Connectivité, Développeurs, jeton API.',
    testable: true,
  },
];

export const SERVICE_KEY_NAMES: string[] = SERVICE_KEYS.map((k) => k.name);

/** Clés testées ensemble : tester l'une teste tout le groupe. */
export const GOOGLE_KEY_NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];

const BY_NAME = new Map<string, ServiceKey>(SERVICE_KEYS.map((k) => [k.name, k]));

export function getServiceKey(name: string): ServiceKey | null {
  return BY_NAME.get(name) ?? null;
}

// Réglages non secrets des services (organizations.service_settings), lus par getServiceSetting.
export const SERVICE_SETTINGS: Record<string, { feature: FeatureId; envName: string }> = {
  assistant_model: { feature: 'assistant', envName: 'ASSISTANT_MODEL' },
  google_calendar_id: { feature: 'google_calendar', envName: 'GOOGLE_CALENDAR_ID' },
};
