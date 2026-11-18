// Réglages de l'organisation : zones perdues, profil, fonctionnalités, clés des services, logo, mise en route.
import { mergeBusinessProfile } from '../businessProfile.js';
import { orgLogoExtension, orgLogoPath, orgLogoPaths, orgLogoProblem, orgLogoUrl } from '../orgLogo.js';
import { kioskStorageErrorMessage } from '../kioskBackground.js';
import { mergeServiceSettings } from '../../features/serviceKeys.js';
import { publicFeaturesFrom } from '../../features/featureGate.js';
import { supabase } from './client.js';
import { callFunction, requestFunction } from './functions.js';
import { currentSession, ownOrganization } from './session.js';

/**
 * Config zones perdues de l'organisation de l'admin connecté. Sans session (éditeur client), {}
 * sans requête : anon n'a plus accès à organizations (LAB-391).
 */
export async function getFormatBleed() {
  if (!(await currentSession())) return {};
  const { data } = await supabase
    .from('organizations')
    .select('format_bleed')
    .maybeSingle();
  return data?.format_bleed ?? {};
}

/** Sauvegarde la config zones perdues dans organizations (admin). */
export async function updateFormatBleed(orgId, formatBleed) {
  const { error } = await supabase
    .from('organizations')
    .update({ format_bleed: formatBleed })
    .eq('id', orgId);
  if (error) throw error;
}

