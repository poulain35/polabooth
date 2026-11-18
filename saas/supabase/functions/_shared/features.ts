// Catalogue des fonctionnalités activables, côté serveur (open core, étape 1, lot L1).
// Copie conforme de src/features/catalog.js (test de parité dans src/features/catalog.test.js) :
// toute modification se fait dans les deux fichiers.
// Une fonctionnalité privée peut compléter son entrée (libellé, description, clés requises) par le
// catalogue de son module (_shared/modules/<id>/catalog.ts, lu par _shared/private-modules.ts, LAB-403).
// Sans import Deno/esm.sh : testé par features.test.ts sous `node --test`.

import { corsResponse } from './cors.ts';
import { PRIVATE_MODULES } from './private-modules.ts';
import type { KeyTest, ServiceKey, ServiceSetting } from './service-keys.ts';

export type FeatureId =
  | 'core' | 'templates' | 'client_design' | 'gallery' | 'guest_form' | 'event_report'
  | 'delivery_email' | 'kiosk_alerts' | 'planning' | 'google_calendar' | 'ai_visuals' | 'help'
  | 'assistant' | 'booking' | 'prospects' | 'invoicing' | 'audio_guestbook';

export interface Feature {
  id: FeatureId;
  label: string;
  description: string;
  dependsOn: FeatureId[];
  visibility: 'open' | 'private';
  core: boolean;
  defaultEnabled: boolean;
  requiredKeys: string[];
}

/**
 * Ce qu'un module privé ajoute au code ouvert (_shared/modules/<id>/catalog.ts) : entrée de sa
 * fonctionnalité complétée, clés de ses services (après celles du code ouvert), leurs réglages non secrets
 * et leur test, conséquence métier de l'arrêt de ses tâches planifiées (email « cron en échec »).
 */
export interface ModuleCatalog {
  id: FeatureId;
  feature?: Partial<Pick<Feature, 'label' | 'description' | 'requiredKeys'>>;
  serviceKeys?: ServiceKey[];
  serviceSettings?: Record<string, ServiceSetting>;
  keyTests?: Record<string, KeyTest>;
  cronImpact?: Record<string, string>;
}

export type FeatureFlags = Record<string, unknown> | null | undefined;

export const FEATURE_DISABLED_ERROR = 'fonctionnalite_desactivee';

