import { createClient } from '@supabase/supabase-js';
import { functionError, readJson } from './httpErrors.js';
import { parsePublicEvent, PUBLIC_EVENT_RPC } from './publicEvent.js';
import { parsePublicPhotos, PUBLIC_PHOTOS_RPC, withDownloadUrls } from './publicPhotos.js';
import { createGalleryOwnerCheck, getPhotosUrl } from './galleryTracking.js';
import { mergeBusinessProfile } from './businessProfile.js';
import { EMAIL_LOG_COLUMNS, applyEmailLogPlan, bookingRefScope, emailLogQueryPlan, emailLogSelect, escapeLike } from './emailTracking.js';
import { buildPolaBundle, polaBundleWarnings, polaDesignProblem, polaFileName, PolaExportError } from './polaBundle.js';
import { orgLogoExtension, orgLogoPath, orgLogoPaths, orgLogoProblem, orgLogoUrl } from './orgLogo.js';
import {
  eventBackgroundPath, kioskBackgroundContentType, kioskBackgroundExtension, kioskBackgroundProblem,
  kioskStorageErrorMessage, setupBackgroundPath,
} from './kioskBackground.js';
import { FORM_UNKNOWN_EVENT_MESSAGE, NOT_KIOSK_CONSENT_FILTER, formSubmitErrorMessage, withoutKioskConsents } from './formResponses.js';
import { guestSearchFilter } from './guestResponsesExport.js';
import { guestExportReminders } from './guestExportReminder.js';
import { sessionsNeedingThumbnail, withPrintThumbnails } from './printThumbnails.js';
import { isVideoUrl } from '../utils/media.js';
import { mergeServiceSettings } from '../features/serviceKeys.js';
import { publicFeaturesFrom } from '../features/featureGate.js';
import { isFeatureEnabled } from '../features/catalog.js';
import { INSTALLED_MODULES } from '../features/modules.js';
import { recoveryLink, resetRedirectUrl, toAuthError } from './passwordRules.js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  console.warn('Variables Supabase manquantes dans .env — voir .env.example');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnon ?? '');

export const FUNCTIONS_URL = `${supabaseUrl}/functions/v1`;

