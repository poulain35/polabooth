// Types de questions du formulaire pré-édition + helpers partagés
// (éditeur de questions, rendu client, page statistiques).

export const QUESTION_TYPES = [
  { value: 'text',   label: 'Texte' },
  { value: 'tel',    label: 'Téléphone' },
  { value: 'email',  label: 'Email' },
  { value: 'select', label: 'Choix unique' },
  { value: 'multi',  label: 'Choix multiple' },
];

// Questionnaire de la borne : mêmes types + case à cocher (réservée au kiosk).
export const KIOSK_QUESTION_TYPES = [
  ...QUESTION_TYPES,
  { value: 'checkbox', label: 'Case à cocher' },
];

// Identifiant stable, jamais réutilisé après suppression (horodatage + aléa).
export function newQuestionId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Questions à options prédéfinies → graphiques de répartition.
export function isChoiceType(type) {
  return type === 'select' || type === 'multi';
}

// Questions de contact : jamais agrégées dans les stats.
export function isContactType(type) {
  return type === 'tel' || type === 'email';
}

// Une question entre dans les stats si ce n'est pas un champ de contact
// et que l'admin ne l'a pas explicitement exclue (analytics === false).
export function isStatQuestion(q) {
  return !isContactType(q.type) && q.analytics !== false;
}

// Normalise une réponse texte pour regrouper les doublons ("Insta " == "insta").
export function normalizeAnswer(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Regroupement des réponses libres historiques vers des valeurs canoniques
// (avant l'introduction des questions à choix). Clés = réponses normalisées.
const ANSWER_ALIASES = {
  'google':                    'Google / recherche web',
  'internet':                  'Google / recherche web',
  'recherche internet':        'Google / recherche web',
  'recherches internet':       'Google / recherche web',
  'sur internet':              'Google / recherche web',
  'via recherches internet':   'Google / recherche web',
  'via recherche internet':    'Google / recherche web',
  'sur le net':                'Google / recherche web',
  'en cherchant sur internet': 'Google / recherche web',
  'recherche google':          'Google / recherche web',
  'insta':                     'Instagram',
  'instagram':                 'Instagram',
  'réseaux':                   'Instagram',
  'reseaux':                   'Instagram',
  'réseaux sociaux':           'Instagram',
  'reseaux sociaux':           'Instagram',
  'bouche à oreille':          'Bouche-à-oreille',
  'bouche a oreille':          'Bouche-à-oreille',
};

// Renvoie la valeur canonique d'une réponse (ou la valeur d'origine si pas d'alias).
export function canonicalizeAnswer(value) {
  if (Array.isArray(value)) return value.map(canonicalizeAnswer);
  const v = String(value ?? '').trim();
  return ANSWER_ALIASES[normalizeAnswer(v)] ?? v;
}

// Une réponse est-elle renseignée ? (gère les tableaux des choix multiples)
export function hasAnswer(value) {
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? '').trim() !== '';
}
