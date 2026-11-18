// Application des fonctionnalités activables côté front (open core, lot L2a).
// Logique pure, testée dans featureGate.test.js : correspondance menu → fonctionnalité,
// reconnaissance de la réponse serveur « fonctionnalité désactivée », lecture de la liste publique.

import { FEATURE_IDS, getFeature, isFeatureEnabled } from './catalog.js';

/** Code renvoyé par le serveur (edge function : 404 { error }, RPC : exception PT404). */
export const FEATURE_DISABLED = 'fonctionnalite_desactivee';

/** Texte affiché sur une page publique dont la fonctionnalité est désactivée. */
export const FEATURE_UNAVAILABLE_MESSAGE = "Cette page n'est pas disponible.";

function isDisabledCode(value) {
  return typeof value === 'string' && value.trim() === FEATURE_DISABLED;
}

/**
 * Vrai si `err` est la réponse « fonctionnalité désactivée » du serveur :
 * - corps d'edge function `{ error: 'fonctionnalite_desactivee' }` (ou Error construite depuis ce corps) ;
 * - erreur RPC supabase-js `{ code: 'PT404', message: 'fonctionnalite_desactivee' }` ;
 * - Error enrichie `{ code }`, `{ data }` ou `{ body }` (bookingPublic, functionError).
 */
export function isFeatureDisabledError(err, depth = 0) {
  if (err == null || depth > 3) return false;
  if (typeof err === 'string') return isDisabledCode(err);
  if (typeof err !== 'object') return false;
  if (isDisabledCode(err.message) || isDisabledCode(err.error) || isDisabledCode(err.code)) return true;
  return isFeatureDisabledError(err.data, depth + 1)
    || isFeatureDisabledError(err.body, depth + 1)
    || isFeatureDisabledError(err.error, depth + 1);
}

/**
 * Résultat de la RPC public_features_by_code → liste des fonctionnalités actives.
 * Toute erreur (RPC absente avant le lot serveur, réseau, code inconnu) ou réponse inattendue :
 * tout est considéré actif, le serveur reste seul juge de ce qu'il sert.
 */
export function publicFeaturesFrom(result) {
  const { data, error } = result ?? {};
  if (error || !Array.isArray(data)) return [...FEATURE_IDS];
  return data.filter((id) => typeof id === 'string');
}

/** `list` : liste publique (null = inconnue, donc active). */
export function hasPublicFeature(list, id) {
  if (!Array.isArray(list)) return true;
  return list.includes(id);
}

/**
 * Fonctionnalité dont dépend chaque entrée du menu admin (clé = `to` de MODULES dans AdminLayout).
 * Socle (core / templates) : toujours visible. Un tableau = l'entrée s'affiche si l'une des
 * fonctionnalités est disponible (« Demandes et devis » : booking ou prospects).
 */
export const NAV_FEATURES = {
  aujourdhui: 'core',
  ventes: ['booking', 'prospects'],
  events: 'core',
  bornes: 'core',
  reglages: 'core',
  templates: 'templates',          // Bibliothèque (modèles, décorations, polices)
  aide: 'help',
};

/** Fonctionnalité(s) d'une entrée du menu ; entrée inconnue = socle (toujours visible). */
export function navItemFeature(to) {
  return NAV_FEATURES[to] ?? 'core';
}

/** L'entrée `to` est-elle visible ? (une seule de ses fonctionnalités disponible suffit) */
export function navItemAvailable(to, isAvailable) {
  const feature = navItemFeature(to);
  return Array.isArray(feature) ? feature.some((id) => isAvailable(id)) : isAvailable(feature);
}

/** Retire du menu les entrées dont la fonctionnalité est inactive, puis les groupes vides. */
export function filterNav(modules, isAvailable) {
  return modules
    .map((module) => ({ ...module, items: module.items.filter((item) => navItemAvailable(item.to, isAvailable)) }))
    .filter((module) => module.items.length > 0);
}

/**
 * Disponibilité d'une fonctionnalité dans l'admin, à partir de l'état de useFeatures().
 * Tant que la lecture est en cours, en erreur ou sans organisation, tout est considéré
 * disponible : pas de clignotement pour l'admin actuel, et le serveur garde la main.
 */
export function featureAvailable({ loading, error, orgId, features } = {}, id) {
  if (loading || error || !orgId) return true;
  return isFeatureEnabled(features, id);
}

/**
 * Fonctionnalité présente dans cette construction (open core L2b) : ouverte, ou privée avec son
 * module installé (src/modules/index.js). Une fonctionnalité privée absente n'est jamais disponible,
 * même activée dans organizations.features.
 */
export function featureInstalled(id, installedIds) {
  const feature = getFeature(id);
  return !feature || feature.visibility !== 'private' || installedIds.has(id);
}