const OPEN_FEATURES: Feature[] = [
  {
    id: 'core',
    label: 'Événements et bornes',
    description: 'Créez vos événements, envoyez-les à la borne par code ou fichier .pola et gérez vos bornes associées.',
    dependsOn: [],
    visibility: 'open',
    core: true,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'templates',
    label: 'Modèles et éditeur',
    description: 'Préparez vos modèles d\'impression dans l\'éditeur, avec vos décorations et vos polices.',
    dependsOn: [],
    visibility: 'open',
    core: true,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'client_design',
    label: 'Design par le client',
    description: 'Vos clients personnalisent leur modèle en ligne, puis vous le validez avant l\'événement.',
    dependsOn: ['templates'],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'gallery',
    label: 'Galerie photo en ligne',
    description: 'Les invités retrouvent leurs photos en ligne, avec un diaporama et l\'envoi de leurs propres photos.',
    dependsOn: [],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'guest_form',
    label: 'Questionnaire de la borne',
    description: 'La borne pose quelques questions aux invités et vous exportez leurs réponses.',
    dependsOn: [],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'event_report',
    label: 'Bilan d\'événement',
    description: 'Envoyez à votre client un bilan chiffré de son événement : photos, impressions, partages.',
    dependsOn: [],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'delivery_email',
    label: 'Email de livraison',
    description: 'Après l\'événement, votre client reçoit un email avec le lien vers ses photos.',
    dependsOn: ['gallery'],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'kiosk_alerts',
    label: 'Alertes de la borne',
    description: 'Recevez un email quand une borne a un souci d\'imprimante ou manque de papier.',
    dependsOn: [],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'planning',
    label: 'Planning et parc de bornes',
    description: 'Suivez sur un calendrier quelle borne part sur quel événement.',
    dependsOn: [],
    visibility: 'private',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'google_calendar',
    label: 'Synchro d\'agenda',
    description: 'Retrouvez vos événements et votre planning dans votre agenda en ligne.',
    dependsOn: ['planning'],
    visibility: 'private',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'ai_visuals',
    label: 'IA visuelle',
    description: 'Détourez une image ou générez un fond directement dans l\'éditeur.',
    dependsOn: ['templates'],
    visibility: 'private',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'help',
    label: 'Aide et support',
    description: 'Vos clients consultent une page d\'aide et peuvent vous envoyer un message.',
    dependsOn: [],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'assistant',
    label: 'Assistant',
    description: 'Un assistant répond aux questions de vos clients dans la page d\'aide.',
    dependsOn: ['help'],
    visibility: 'private',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'booking',
    label: 'Réservation en ligne',
    description: 'Demandes, devis, réservation et paiement en ligne, conditions de location et logistique.',
    dependsOn: ['client_design'],
    visibility: 'private',
    core: false,
    defaultEnabled: false,
    requiredKeys: [],
  },
  {
    id: 'prospects',
    label: 'Prospects',
    description: 'Notez les visiteurs rencontrés sur un salon et envoyez-leur vos formules.',
    dependsOn: [],
    visibility: 'private',
    core: false,
    defaultEnabled: false,
    requiredKeys: [],
  },
  {
    id: 'invoicing',
    label: 'Facturation',
    description: 'Devis, factures et paiements synchronisés avec un logiciel de facturation.',
    dependsOn: ['booking'],
    visibility: 'private',
    core: false,
    defaultEnabled: false,
    requiredKeys: [],
  },
  {
    id: 'audio_guestbook',
    label: 'Livre d\'or audio',
    description: 'Les invités laissent un message vocal que votre client écoute en ligne.',
    dependsOn: [],
    visibility: 'private',
    core: false,
    defaultEnabled: false,
    requiredKeys: [],
  },
];

export const FEATURES: Feature[] = OPEN_FEATURES.map((f) => ({
  ...f,
  ...PRIVATE_MODULES.find((m) => m.id === f.id)?.feature,
}));

export const FEATURE_IDS: FeatureId[] = FEATURES.map((f) => f.id);

const BY_ID = new Map<string, Feature>(FEATURES.map((f) => [f.id, f]));

export function getFeature(id: string): Feature | null {
  return BY_ID.get(id) ?? null;
}

function ownEnabled(features: FeatureFlags, feature: Feature): boolean {
  if (feature.core) return true;
  const stored = features?.[feature.id];
  return typeof stored === 'boolean' ? stored : feature.defaultEnabled;
}

/** `features` : organizations.features. Id inconnu = inactif. */
export function isFeatureEnabled(features: FeatureFlags, id: string): boolean {
  const feature = BY_ID.get(id);
  if (!feature || !ownEnabled(features, feature)) return false;
  return feature.dependsOn.every((dep) => isFeatureEnabled(features, dep));
}

// deno-lint-ignore no-explicit-any
export interface FeaturesDb { from(table: string): any }

/**
 * Garde d'une fonction rattachée à une fonctionnalité : `null` si elle est active pour l'org,
 * sinon 404 `fonctionnalite_desactivee` (une tâche planifiée sort alors sans rien faire).
 * Org introuvable : valeurs par défaut du catalogue. Lecture en échec : 500.
 */
export async function requireFeature(db: FeaturesDb, orgId: string, id: FeatureId): Promise<Response | null> {
  const { data, error } = await db.from('organizations').select('features').eq('id', orgId).maybeSingle();
  if (error) return corsResponse(500, { error: 'Lecture des fonctionnalités impossible' });
  if (isFeatureEnabled(data?.features, id)) return null;
  return corsResponse(404, { error: FEATURE_DISABLED_ERROR });
}