/** Profil business + réglages d'automatisation email (admin). */
export async function getBusinessProfile(orgId) {
  const { data, error } = await supabase
    .from('organizations')
    .select('business_profile')
    .eq('id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data?.business_profile ?? null;
}

/**
 * Enregistre les clés d'une carte des réglages (profil ou emails au client) en les fusionnant avec
 * la valeur relue en base juste avant : les autres clés (balance_window_days…) sont conservées.
 * `columns` : autres colonnes d'organizations écrites dans la même requête (LAB-262).
 */
export async function saveBusinessProfile(orgId, patch, columns = {}) {
  const stored = await getBusinessProfile(orgId);
  const businessProfile = mergeBusinessProfile(stored, patch);
  const { error } = await supabase
    .from('organizations')
    .update({ business_profile: businessProfile, ...columns })
    .eq('id', orgId);
  if (error) throw error;
  return businessProfile;
}

/**
 * Fonctionnalités activées de l'org du propriétaire connecté (organizations.features, open core L1).
 * `{ orgId: null, features: {} }` sans session ni org : valeurs par défaut du catalogue.
 */
export async function getOrgFeatures() {
  const { signedIn, org } = await ownOrganization('id, features');
  if (!signedIn) return { orgId: null, features: {} };
  return { orgId: org?.id ?? null, features: org?.features ?? {} };
}

// Liste publique des fonctionnalités actives de l'organisation d'un événement, par code d'accès.
// Une seule requête par code. Erreur (RPC pas encore déployée, réseau…) : tout est considéré actif.
const publicFeaturesCache = new Map();

/** Fonctionnalités actives (ids) de l'organisation de l'événement `code`. Ne lève jamais. */
export function getPublicFeatures(code) {
  const key = String(code ?? '').trim();
  // Sans code (ex. /aide) : pas d'organisation à interroger, tout est considéré comme actif.
  if (!key) return Promise.resolve(publicFeaturesFrom({ error: true }));
  if (!publicFeaturesCache.has(key)) {
    const pending = Promise.resolve()
      .then(() => supabase.rpc('public_features_by_code', { p_code: code }))
      .then(publicFeaturesFrom, () => publicFeaturesFrom({ error: true }));
    publicFeaturesCache.set(key, pending);
  }
  return publicFeaturesCache.get(key);
}

export async function saveOrgFeatures(orgId, features) {
  const { error } = await supabase.from('organizations').update({ features }).eq('id', orgId);
  if (error) throw error;
}

// ── Clés des services (open core L6, Paramètres > Clés) ─────────────────────
// Valeurs chiffrées dans Vault : le navigateur ne lit jamais une clé, seulement ses 4 derniers
// caractères et sa date (RPC réservées à is_app_admin()).

/** `[{ name, last4, updated_at }]` des clés saisies. */
export async function listServiceKeys() {
  const { data, error } = await supabase.rpc('list_service_keys');
  if (error) throw error;
  return data ?? [];
}

export async function setServiceKey(name, value) {
  const { error } = await supabase.rpc('set_service_key', { p_name: name, p_value: value });
  if (error) throw error;
}

export async function deleteServiceKey(name) {
  const { error } = await supabase.rpc('delete_service_key', { p_name: name });
  if (error) throw error;
}

/** Appel en lecture seule chez le fournisseur : `{ ok, source: 'vault'|'env'|'none', message }`. */
export function testServiceKey(name) {
  return callFunction('test-service-key', { admin: true, json: { name }, fallback: 'Test de la clé impossible' });
}

/** Réglages non secrets (organizations.service_settings) de l'org du propriétaire connecté. */
export async function getServiceSettings() {
  const { signedIn, org } = await ownOrganization('id, service_settings');
  if (!signedIn) return { orgId: null, settings: {} };
  return { orgId: org?.id ?? null, settings: org?.service_settings ?? {} };
}

/** Fusionne `patch` avec la valeur relue juste avant ; une valeur vide retire le réglage. */
export async function saveServiceSettings(orgId, patch) {
  const { data, error: readError } = await supabase
    .from('organizations').select('service_settings').eq('id', orgId).maybeSingle();
  if (readError) throw readError;
  const serviceSettings = mergeServiceSettings(data?.service_settings, patch);
  const { error } = await supabase.from('organizations').update({ service_settings: serviceSettings }).eq('id', orgId);
  if (error) throw error;
  return serviceSettings;
}

// ── Logo de la société (LAB-257) ─────────────────────────────────────────────

/**
 * Envoie le logo de la société dans kiosk-backgrounds/org/{orgId}/logo.png (ou .jpg) et
 * l'enregistre dans organizations.logo_url. Lève une Error au message clair si le fichier est
 * refusé (format, poids). Retourne la nouvelle URL.
 */
export async function uploadOrgLogo(orgId, file) {
  const problem = orgLogoProblem(file);
  if (problem) throw new Error(problem);
  const ext  = orgLogoExtension(file);
  const path = orgLogoPath(orgId, ext);
  const bucket = supabase.storage.from('kiosk-backgrounds');

  const { error: upErr } = await bucket.upload(path, file, {
    upsert: true, contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
  });
  if (upErr) throw new Error(kioskStorageErrorMessage(upErr));
  // L'ancien logo dans l'autre format ne sert plus.
  await bucket.remove(orgLogoPaths(orgId).filter((p) => p !== path)).catch(() => {});

  const logoUrl = orgLogoUrl(bucket.getPublicUrl(path).data.publicUrl, Date.now());
  const { error } = await supabase.from('organizations').update({ logo_url: logoUrl }).eq('id', orgId);
  if (error) throw error;
  return logoUrl;
}

/** Supprime le logo de la société : fichiers du bucket et organizations.logo_url. */
export async function removeOrgLogo(orgId) {
  const { error } = await supabase.from('organizations').update({ logo_url: null }).eq('id', orgId);
  if (error) throw error;
  await supabase.storage.from('kiosk-backgrounds').remove(orgLogoPaths(orgId)).catch(() => {});
}

// ── Mise en route de l'admin (LAB-344, spec docs/specs/mise-en-route.md) ─────
// Données lues pour cocher les étapes (règles pures dans setupSteps.js). Les filtres par
// organisation sont explicites : l'administrateur de l'application voit toutes les lignes.

/**
 * Entrées de buildSetupSteps lues en base : `{ org, activeTemplates, kioskPhotos, eventCount }`.
 * `org` null sans session ou sans organisation à soi (pas de carte). Les comptes ne lisent aucune ligne.
 */
export async function fetchSetupInputs() {
  const { org } = await ownOrganization('id, contact_company, contact_email, contact_phone, logo_url, notify_email, features');
  if (!org) return { org: null, activeTemplates: 0, kioskPhotos: 0, eventCount: 0 };
  const [templates, photos, events] = await Promise.all([
    supabase.from('templates').select('id', { count: 'exact', head: true })
      .eq('is_active', true).not('preview_url', 'is', null),
    // Une photo de borne suffit (étape 9) : on s'arrête à la première, sans compter toutes les photos.
    supabase.from('photos').select('id, events!inner(org_id)')
      .eq('source', 'kiosk').eq('events.org_id', org.id).limit(1),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
  ]);
  for (const res of [templates, photos, events]) if (res.error) throw res.error;
  return {
    org,
    activeTemplates: templates.count ?? 0,
    kioskPhotos: photos.data?.length ?? 0,
    eventCount: events.count ?? 0,
  };
}

/**
 * État des emails et des clés des services (action `status` de test-service-key, réservée à
 * l'administrateur de l'application) : `{ email: { provider, ready, missing }, keys: { NOM: source } }`.
 * Aucune valeur de clé. null en cas d'erreur ou d'ancienne fonction (400) : « état inconnu ».
 */
export async function fetchServiceStatus() {
  try {
    // requestFunction : statut et contenu lus à part, sans lever. Sans session, l'erreur
    // « Session expirée » est rattrapée ci-dessous : null, comme avant.
    const { res, data } = await requestFunction('test-service-key', { admin: true, json: { action: 'status' } });
    if (!res.ok || !data?.email || !data?.keys) return null;
    return data;
  } catch {
    return null;
  }
}