/** Valide un code d'accès et retourne l'événement + le design en cours. */
export async function getEventByCode(code) {
  const res = await fetch(`${FUNCTIONS_URL}/get-event?code=${encodeURIComponent(code)}`, {
    headers: { apikey: supabaseAnon },
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur serveur');
  return data; // { event, design }
}

/**
 * Sauvegarde automatique (brouillon).
 *
 * Le canvas_json d'un design peut peser plusieurs Mo. Pour éviter de saturer la
 * bande passante et de resérialiser/renvoyer tout le JSON à chaque modification :
 *  - Debounce 1500 ms : les appels rapprochés (déclenchements en rafale, clics
 *    répétés) sont coalescés en un seul envoi réseau — seul le dernier payload
 *    part. 1500 ms est assez long pour absorber une rafale d'édition, assez court
 *    pour qu'un "sauvegarder puis quitter" persiste avant la fin du garde de nav.
 *  - Détection de changement : si le payload sérialisé est identique au dernier
 *    envoi réussi (même code + format), on court-circuite le réseau — aucun octet
 *    inutile, aucun risque de perte (l'état distant est déjà à jour).
 *
 * Le promise retourné ne se résout qu'après l'envoi effectif (ou immédiatement si
 * le payload est inchangé), donc `await autosaveDesign(...)` reste fiable pour les
 * appelants qui attendent la persistance (ex. "sauvegarder et quitter").
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;
const _autosaveState = { timer: null, pending: null, lastSentByCode: new Map() };

async function _sendAutosave({ code, canvasJson, format }) {
  const res = await fetch(`${FUNCTIONS_URL}/autosave-design`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body:    JSON.stringify({ code, canvas_json: canvasJson, format }),
  });
  if (!res.ok) throw functionError(res, await readJson(res), 'Erreur sauvegarde');
  return res.json();
}

export function autosaveDesign({ code, canvasJson, format }) {
  const serialized = JSON.stringify(canvasJson);
  const lastSent = _autosaveState.lastSentByCode.get(code);
  if (lastSent && lastSent.serialized === serialized && lastSent.format === format) {
    return Promise.resolve(lastSent.result ?? { skipped: true });
  }

  if (_autosaveState.timer) clearTimeout(_autosaveState.timer);

  if (!_autosaveState.pending) {
    let resolveFn, rejectFn;
    const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
    _autosaveState.pending = { promise, resolve: resolveFn, reject: rejectFn };
  }
  const pending = _autosaveState.pending;

  _autosaveState.timer = setTimeout(async () => {
    _autosaveState.timer = null;
    _autosaveState.pending = null;
    try {
      const result = await _sendAutosave({ code, canvasJson, format });
      _autosaveState.lastSentByCode.set(code, { serialized, format, result });
      pending.resolve(result);
    } catch (err) {
      pending.reject(err);
    }
  }, AUTOSAVE_DEBOUNCE_MS);

  return pending.promise;
}

/** Enregistre le nom de l'événement saisi par le client (via service_role, RLS bloque l'anon). */
export async function setEventName({ code, name }) {
  const res = await fetch(`${FUNCTIONS_URL}/set-event-name`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body:    JSON.stringify({ code, name }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, "Erreur lors de l'enregistrement du nom");
  return data; // { name }
}

// ── Assistance client (page /aide) ───────────────────────────────────────────

/** Contenu de la page d'aide : cas publiés (FAQ) + contact du loueur (par code, optionnel). */
export async function getSupportContent(code) {
  const articlesPromise = supabase
    .from('support_articles')
    .select('id, category, title, solution, image_url, severity, sort_order')
    .eq('is_published', true)
    .order('sort_order', { ascending: true });

  const contactPromise = code
    ? supabase.rpc('get_org_contact_by_code', { p_code: code })
    : Promise.resolve({ data: null });

  const [{ data: articles, error }, { data: contact }] = await Promise.all([
    articlesPromise,
    contactPromise,
  ]);
  if (error) throw error;
  return { articles: articles ?? [], contact: contact ?? null };
}

/** Chat IA de dépannage (closed-book). messages = [{ role, content }]. */
export async function assistantChat({ code, messages }) {
  const res = await fetch(`${FUNCTIONS_URL}/assistant-chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body:    JSON.stringify({ code, messages }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur assistant');
  return data; // { reply, escalate: { needed, urgency } }
}

/** Escalade : enregistre un message pour le loueur et le notifie. */
export async function submitSupportMessage({ code, name, phone, message, urgency, transcript }) {
  const res = await fetch(`${FUNCTIONS_URL}/submit-support-message`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body:    JSON.stringify({ code, name, phone, message, urgency, transcript }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Envoi du message échoué');
  return data; // { ok: true }
}

// ── Templates (admin) ────────────────────────────────────────────────────────

export async function fetchAllTags() {
  const { data } = await supabase.from('templates').select('tags');
  return [...new Set((data ?? []).flatMap((t) => t.tags ?? []))].sort();
}

// Cache module-level pour les métadonnées (sans canvas_json)
let _templatesMeta = null;
let _templatesMetaPromise = null;
const _templateByIdCache = {};

/** Fetch léger (sans canvas_json) + cache en mémoire pour la sidebar. */
export async function fetchDbTemplatesMeta() {
  if (_templatesMeta) return _templatesMeta;
  if (_templatesMetaPromise) return _templatesMetaPromise;
  _templatesMetaPromise = supabase
    .from('templates')
    .select('id, name, format_id, preview_url, tags, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .then(({ data, error }) => {
      _templatesMetaPromise = null;
      if (error) throw error;
      _templatesMeta = data ?? [];
      return _templatesMeta;
    });
  return _templatesMetaPromise;
}

/** Fetch un template complet (avec canvas_json) par ID, avec cache. */
export async function fetchDbTemplateById(id) {
  if (_templateByIdCache[id]) return _templateByIdCache[id];
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, format_id, canvas_json, preview_url, tags')
    .eq('id', id)
    .single();
  if (error) throw error;
  _templateByIdCache[id] = data;
  return data;
}

/** Invalide le cache (à appeler après save/delete en admin). */
export function invalidateTemplatesCache() {
  _templatesMeta = null;
  _templatesMetaPromise = null;
  Object.keys(_templateByIdCache).forEach((k) => delete _templateByIdCache[k]);
}

export async function fetchDbTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveDbTemplate({ name, format_id, canvas_json, preview_url, tags = [], is_active = true }) {
  const { data, error } = await supabase
    .from('templates')
    .insert({ name, format_id, canvas_json, preview_url, tags, is_active })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadTemplateBackground(path, blob) {
  const { data, error } = await supabase.storage
    .from('template-backgrounds')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage
    .from('template-backgrounds')
    .getPublicUrl(data.path);
  return publicUrl;
}

export async function activateTemplate(id) {
  const { error } = await supabase.from('templates').update({ is_active: true }).eq('id', id);
  if (error) throw error;
}

export async function fetchDraftTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('is_active', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteDbTemplate(id) {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

export async function updateDbTemplate(id, updates) {
  const { data, error } = await supabase
    .from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Formulaire pré-édition ───────────────────────────────────────────────────

/** Vérifie si le formulaire pré-édition est activé pour un code d'accès. */
export async function getEventFormEnabled(code) {
  const { data, error } = await supabase.rpc('get_event_form_enabled', { p_code: code });
  if (error) return false;
  return data === true;
}

/** Config globale des questions (lisible par anon via RPC). */
export async function getGlobalFormConfig() {
  const { data, error } = await supabase.rpc('get_global_form_config');
  if (error) return null;
  return data; // { enabled, questions } ou null
}

/** Sauvegarde la config globale dans organizations (admin). */
export async function updateGlobalFormConfig(orgId, formConfig) {
  const { error } = await supabase
    .from('organizations')
    .update({ form_config: formConfig })
    .eq('id', orgId);
  if (error) throw error;
}

/** Récupère la config zones perdues (anon — retourne {} si bloqué par RLS). */
export async function getFormatBleed() {
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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { orgId: null, features: {} };
  const { data, error } = await supabase
    .from('organizations')
    .select('id, features')
    .eq('owner_id', session.user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return { orgId: data?.id ?? null, features: data?.features ?? {} };
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
export async function testServiceKey(name) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/test-service-key`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ name }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Test de la clé impossible');
  return data;
}

/** Réglages non secrets (organizations.service_settings) de l'org du propriétaire connecté. */
export async function getServiceSettings() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { orgId: null, settings: {} };
  const { data, error } = await supabase
    .from('organizations')
    .select('id, service_settings')
    .eq('owner_id', session.user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return { orgId: data?.id ?? null, settings: data?.service_settings ?? {} };
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

/** Active/désactive le formulaire pour un événement spécifique. */
export async function updateEventFormConfig(eventId, formConfig) {
  const { data, error } = await supabase
    .from('events')
    .update({ form_config: formConfig })
    .eq('id', eventId)
    .select('id, form_config')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Envoie les réponses du formulaire client par la RPC submit_form_response (LAB-277) : plus
 * d'INSERT direct. Code inconnu ou événement inactif : la RPC renvoie false, erreur claire.
 * Trop d'envois depuis la même adresse (PT429) : message dédié (formSubmitErrorMessage).
 */
export async function submitFormResponse({ code, answers }) {
  const { data, error } = await supabase.rpc('submit_form_response', { p_code: code, p_answers: answers });
  if (error) throw new Error(formSubmitErrorMessage(error));
  if (data !== true) throw new Error(FORM_UNKNOWN_EVENT_MESSAGE);
}

/**
 * Approuve ou rejette un design soumis (admin uniquement). Refus Brevo (502) : l'erreur porte
 * `reviewed: true`, la décision est enregistrée mais le client n'a pas reçu l'email.
 */
export async function reviewDesign({ designId, action, feedback }) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/review-design`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ design_id: designId, action, feedback }),
  });
  const data = await readJson(res);
  if (!res.ok) throw Object.assign(functionError(res, data, 'Erreur lors de la revue'), { reviewed: data.reviewed === true });
  return data;
}

/**
 * Supprime l'arrière-plan d'une image. Renvoie un data URI PNG transparent.
 * Auth : code d'accès événement (client) OU session admin si pas de code.
 */
export async function removeImageBackground(image, code = null) {
  const headers = { 'Content-Type': 'application/json', apikey: supabaseAnon };
  if (!code) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session expirée — reconnectez-vous');
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${FUNCTIONS_URL}/remove-background`, {
    method:  'POST',
    headers,
    body: JSON.stringify({ image, code }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur lors de la suppression du fond');
  return data.url;
}

/** Réponses du client à un événement, sans les consentements photo de la borne (LAB-217). */
export async function getFormResponses(eventId) {
  const { data, error } = await supabase
    .from('event_form_responses')
    .select('*')
    .eq('event_id', eventId)
    .or(NOT_KIOSK_CONSENT_FILTER)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return withoutKioskConsents(data);
}

/** Toutes les réponses du formulaire, tous événements confondus (admin — stats globales), sans les consentements de la borne. */
export async function getAllFormResponses() {
  const { data, error } = await supabase
    .from('event_form_responses')
    .select('id, event_id, answers, submitted_at, events(name)')
    .or(NOT_KIOSK_CONSENT_FILTER)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return withoutKioskConsents(data);
}

/** Renvoie l'email de code d'accès au client (admin uniquement). */
export async function resendAccessEmail(eventId) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/resend-access-email`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ event_id: eventId }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur lors de l\'envoi');
  return data;
}

/**
 * Resynchronise le suivi d'un email (remise, ouvertures, clics, rebonds) depuis Brevo (admin
 * uniquement). Retourne { email_log, events } : la ligne email_logs à jour. Les erreurs portent
 * `status` (422 sans message-id Brevo, 403 accès refusé, 429 quota de 20 / 10 min).
 */
export async function syncEmailLog(emailLogId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Object.assign(new Error('Session expirée — reconnectez-vous'), { status: 401 });
  const res = await fetch(`${FUNCTIONS_URL}/email-sync`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email_log_id: emailLogId }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur lors de la synchronisation du suivi');
  return data;
}

// ── Suivi des emails (LAB-124) ───────────────────────────────────────────────
// Lecture sous RLS (session admin) : aucun filtre d'organisation côté client, la policy de
// email_logs décide des lignes visibles.

// Jointures sur leads et prospects seulement si leur module privé est dans le build (LAB-274).
export { EMAIL_LOG_COLUMNS };
const EMAIL_LOG_SELECT = emailLogSelect(INSTALLED_MODULES);

/**
 * Page Emails : une page de email_logs (plus récents d'abord) filtrée côté serveur.
 * filters = { status, type, from, to, search, problemsOnly, page }. Retourne { rows, count }.
 */
export async function fetchEmailLogs(filters = {}) {
  const plan = emailLogQueryPlan(filters, { modules: INSTALLED_MODULES });
  if (plan.empty) return { rows: [], count: 0 };

  let refScope = null;
  if (plan.bookingRef) {
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, converted_event_id')
      .ilike('booking_number', `%${escapeLike(plan.bookingRef)}%`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (leadsErr) throw leadsErr;
    refScope = bookingRefScope(leads);
    if (!refScope.leadIds.length) return { rows: [], count: 0 };
  }

  const query = supabase.from('email_logs').select(EMAIL_LOG_SELECT, { count: 'exact' });
  const { data, count, error } = await applyEmailLogPlan(query, plan, refScope);
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

/** Un email avec son lead ou son événement. */
export async function getEmailLog(emailLogId) {
  const { data, error } = await supabase
    .from('email_logs')
    .select(EMAIL_LOG_SELECT)
    .eq('id', emailLogId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Historique Brevo d'un email (email_events), du plus ancien au plus récent. */
export async function getEmailEvents(emailLogId) {
  const { data, error } = await supabase
    .from('email_events')
    .select('id, event, occurred_at, reason, link')
    .eq('email_log_id', emailLogId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── Galerie audio ────────────────────────────────────────────────────────────

/** Recherche d'événements pour l'autocomplétion du header admin (nom / client / code).
 *  Insensible aux accents via le RPC search_events (extension unaccent). */
export async function searchEvents(query, limit = 8) {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('search_events', { search_query: q, max_results: limit });
  if (error) throw error;
  return data ?? [];
}

// ── Photos ────────────────────────────────────────────────────────────────────

export async function fetchEventsWithPhotoCount() {
  // Count agrégé côté serveur (embed PostgREST) — évite de télécharger toutes les photos pour compter.
  const { data, error } = await supabase
    .from('events')
    .select('id, name, client_name, access_code, created_at, photos(count)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(e => ({ ...e, photo_count: e.photos?.[0]?.count ?? 0 }));
}

export async function fetchPhotos(eventId) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Événement public par code d'accès via la RPC get_public_event (LAB-112 : anon n'a plus de
 * SELECT sur `events`). Renvoie { event: { id, name }, companyName, gallery, bookingBanner, eventType } ou null.
 */
export async function getPublicEvent(code) {
  const { data, error } = await supabase.rpc(PUBLIC_EVENT_RPC, { p_code: code });
  if (error) throw error;
  return parsePublicEvent(data);
}

/** Nom de l'entreprise associée à un code d'accès (utilisé dans les galeries publiques). */
export async function fetchCompanyByCode(code) {
  const pub = await getPublicEvent(code).catch(() => null);
  return pub?.companyName ?? '';
}

/**
 * Map { photoId -> download_url presigned } via la fonction get-photos. Repli silencieux si indispo.
 * `link` ({ via, photo } d'un QR code de la borne) : get-photos compte l'ouverture (LAB-232).
 */
async function fetchPhotoDownloadUrls(code, link) {
  try {
    const res = await fetch(getPhotosUrl(FUNCTIONS_URL, code, link), {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${supabaseAnon}` },
    });
    if (!res.ok) return {};
    const { photos } = await res.json();
    return Object.fromEntries((photos ?? []).filter((p) => p.download_url).map((p) => [p.id, p.download_url]));
  } catch {
    return {};
  }
}

/**
 * Photos approuvées d'un événement actif, par code d'accès, via la RPC get_public_photos
 * (LAB-114 : anon n'a plus de SELECT sur `photos`).
 */
export async function fetchPublicPhotos(code) {
  const { data, error } = await supabase.rpc(PUBLIC_PHOTOS_RPC, { p_code: code });
  if (error) throw error;
  return parsePublicPhotos(data);
}

/**
 * Récupère l'événement et ses photos depuis un code d'accès public (galerie client, diaporama).
 * `link` ({ via, photo }) : seulement au premier chargement de la galerie ouverte par QR code.
 */
export async function fetchPhotosByAccessCode(code, link = {}) {
  const pub = await getPublicEvent(code).catch(() => null);
  if (!pub) throw new Error('Événement introuvable');
  const { event, companyName, bookingBanner, eventType } = pub;

  // download_url (presigned GET, téléchargement forcé) généré par la fonction get-photos.
  // La RPC ne contient pas ce champ — repli sur photo_url si indispo.
  const [photos, downloadUrls] = await Promise.all([fetchPublicPhotos(code), fetchPhotoDownloadUrls(code, link)]);

  return { event, photos: withDownloadUrls(photos, downloadUrls), companyName, bookingBanner, eventType };
}

/** Config galerie (form_config.gallery) d'un événement, lue depuis un code d'accès public. */
export async function getGalleryConfig(code) {
  const pub = await getPublicEvent(code).catch(() => null);
  return pub?.gallery ?? {};
}

export async function getPhotoUploadUrl({ event_id, filename, content_type }) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/get-photo-upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnon,
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ event_id, filename, content_type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erreur URL upload');
  return data;
}

