// Catalogue des fonctionnalités activables (open core, étape 1, lot L1).
// Copie conforme côté serveur : supabase/functions/_shared/features.ts (test de parité dans
// catalog.test.js). Toute modification se fait dans les deux fichiers.
//
// Activation stockée dans organizations.features ({ "<id>": true|false }) :
// clé absente = defaultEnabled ; socle (core: true) toujours actif ;
// une fonctionnalité dont une dépendance est inactive est inactive.

export const FEATURES = [
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
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: [],
  },
  {
    id: 'google_calendar',
    label: 'Synchro Google Calendar',
    description: 'Retrouvez vos événements et votre planning dans votre agenda Google.',
    dependsOn: ['planning'],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
  },
  {
    id: 'ai_visuals',
    label: 'IA visuelle',
    description: 'Détourez une image ou générez un fond directement dans l\'éditeur.',
    dependsOn: ['templates'],
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: ['REPLICATE_API_TOKEN'],
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
    visibility: 'open',
    core: false,
    defaultEnabled: true,
    requiredKeys: ['ANTHROPIC_API_KEY'],
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
    requiredKeys: ['PENNYLANE_API_KEY'],
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

export const FEATURE_IDS = FEATURES.map((f) => f.id);

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

export function getFeature(id) {
  return BY_ID.get(id) ?? null;
}

// Valeur choisie pour la fonctionnalité elle-même, sans regarder ses dépendances.
function ownEnabled(features, feature) {
  if (feature.core) return true;
  const stored = features?.[feature.id];
  return typeof stored === 'boolean' ? stored : feature.defaultEnabled;
}

/** `features` : organizations.features. Id inconnu = inactif. */
export function isFeatureEnabled(features, id) {
  const feature = BY_ID.get(id);
  if (!feature || !ownEnabled(features, feature)) return false;
  return feature.dependsOn.every((dep) => isFeatureEnabled(features, dep));
}

// Dépendances directes et indirectes de `id`.
function dependenciesOf(id) {
  const out = new Set();
  const walk = (current) => {
    for (const dep of BY_ID.get(current)?.dependsOn ?? []) {
      if (!out.has(dep)) { out.add(dep); walk(dep); }
    }
  };
  walk(id);
  return out;
}

// Fonctionnalités qui dépendent de `id`, directement ou non.
function dependentsOf(id) {
  return new Set(FEATURE_IDS.filter((other) => dependenciesOf(other).has(id)));
}

// Autres fonctionnalités dont l'état effectif change entre `before` et `after`, dans l'ordre du catalogue.
function changedFeatures(before, after, id) {
  return FEATURE_IDS.filter((other) => other !== id
    && isFeatureEnabled(before, other) !== isFeatureEnabled(after, other));
}

/** Active `id` et ce dont il dépend. `changed` : autres fonctionnalités activées au passage. */
export function enableWithDependencies(features, id) {
  const feature = BY_ID.get(id);
  const base = { ...(features ?? {}) };
  if (!feature || feature.core) return { features: base, changed: [] };
  const next = { ...base, [id]: true };
  for (const dep of dependenciesOf(id)) {
    const depFeature = BY_ID.get(dep);
    if (!ownEnabled(next, depFeature)) next[dep] = true;
  }
  return { features: next, changed: changedFeatures(base, next, id) };
}

/** Désactive `id` et ce qui en dépend. `changed` : autres fonctionnalités désactivées au passage. */
export function disableWithDependents(features, id) {
  const feature = BY_ID.get(id);
  const base = { ...(features ?? {}) };
  if (!feature || feature.core) return { features: base, changed: [] };
  const next = { ...base, [id]: false };
  for (const dependent of dependentsOf(id)) {
    if (ownEnabled(next, BY_ID.get(dependent))) next[dependent] = false;
  }
  return { features: next, changed: changedFeatures(base, next, id) };
}