export async function savePhoto({ event_id, photo_url, storage_path, thumbnail_url, width, height }) {
  const { data, error } = await supabase
    .from('photos')
    .insert({
      event_id, photo_url, storage_path, thumbnail_url: thumbnail_url ?? null, width: width ?? null, height: height ?? null,
      source: 'admin', media_type: isVideoUrl(storage_path ?? photo_url) ? 'video' : 'photo',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Presigned PUT R2 pour un invité (sans session admin). L'autorisation repose sur le
 * code d'accès de l'événement : header apikey anon uniquement, jamais de token admin.
 */
export async function getGuestUploadUrl(code, { filename, content_type, content_length }) {
  const res = await fetch(`${FUNCTIONS_URL}/get-guest-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body: JSON.stringify({ access_code: code, filename, content_type, content_length }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur URL upload');
  return data; // { presigned_url, public_url, storage_path }
}

/**
 * Enregistre une photo uploadée par un invité via l'Edge Function record-guest-photo.
 * Le serveur force source='guest' et décide status selon la modération de l'événement :
 * ni source ni status ne sont acceptés depuis le client (cf. LAB-22).
 */
export async function recordGuestPhoto(code, { photo_url, storage_path, thumbnail_url, width, height, uploader_name }) {
  const res = await fetch(`${FUNCTIONS_URL}/record-guest-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body: JSON.stringify({ access_code: code, photo_url, storage_path, thumbnail_url, width, height, uploader_name }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur enregistrement photo');
  return data; // { id, status }
}

// LAB-232 : l'admin connecté propriétaire de l'événement n'est pas compté. La RLS events_owner_all
// ne lui montre que ses événements : une ligne trouvée par code = propriétaire.
const isGalleryOwner = createGalleryOwnerCheck({
  getUserId: async () => (await supabase.auth.getSession()).data.session?.user?.id ?? null,
  ownsEventByCode: async (code) => {
    const { data, error } = await supabase.from('events').select('id').eq('access_code', code.toUpperCase().trim()).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  },
});

/**
 * Enregistre un évènement d'usage de la galerie (ouverture, téléchargement, partage) par la RPC
 * track_gallery_event (code d'accès vérifié côté serveur, LAB-227). Fire-and-forget : un refus
 * n'empêche jamais d'utiliser la galerie. Rien n'est compté pour l'admin propriétaire (LAB-232).
 */
export function trackGalleryEvent(code, type, count = 1) {
  if (!code) return;
  isGalleryOwner(code).then((owner) => {
    if (owner) return;
    supabase.rpc('track_gallery_event', { p_code: code, p_type: type, p_count: count }).then(() => {}, () => {});
  });
}

/** Statistiques agrégées d'usage de la galerie pour un événement (lecture admin). */
export async function fetchGalleryStats(eventId) {
  const { data, error } = await supabase
    .from('gallery_analytics')
    .select('type, count, created_at')
    .eq('event_id', eventId);
  if (error) throw error;
  const stats = { views: 0, downloads: 0, shares: 0, lastActivity: null };
  for (const row of (data ?? [])) {
    if (row.type === 'view') stats.views += 1;
    else if (row.type === 'share') stats.shares += row.count;
    else stats.downloads += row.count; // download | download_all | download_selection
    if (!stats.lastActivity || row.created_at > stats.lastActivity) stats.lastActivity = row.created_at;
  }
  return stats;
}

export async function deletePhoto(photoId) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/delete-photo`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnon,
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ photo_id: photoId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erreur suppression');
  return data;
}

export async function updateEventAlbumName(eventId, albumName) {
  const { error } = await supabase.from('events').update({ album_name: albumName }).eq('id', eventId);
  if (error) throw error;
}

/**
 * Fusionne un patch dans form_config.gallery sans écraser le reste de form_config.
 * Même mécanisme que les toggles audio/photos : on relit le form_config courant,
 * on applique le patch sur la sous-clé `gallery`, puis on réécrit via updateEventFormConfig.
 */
export async function updateGalleryConfig(eventId, patch) {
  const { data, error } = await supabase
    .from('events')
    .select('form_config')
    .eq('id', eventId)
    .single();
  if (error) throw error;
  const current = data?.form_config ?? {};
  const nextConfig = { ...current, gallery: { ...(current.gallery ?? {}), ...patch } };
  const updated = await updateEventFormConfig(eventId, nextConfig);
  return updated.form_config?.gallery ?? {};
}

/** Change le statut de modération d'une photo ('approved' | 'pending' | 'rejected'). */
export async function setPhotoStatus(photoId, status) {
  const { data, error } = await supabase
    .from('photos')
    .update({ status })
    .eq('id', photoId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Change le statut de modération de plusieurs photos en une requête. */
export async function setPhotosStatus(photoIds, status) {
  if (!photoIds?.length) return [];
  const { data, error } = await supabase
    .from('photos')
    .update({ status })
    .in('id', photoIds)
    .select();
  if (error) throw error;
  return data ?? [];
}

// ── Décorations / Stickers ────────────────────────────────────────────────────

let _decorations = null;
let _decorationsPromise = null;

export async function fetchDecorations() {
  if (_decorations) return _decorations;
  if (_decorationsPromise) return _decorationsPromise;
  _decorationsPromise = supabase
    .from('decorations')
    .select('id, name, url, category, thumbnail_url, storage_path')
    .order('created_at', { ascending: false })
    .then(({ data, error }) => {
      _decorationsPromise = null;
      if (error) throw error;
      _decorations = data ?? [];
      return _decorations;
    });
  return _decorationsPromise;
}

export function invalidateDecorationsCache() {
  _decorations = null;
  _decorationsPromise = null;
}

export async function uploadDecoration(file, category = 'Mes stickers', name = '', thumbnailBlob = null) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType = ext === 'svg' ? 'image/svg+xml' : file.type;

  const { data: stored, error: storageErr } = await supabase.storage
    .from('decorations')
    .upload(path, file, { contentType, upsert: false });
  if (storageErr) throw storageErr;

  const { data: { publicUrl } } = supabase.storage
    .from('decorations')
    .getPublicUrl(stored.path);

  const label = name.trim() || file.name.replace(/\.[^.]+$/, '');

  // Upload thumbnail si fourni
  let thumbnailUrl = null;
  if (thumbnailBlob) {
    const thumbPath = `thumbnails/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const { data: thumbStored, error: thumbErr } = await supabase.storage
      .from('decorations')
      .upload(thumbPath, thumbnailBlob, { contentType: 'image/png', upsert: false });
    if (!thumbErr) {
      const { data: { publicUrl: tUrl } } = supabase.storage
        .from('decorations')
        .getPublicUrl(thumbStored.path);
      thumbnailUrl = tUrl;
    }
  }

  const { data: record, error: dbErr } = await supabase
    .from('decorations')
    .insert({ name: label, url: publicUrl, storage_path: stored.path, category, thumbnail_url: thumbnailUrl })
    .select()
    .single();
  if (dbErr) throw dbErr;
  invalidateDecorationsCache();
  return record;
}

export async function deleteDecoration(id, storagePath) {
  await supabase.storage.from('decorations').remove([storagePath]);
  const { error } = await supabase.from('decorations').delete().eq('id', id);
  if (error) throw error;
  invalidateDecorationsCache();
}

// ── Polices personnalisées ────────────────────────────────────────────────────

let _customFonts = null;
let _customFontsPromise = null;

export async function fetchCustomFonts() {
  if (_customFonts) return _customFonts;
  if (_customFontsPromise) return _customFontsPromise;
  _customFontsPromise = supabase
    .from('custom_fonts')
    .select('id, name, url, storage_path, created_at')
    .order('created_at', { ascending: true })
    .then(({ data, error }) => {
      _customFontsPromise = null;
      if (error) throw error;
      _customFonts = data ?? [];
      return _customFonts;
    });
  return _customFontsPromise;
}

export function invalidateCustomFontsCache() {
  _customFonts = null;
  _customFontsPromise = null;
}

export async function preloadCustomFonts() {
  const fonts = await fetchCustomFonts();
  await Promise.allSettled(fonts.map(async (font) => {
    if ([...document.fonts].some((f) => f.family === font.name)) return;
    try {
      const ff = new FontFace(font.name, `url(${font.url})`);
      await ff.load();
      document.fonts.add(ff);
    } catch (_) {}
  }));
}

export async function uploadCustomFont(file, name) {
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType =
    ext === 'woff2' ? 'font/woff2' :
    ext === 'woff'  ? 'font/woff'  :
    ext === 'ttf'   ? 'font/ttf'   :
    ext === 'otf'   ? 'font/otf'   : 'application/octet-stream';

  const { data: stored, error: storageErr } = await supabase.storage
    .from('fonts')
    .upload(path, file, { contentType, upsert: false });
  if (storageErr) throw storageErr;

  const { data: { publicUrl } } = supabase.storage.from('fonts').getPublicUrl(stored.path);

  const { data: record, error: dbErr } = await supabase
    .from('custom_fonts')
    .insert({ name: name.trim(), url: publicUrl, storage_path: stored.path })
    .select()
    .single();
  if (dbErr) throw dbErr;

  invalidateCustomFontsCache();
  return record;
}

export async function deleteCustomFont(id, storagePath) {
  await supabase.storage.from('fonts').remove([storagePath]);
  const { error } = await supabase.from('custom_fonts').delete().eq('id', id);
  if (error) throw error;
  invalidateCustomFontsCache();
}

// ── Historique des versions ───────────────────────────────────────────────────

// LAB-115 : la table design_versions n'est plus accessible avec la clé anon. Client comme admin
// connecté passent par l'edge function design-versions, qui exige le code d'accès de l'éditeur.
async function callDesignVersionFunction(payload) {
  const res = await fetch(`${FUNCTIONS_URL}/design-versions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body:    JSON.stringify(payload),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur historique des versions');
  return data;
}

/** Sauvegarde une version nommée du design (appel manuel). */
export async function saveDesignVersion({ code, canvasJson, format, label }) {
  const data = await callDesignVersionFunction({
    code, action: 'save', canvas_json: canvasJson, format, label: label?.trim() || null,
  });
  return data.version;
}

/** Liste les 20 dernières versions de l'événement du code. */
export async function listDesignVersions(code) {
  const data = await callDesignVersionFunction({ code, action: 'list' });
  return data?.versions ?? [];
}

/** Récupère une version complète (avec canvas_json), si elle appartient à l'événement du code. */
export async function getDesignVersion(code, versionId) {
  const data = await callDesignVersionFunction({ code, action: 'get', version_id: versionId });
  return data.version;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Soumission finale du design (PNG base64 + JSON). */
export async function submitDesign({ code, canvasJson, format, pngBase64 }) {
  const res = await fetch(`${FUNCTIONS_URL}/submit-design`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnon },
    body:    JSON.stringify({
      code,
      canvas_json: canvasJson,
      format,
      png_base64:  pngBase64,
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur lors de la soumission');
  return data; // { design_id, message }
}

// ── Config kiosk ──────────────────────────────────────────────────────────────

export async function saveKioskConfig(eventId, kioskConfig) {
  const { data: ev, error: fetchErr } = await supabase
    .from('events').select('form_config').eq('id', eventId).single();
  if (fetchErr) throw fetchErr;

  const updated = { ...(ev.form_config ?? {}), kiosk: kioskConfig };
  const { error } = await supabase
    .from('events').update({ form_config: updated }).eq('id', eventId);
  if (error) throw error;
  return updated;
}

// Envoi d'une image PNG ou JPEG dans kiosk-backgrounds (LAB-282) : fichier vérifié avant l'envoi,
// erreurs de Storage (droits, type, taille) traduites en message clair.
async function uploadKioskBucketImage(file, pathFor) {
  const problem = kioskBackgroundProblem(file);
  if (problem) throw new Error(problem);
  const ext  = kioskBackgroundExtension(file);
  const path = pathFor(ext);
  const bucket = supabase.storage.from('kiosk-backgrounds');
  const { error } = await bucket.upload(path, file, {
    upsert: true, contentType: kioskBackgroundContentType(ext),
  });
  if (error) throw new Error(kioskStorageErrorMessage(error));
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Fond d'accueil d'un événement : {event_id}/background.png|jpg (propriétaire de l'organisation). */
export async function uploadKioskBackground(eventId, file) {
  return uploadKioskBucketImage(file, (ext) => eventBackgroundPath(eventId, ext));
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

/** Fond de l'écran de saisie du code, commun à toutes les bornes (admin plateforme seulement). */
export async function uploadKioskGlobalSetupBackground(file) {
  return uploadKioskBucketImage(file, setupBackgroundPath);
}

export async function saveKioskSetupConfig(config) {
  const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
  const { error } = await supabase.storage
    .from('kiosk-backgrounds')
    .upload('default/setup_config.json', blob, { upsert: true, contentType: 'application/json' });
  if (error) throw new Error(kioskStorageErrorMessage(error));
}

export async function getKioskSetupConfig() {
  const { data } = supabase.storage
    .from('kiosk-backgrounds')
    .getPublicUrl('default/setup_config.json');
  try {
    const res = await fetch(data.publicUrl + '?t=' + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function duplicateEvent(eventId) {
  const { data: source, error: fetchErr } = await supabase
    .from('events').select('*').eq('id', eventId).single();
  if (fetchErr) throw fetchErr;

  // Nouveau code d'accès unique (6 caractères alphanumériques)
  const newCode = Math.random().toString(36).slice(2, 8).toUpperCase();

  const { data: created, error: insertErr } = await supabase
    .from('events')
    .insert({
      name:            `Copie — ${source.name}`,
      client_name:     null,
      client_email:    null,
      start_date:      null,
      end_date:        null,
      expires_at:      null,
      access_code:     newCode,
      status:          'active',
      // On copie uniquement la config kiosk, pas les autres options (formulaire, audio)
      form_config:     { kiosk: source.form_config?.kiosk ?? null },
    })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return created;
}

// ── Licences kiosk ───────────────────────────────────────────────────────────

// Colonnes de kiosk_licenses lisibles par authenticated (droits par colonne, LAB-242) :
// select('*') est refusé, la colonne secret n'est plus lisible.
const LICENSE_COLUMNS = [
  'id', 'machine_id', 'machine_name', 'label', 'color', 'org_id', 'is_active', 'retired_at',
  'activated_at', 'last_seen_at', 'created_at', 'app_version',
  'printer_status', 'printer_name', 'printer_status_at', 'paper_capacity', 'paper_reset_at',
  'admin_pin_set_at', 'admin_pin_pushed_at', 'admin_pin_received_at',
  'update_requested_version', 'update_requested_at', 'update_received_at', 'update_failed_at', 'update_error',
  'pending_uploads', 'pending_uploads_at', 'camera_status', 'camera_status_at',
  'event_push_id', 'event_push_requested_at', 'event_push_received_at', 'event_push_applied_at', 'event_push_error',
].join(', ');

/**
 * Bornes visibles (RLS : celles du compte, toutes pour le super-admin).
 * Par défaut sans les bornes retirées (listes de choix : planning, événement).
 */
export async function fetchLicenses({ includeRetired = false } = {}) {
  let q = supabase
    .from('kiosk_licenses')
    .select(LICENSE_COLUMNS)
    .order('created_at', { ascending: false });
  if (!includeRetired) q = q.is('retired_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── Association des bornes (LAB-243) ──────────────────────────────────────────
// Refus fonctionnels dans le JSON (champ status), exceptions pour les droits et la limite
// d'essais (PT429) : messages dans lib/kioskPairing.js.

/** État d'un code affiché par une borne (kiosk_pairing_lookup). Un code inconnu compte comme essai faux. */
export async function lookupPairing(code) {
  const { data, error } = await supabase.rpc('kiosk_pairing_lookup', { p_code: code });
  if (error) throw error;
  return data;
}

/**
 * Associe la borne qui affiche ce code. Retourne { status: 'ok', mode, license_id, label, org_id,
 * org_name } ou un refus { status, … }. orgId : super-admin seulement (sinon son propre compte).
 */
export async function approvePairing({ code, label, replaceLicenseId = null, orgId = null }) {
  const { data, error } = await supabase.rpc('kiosk_pairing_approve', {
    p_code:               code,
    p_label:              label,
    p_replace_license_id: replaceLicenseId,
    p_org_id:             orgId,
  });
  if (error) throw error;
  return data;
}

/** Retire une borne : secret effacé, hors des listes de choix et de la limite, réassociable. */
export async function retireLicense(licenseId) {
  const { data, error } = await supabase.rpc('kiosk_retire_license', { p_license_id: licenseId });
  if (error) throw error;
  return data;
}

/**
 * Comptes visibles pour le parc kiosk : id, nom, limite de bornes (vide = illimité).
 * RLS organizations : chacun ne lit que son compte. ownOrgId = compte de l'utilisateur connecté.
 */
export async function fetchKioskAccounts() {
  const { data: { session } } = await supabase.auth.getSession();
  // RPC : le super-admin voit tous les comptes, les autres leurs seuls comptes (pas de policy
  // super-admin sur organizations, lue ailleurs comme « mon compte »).
  const { data, error } = await supabase.rpc('kiosk_list_accounts');
  if (error) throw error;
  const accounts = data ?? [];
  const own = accounts.find((o) => o.owner_id === session?.user?.id) ?? null;
  return { accounts, ownOrgId: own?.id ?? null };
}

/** Limite de bornes d'un compte (null = illimité). Super-admin seulement (RPC kiosk_set_org_limit). */
export async function updateOrgKioskLimit(orgId, limit) {
  const { error } = await supabase.rpc('kiosk_set_org_limit', { p_org_id: orgId, p_limit: limit });
  if (error) throw error;
}

// ── Versions kiosk (déploiement) ──────────────────────────────────────────────

export async function fetchKioskReleases() {
  const { data, error } = await supabase
    .from('kiosk_releases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Empreinte SHA-256 (hex minuscule) d'un fichier, calculée dans le navigateur. */
export async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT d'un fichier sur une URL présignée du stockage (R2 / S3), avec progression en %. */
function putToStorage(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Envoi de l'installeur refusé par le stockage (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Envoi de l'installeur interrompu (réseau, ou CORS du bucket)."));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(file);
  });
}

/**
 * LAB-269 : l'installeur part sur le stockage des médias (R2 / S3) par URL présignée
 * (get-release-upload-url, administrateurs de l'application) : Supabase Storage limite les
 * fichiers à 50 Mo sur l'offre gratuite. `onProgress(pourcentage)` suit l'envoi.
 */
export async function uploadKioskRelease({ version, notes, file, onProgress }) {
  const v = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('Version invalide (format attendu : 1.2.3).');

  // Hash calculé avant l'upload : le kiosk refuse un installeur dont l'empreinte diffère.
  const sha256 = await sha256Hex(file);

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/get-release-upload-url`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ version: v, content_length: file.size }),
  });
  const upload = await readJson(res);
  if (!res.ok) throw functionError(res, upload, "Impossible de préparer l'envoi de l'installeur.");

  await putToStorage(upload.presigned_url, file, upload.content_type, onProgress);

  const { data, error } = await supabase
    .from('kiosk_releases')
    .upsert({ version: v, exe_url: upload.public_url, notes: notes ?? null, sha256 }, { onConflict: 'version' })
    .select().single();
  if (error) throw error;
  return data;
}

/**
 * LAB-200 : demande à une borne d'installer cette version (seule façon de la mettre à jour).
 * Nouvelle demande = réception et échec précédents effacés. Retourne les colonnes update_* à jour.
 */
export async function requestKioskUpdate(licenseId, version) {
  const { data, error } = await supabase.rpc('kiosk_request_update', {
    p_license_id: licenseId,
    p_version: version,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ── Envoi d'un événement sur la borne (LAB-245) ───────────────────────────────

/**
 * Demande à la borne de charger cet événement (propriétaire de la borne ET de l'événement, ou
 * super-admin ; même compte). Un nouvel envoi remplace le précédent. Retourne les colonnes
 * event_push_* à jour.
 */
export async function requestEventOnKiosk(licenseId, eventId) {
  const { data, error } = await supabase.rpc('kiosk_request_event', {
    p_license_id: licenseId,
    p_event_id: eventId,
  });
  if (error) throw error;
  return data;
}

/** Annule l'envoi tant que la borne n'a pas affiché l'événement. Retourne les colonnes effacées. */
export async function cancelEventRequest(licenseId) {
  const { data, error } = await supabase.rpc('kiosk_cancel_event_request', { p_license_id: licenseId });
  if (error) throw error;
  return data;
}

/** Événements qu'on peut envoyer sur une borne (RLS : ceux du compte, tous pour le super-admin). */
export async function fetchPushableEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('id, org_id, name, status, start_date, photobooth_id')
    .in('status', ['active', 'submitted'])
    .order('start_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteKioskRelease(releaseId) {
  const { error } = await supabase.from('kiosk_releases').delete().eq('id', releaseId);
  if (error) throw error;
}

async function callKioskAdminPin(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/kiosk-admin-pin`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, "Erreur lors de l'enregistrement du PIN");
  return data;
}

/** Définit le PIN admin d'une borne (haché côté serveur). Retourne les dates de statut du PIN. */
export function setKioskAdminPin(licenseId, pin) {
  return callKioskAdminPin({ action: 'set', license_id: licenseId, pin });
}

/** Envoie le PIN défini à la borne, qui le récupère à sa prochaine connexion. */
export function pushKioskAdminPin(licenseId) {
  return callKioskAdminPin({ action: 'push', license_id: licenseId });
}

export async function updateLicense(id, updates) {
  const { error } = await supabase
    .from('kiosk_licenses')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteLicense(id) {
  const { error } = await supabase
    .from('kiosk_licenses')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function updateLicenseColor(id, color) {
  const { error } = await supabase.from('kiosk_licenses').update({ color }).eq('id', id);
  if (error) throw error;
}

/**
 * Tirages consommés par machine depuis le dernier rechargement de rouleau.
 * @param {{machine_id: string|null, paper_reset_at: string|null}[]} machines
 * @returns {Promise<Record<string, number>>} machine_id → nb de copies imprimées
 * Une borne retirée qui a cédé son PC n'a plus de machine_id : ignorée.
 */
export async function getPaperUsage(machines) {
  const entries = await Promise.all(
    machines.filter((m) => m.machine_id).map(async (m) => {
      let q = supabase.from('print_logs').select('copies').eq('machine_id', m.machine_id);
      if (m.paper_reset_at) q = q.gte('printed_at', m.paper_reset_at);
      const { data } = await q;
      const used = (data ?? []).reduce((s, p) => s + (p.copies ?? 0), 0);
      return [m.machine_id, used];
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Logs d'erreurs remontés par les kiosks.
 * @param {string|null} machineId - filtre optionnel par machine
 * @param {number} limit - nombre de logs à récupérer (défaut 200)
 */
export async function fetchKioskLogs({ machineId = null, level = null, limit = 200 } = {}) {
  let q = supabase
    .from('kiosk_logs')
    .select('id, machine_id, level, context, message, stack_trace, app_version, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (machineId) q = q.eq('machine_id', machineId);
  if (level)     q = q.eq('level', level);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function deleteKioskLog(id) {
  const { error } = await supabase.from('kiosk_logs').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteKioskLogsByMachine(machineId) {
  const { error } = await supabase.from('kiosk_logs').delete().eq('machine_id', machineId);
  if (error) throw error;
}

/**
 * Données de monitoring temps réel des bornes visibles, retirées comprises (la page les range à part).
 * Retourne les licences enrichies avec l'event actif et la dernière photo.
 */
export async function fetchKioskMonitoring() {
  const [{ data: licenses, error: licErr }, { data: events, error: evErr }, { data: photos }] =
    await Promise.all([
      supabase.from('kiosk_licenses').select(LICENSE_COLUMNS).order('created_at', { ascending: false }),
      supabase.from('events').select('id, name, start_date, end_date, status, photobooth_id')
        .not('photobooth_id', 'is', null),
      supabase.from('photos').select('id, event_id, created_at, thumbnail_url, photo_url')
        .eq('source', 'kiosk')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

  if (licErr) throw licErr;
  if (evErr)  throw evErr;

  // Map event_id → latest photo
  const latestPhotoByEvent = {};
  for (const p of (photos ?? [])) {
    if (!latestPhotoByEvent[p.event_id]) latestPhotoByEvent[p.event_id] = p;
  }

  // Enrich each license
  return (licenses ?? []).map((lic) => {
    const linkedEvents = (events ?? []).filter((e) => e.photobooth_id === lic.id);
    const now = new Date();
    const activeEvent = linkedEvents.find((e) => {
      const start = e.start_date ? new Date(e.start_date) : null;
      const end   = e.end_date   ? new Date(e.end_date)   : null;
      return e.status !== 'archived' && (!start || start <= now) && (!end || end >= now);
    }) ?? linkedEvents[0] ?? null;

    const lastPhoto = activeEvent ? latestPhotoByEvent[activeEvent.id] ?? null : null;

    return { ...lic, activeEvent, lastPhoto };
  });
}

// ── Planning ──────────────────────────────────────────────────────────────────

export async function getPlanningData() {
  const [eventsRes, entriesRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, client_name, start_date, end_date, photobooth_id, kiosk_licenses(id, label, color)')
      .not('start_date', 'is', null),
    supabase.from('planning_entries').select('*'),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (entriesRes.error) throw entriesRes.error;
  return { events: eventsRes.data ?? [], entries: entriesRes.data ?? [] };
}

export async function updateEventPhotobooth(eventId, photoboothId) {
  const { error } = await supabase
    .from('events')
    .update({ photobooth_id: photoboothId ?? null })
    .eq('id', eventId);
  if (error) throw error;
  syncEventToGoogleCalendar(eventId);
}

export async function createPlanningEntry({ title, startAt, endAt, color, notes, googleEventId, googleCalendarId }) {
  const { data, error } = await supabase
    .from('planning_entries')
    .insert({
      title,
      start_at: startAt,
      end_at: endAt,
      color,
      notes: notes || null,
      google_event_id: googleEventId ?? null,
      google_calendar_id: googleCalendarId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePlanningEntry(id, { title, startAt, endAt, color, notes, googleEventId, googleCalendarId }) {
  const patch = { title, start_at: startAt, end_at: endAt, color, notes: notes || null };
  if (googleEventId !== undefined) {
    patch.google_event_id    = googleEventId;
    patch.google_calendar_id = googleCalendarId ?? null;
  }
  const { error } = await supabase
    .from('planning_entries')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deletePlanningEntry(id) {
  const { error } = await supabase.from('planning_entries').delete().eq('id', id);
  if (error) throw error;
}

// ── Historique impressions kiosk ─────────────────────────────────────────────

export async function getDashboardStats() {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayIso   = now.toISOString();
  const in7Days    = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: activeEvents },
    { count: photosCount },
    { data: printRows },
    { data: pendingDesigns },
    { data: upcomingEvents },
    { data: recentPhotos },
    { data: recentPrints },
  ] = await Promise.all([
    supabase.from('events').select('id, name, client_name, start_date, end_date, status, photobooth_id').eq('status', 'active').order('start_date', { ascending: true }),
    supabase.from('photos').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabase.from('print_logs').select('copies').gte('printed_at', monthStart),
    supabase.from('client_designs').select('id, event_id, submitted_at').eq('status', 'submitted').order('submitted_at', { ascending: false }),
    supabase.from('events').select('id, name, client_name, start_date, end_date, photobooth_id, status').neq('status', 'archived').gte('end_date', todayIso).lte('start_date', in7Days).order('start_date', { ascending: true }).limit(10),
    supabase.from('photos').select('id, photo_url, thumbnail_url, created_at, event_id').order('created_at', { ascending: false }).limit(6),
    supabase.from('print_logs').select('id, copies, printed_at, machine_id, event_id').order('printed_at', { ascending: false }).limit(5),
  ]);

  const printsThisMonth = (printRows ?? []).reduce((s, r) => s + (r.copies ?? 0), 0);

  // Jointure JS : enrichit pendingDesigns + recentPrints avec le nom de l'événement.
  // On réutilise les events déjà chargés (actifs + agenda) et on ne requête que les IDs manquants.
  const eventsMap = Object.fromEntries(
    [...(activeEvents ?? []), ...(upcomingEvents ?? [])].map(e => [e.id, e])
  );
  const referencedIds = [...(pendingDesigns ?? []), ...(recentPrints ?? [])]
    .map(r => r.event_id)
    .filter(id => id && !eventsMap[id]);
  const missingIds = [...new Set(referencedIds)];
  if (missingIds.length > 0) {
    const { data: extraEvents } = await supabase
      .from('events').select('id, name, client_name').in('id', missingIds);
    for (const e of extraEvents ?? []) eventsMap[e.id] = e;
  }
  const enriched = rows => (rows ?? []).map(r => ({ ...r, events: eventsMap[r.event_id] ?? null }));

  return {
    activeEventsCount: activeEvents?.length ?? 0,
    photosThisMonth:   photosCount ?? 0,
    printsThisMonth,
    pendingDesigns:    enriched(pendingDesigns),
    upcomingEvents:    upcomingEvents ?? [],
    activeEvents:      activeEvents ?? [],
    recentPhotos:      recentPhotos ?? [],
    recentPrints:      enriched(recentPrints),
  };
}

export async function getEmailLogs(eventId) {
  const { data, error } = await supabase
    .from('email_logs')
    .select(EMAIL_LOG_COLUMNS)
    .eq('event_id', eventId)
    .order('sent_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function getEventPrintLogs(eventId) {
  const { data, error } = await supabase
    .from('print_logs')
    .select('id, session_id, composite_url, copies, machine_id, printed_at')
    .eq('event_id', eventId)
    .order('printed_at', { ascending: false });
  if (error) throw error;
  const logs = data ?? [];
  // LAB-227 : la borne n'envoie plus composite_url ; miniature = photo kiosk de la séance, en une
  // seule requête sur les photos kiosk de l'événement. Une erreur ici n'empêche pas la liste.
  const sessions = sessionsNeedingThumbnail(logs);
  if (sessions.length === 0) return logs;
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('storage_path, photo_url, created_at')
    .eq('event_id', eventId)
    .eq('source', 'kiosk');
  if (photosError) return logs;
  return withPrintThumbnails(logs, photos ?? []);
}

/** Historique des alertes parc kiosk (ouvertes en premier via resolved_at null). */
export async function fetchKioskAlerts(limit = 20) {
  const { data, error } = await supabase
    .from('kiosk_alerts')
    .select('id, event_id, machine_id, alert_type, detail, sent_at, resolved_at, events(name)')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Stats légères pour le bandeau du détail événement : photos capturées + impressions consommées. */
export async function getEventStats(eventId) {
  const [{ count: photosCount }, { data: prints }] = await Promise.all([
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('print_logs').select('copies').eq('event_id', eventId),
  ]);
  const printCopies = (prints ?? []).reduce((s, p) => s + (p.copies ?? 0), 0);
  return { photosCount: photosCount ?? 0, printCopies };
}

// ── Réponses au questionnaire de la borne (LAB-221) ──────────────────────────
// Lecture et suppression sous RLS (propriétaire de l'organisation) ; la borne écrit par RPC.

const GUEST_RESPONSE_COLUMNS =
  'id, event_id, machine_id, session_ids, answers, questions_snapshot, email, phone, marketing_consent, consent_text, answered_at, received_at';
const SUPABASE_PAGE = 1000;

async function selectAllPages(buildQuery) {
  const all = [];
  for (let from = 0; ; from += SUPABASE_PAGE) {
    const { data, error } = await buildQuery().range(from, from + SUPABASE_PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < SUPABASE_PAGE) return all;
  }
}

/** Page de réponses, plus récentes d'abord. `search` : e-mail ou téléphone (normalisé comme la borne). */
export async function getGuestResponses(eventId, { page = 1, pageSize = 20, search = '' } = {}) {
  let query = supabase
    .from('kiosk_guest_responses')
    .select(GUEST_RESPONSE_COLUMNS, { count: 'exact' })
    .eq('event_id', eventId);
  const filter = guestSearchFilter(search);
  if (filter) query = query.ilike(filter.column, filter.pattern);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order('answered_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export function getAllGuestResponses(eventId) {
  return selectAllPages(() => supabase
    .from('kiosk_guest_responses')
    .select(GUEST_RESPONSE_COLUMNS)
    .eq('event_id', eventId)
    .order('answered_at', { ascending: true })
    .order('id', { ascending: true }));
}

/** Compteurs et date de suppression (`guest_responses_summary`), d'un événement ou de tous. */
export async function getGuestResponsesSummary(eventId = null) {
  let query = supabase.rpc('guest_responses_summary');
  if (eventId) query = query.eq('event_id', eventId);
  const { data, error } = await query;
  if (error) throw error;
  return eventId ? (data?.[0] ?? null) : (data ?? []);
}

/** Photos kiosk de l'événement, pour relier les réponses à leur séance (storage_path). */
export function getGuestResponsePhotos(eventId) {
  return selectAllPages(() => supabase
    .from('photos')
    .select('id, storage_path')
    .eq('event_id', eventId)
    .eq('source', 'kiosk')
    .order('id', { ascending: true }));
}

export async function deleteGuestResponse(id) {
  const { data, error } = await supabase.from('kiosk_guest_responses').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Réponse introuvable ou déjà supprimée');
}

export async function deleteAllGuestResponses(eventId) {
  const { data, error } = await supabase.from('kiosk_guest_responses').delete().eq('event_id', eventId).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

// ── Bilan client (LAB-233) ───────────────────────────────────────────────────
// Chiffres calculés et figés côté serveur (build_event_report) ; le gel passe par l'envoi.

/** Prépare ou actualise le brouillon : `{ report, metrics, kiosks, blockers, default_for, proposed }`. */
export async function buildEventReport(eventId) {
  const { data, error } = await supabase.rpc('build_event_report', { p_event_id: eventId });
  if (error) throw error;
  return data;
}

/** Photos du bilan (6 au plus), dans l'ordre d'affichage. */
export async function updateEventReportSelection(eventId, photoIds) {
  const { data, error } = await supabase
    .from('event_reports')
    .update({ selected_photo_ids: photoIds })
    .eq('event_id', eventId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Bilan introuvable');
}

/** Lien du bilan coupé ; un nouvel envoi crée un nouveau lien. */
export async function revokeEventReport(eventId) {
  const { data, error } = await supabase
    .from('event_reports')
    .update({ status: 'revoked' })
    .eq('event_id', eventId)
    .eq('status', 'sent')
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Aucun bilan envoyé à révoquer');
}

/** Ligne du bilan sans le recalculer (lecture seule) ; null si jamais préparé. */
export async function getEventReportRow(eventId) {
  const { data, error } = await supabase
    .from('event_reports')
    .select('id, token, status, frozen_at, sent_at, expires_at, selected_photo_ids')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Fige le bilan et l'envoie au client (edge function send-event-report, LAB-238).
 * `photoIds` : photos du bilan (6 au plus, dans l'ordre). L'erreur porte `code` et `blockers`.
 */
export async function sendEventReport(eventId, photoIds) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/send-event-report`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ event_id: eventId, photo_ids: photoIds }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw Object.assign(functionError(res, data, 'Le bilan n’a pas pu être envoyé'), {
      blockers: Array.isArray(data?.blockers) ? data.blockers : [],
    });
  }
  return data;
}

/** Bilan public par jeton ; null si inconnu, révoqué ou expiré. */
export async function getEventReport(token) {
  const { data, error } = await supabase.rpc('get_event_report', { p_token: token });
  if (error) throw error;
  return data ?? null;
}

/** Rappels « Contacts à exporter » du tableau de bord (LAB-224), suppression la plus proche d'abord. */
export async function getGuestExportReminders() {
  const summaries = await getGuestResponsesSummary();
  if (!summaries.length) return [];
  const { data, error } = await supabase
    .from('events')
    .select('id, name, start_date, end_date, guest_responses_exported_at')
    .in('id', summaries.map((s) => s.event_id));
  if (error) throw error;
  return guestExportReminders(summaries, data ?? []);
}

/** `at` : début de l'export (avant la lecture des lignes), pour qu'une réponse arrivée pendant l'export rouvre le rappel. */
export async function markGuestResponsesExported(eventId, at = new Date()) {
  const { data, error } = await supabase
    .from('events')
    .update({ guest_responses_exported_at: at.toISOString() })
    .eq('id', eventId)
    .select('guest_responses_exported_at')
    .single();
  if (error) throw error;
  return data.guest_responses_exported_at;
}

// ── Consentements photo de la borne (LAB-226) ────────────────────────────────
// Lecture réservée aux administrateurs de l'application (RLS is_app_admin, LAB-223).

/** true si l'utilisateur connecté est dans app_admins. */
export async function isAppAdmin() {
  const { data, error } = await supabase.rpc('is_app_admin');
  if (error) throw error;
  return data === true;
}

const PHOTO_CONSENT_COLUMNS = 'id, event_id, machine_id, session_id, consent_text, consented_at, received_at';

/** Page de consentements, plus récents d'abord. */
export async function getPhotoConsents(eventId, { page = 1, pageSize = 50 } = {}) {
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from('kiosk_photo_consents')
    .select(PHOTO_CONSENT_COLUMNS, { count: 'exact' })
    .eq('event_id', eventId)
    .order('consented_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export function getAllPhotoConsents(eventId) {
  return selectAllPages(() => supabase
    .from('kiosk_photo_consents')
    .select(PHOTO_CONSENT_COLUMNS)
    .eq('event_id', eventId)
    .order('consented_at', { ascending: true })
    .order('id', { ascending: true }));
}

// ── Export fichier .pola (LAB-216) ───────────────────────────────────────────

async function urlToBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function gzipString(str) {
  const bytes = new TextEncoder().encode(str);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/**
 * Télécharge le fichier .pola de l'événement (voir polaBundle.js pour son contenu).
 * Lève PolaExportError sans design approuvé ou sans son PNG.
 * Retourne { fileName, warnings } (éléments facultatifs manquants).
 */
export async function exportPolaFile(eventId) {
  const [{ data: event, error: evErr }, { data: design, error: dsErr }] = await Promise.all([
    supabase.from('events').select('id, org_id, name, access_code, start_date, end_date, form_config').eq('id', eventId).single(),
    supabase.from('client_designs').select('id, status, format, canvas_json, final_png_url')
      .eq('event_id', eventId).eq('status', 'approved').maybeSingle(),
  ]);
  if (evErr) throw evErr;
  if (dsErr) throw dsErr;

  const problem = polaDesignProblem(design);
  if (problem) throw new PolaExportError(problem);

  const homeBgUrl = event.form_config?.kiosk?.home?.background_url;
  const [designPngBase64, homeBackgroundBase64, { contact, logoBase64 }, guestFormEnabled] = await Promise.all([
    urlToBase64(design.final_png_url),
    homeBgUrl ? urlToBase64(homeBgUrl) : null,
    supabase.rpc('get_org_contact_by_event', { p_event_id: eventId })
      .then(({ data }) => data ?? null, () => null)
      // Logo de la société (LAB-257) : facultatif, signalé dans les avertissements s'il manque.
      .then(async (c) => ({ contact: c, logoBase64: c?.logo_url ? await urlToBase64(c.logo_url) : null })),
    // Lecture impossible : questionnaire gardé (comme avant), la borne en ligne reste filtrée par la RPC.
    getOrgFeatures().then(({ features }) => isFeatureEnabled(features, 'guest_form'), () => true),
  ]);

  const bundle = buildPolaBundle({
    event, design, designPngBase64, homeBackgroundBase64, contact, logoBase64, guestFormEnabled,
  });

  const compressed = await gzipString(JSON.stringify(bundle));
  const fileName   = polaFileName(event);
  const blob = new Blob([compressed], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  return { fileName, warnings: polaBundleWarnings(bundle) };
}

// ── Livraison post-événement (LAB-10) ────────────────────────────────────────

/** Envoie l'email de livraison unifié (photos + audio + avis + facture) pour un événement (admin). */
export async function sendDeliveryEmailForEvent(eventId) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/send-delivery`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ event_id: eventId }),
  });
  const data = await readJson(res);
  if (!res.ok) throw functionError(res, data, 'Erreur lors de l\'envoi de la livraison');
  return data;
}

// ── Pipeline commercial & notifications (LAB-28) ──────────────────────────────

/**
 * Notifications in-app (cloche admin). RLS scope déjà la lecture à l'org du owner.
 * Non lues d'abord, puis les plus récentes.
 */
export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, event_id, lead_id, type, title, payload, read_at, created_at, events(name, client_name)')
    .order('read_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Marque une notification comme lue (read_at = now). */
export async function markNotificationRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null);
  if (error) throw error;
}

// ── Synchro Google Calendar (LAB-29) ──────────────────────────────────────────

/**
 * Pousse un événement vers Google Calendar (borne assignée + client + code dans la description).
 * Best-effort : ne lève jamais — la synchro ne doit pas bloquer l'UX. Reste inactive tant que
 * les secrets Google ne sont pas configurés côté Supabase (la fonction répond alors { skipped }).
 */
export async function syncEventToGoogleCalendar(eventId) {
  if (!eventId) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/gcal-sync`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:          supabaseAnon,
        Authorization:   `Bearer ${session?.access_token ?? supabaseAnon}`,
      },
      body: JSON.stringify({ event_id: eventId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('Synchro Google Calendar échouée', data.error ?? res.status);
    }
  } catch (e) {
    console.warn('Synchro Google Calendar échouée', e);
  }
}

// ── Connexion et mot de passe de l'admin (LAB-268) ────────────────────────────

export async function signInAdmin(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw toAuthError(error, 'Connexion impossible. Réessayez.');
}

/** Envoie le lien de réinitialisation. Sans erreur même si le compte n'existe pas (Supabase). */
export async function requestPasswordReset(email) {
  const redirectTo = resetRedirectUrl(import.meta.env.VITE_APP_URL, window.location.origin);
  const { error } = await supabase.auth.resetPasswordForEmail(String(email ?? '').trim(), { redirectTo });
  if (error) throw toAuthError(error, "Envoi de l'email impossible. Réessayez.");
}

/**
 * Ouvre la session de récupération à partir du lien reçu par email.
 * Flux implicite (client par défaut) et PKCE : le client Supabase lit l'URL à son initialisation,
 * getSession() l'attend. token_hash : modèle d'email qui pointe directement vers le site.
 * Code PKCE resté dans l'URL : échange explicite (échoue si le lien est ouvert dans un autre navigateur).
 * Renvoie { ok: true, email } ou { ok: false, reason }.
 */
export async function openPasswordRecovery(href = window.location.href) {
  const link = recoveryLink(href);
  if (link.error) return { ok: false, reason: link.error };
  if (link.tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: 'recovery' });
    if (error) return { ok: false, reason: toAuthError(error).code ?? 'invalid' };
  }
  let { data: { session } } = await supabase.auth.getSession();
  if (!session && link.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);
    if (error) return { ok: false, reason: toAuthError(error).code ?? 'invalid' };
    session = data.session;
  }
  if (!session) return { ok: false, reason: 'missing' };
  return { ok: true, email: session.user?.email ?? '' };
}

/** Identifiant de l'utilisateur connecté (null sans session). */
export async function getCurrentUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** Email de l'admin connecté ('' sans session). */
export async function getCurrentUserEmail() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email ?? '';
}

/** Change le mot de passe de l'utilisateur connecté. nonce : code de réauthentification reçu par email. */
export async function updatePassword(password, { nonce, currentPassword } = {}) {
  const attributes = { password };
  if (nonce) attributes.nonce = nonce.trim();
  if (currentPassword) attributes.current_password = currentPassword;
  const { error } = await supabase.auth.updateUser(attributes);
  if (error) throw toAuthError(error, 'Changement du mot de passe impossible. Réessayez.');
}

/** Envoie par email le code exigé par Supabase quand la session est trop ancienne (« Secure password change »). */
export async function sendReauthenticationCode() {
  const { error } = await supabase.auth.reauthenticate();
  if (error) throw toAuthError(error, 'Envoi du code impossible. Réessayez.');
}
