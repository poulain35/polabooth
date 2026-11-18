// Réglages de la borne pour un événement : form_config.kiosk, branding, fonds, écran de saisie du code.
import { orgLogoUrl } from '../orgLogo.js';
import {
  eventLogoPath, eventLogoPaths, eventLogoProblem, kioskFormConfigForSave, mergeBranding, withBranding,
} from '../eventBrandingAdmin.js';
import {
  eventBackgroundPath, kioskBackgroundContentType, kioskBackgroundExtension, kioskBackgroundProblem,
  kioskStorageErrorMessage, setupBackgroundPath,
} from '../kioskBackground.js';
import { supabase } from './client.js';
import { readEventFormConfig } from './forms.js';
import { callFunction } from './functions.js';

// ── Config kiosk ──────────────────────────────────────────────────────────────

/**
 * Enregistre form_config.kiosk et, si `brandingPatch` est donné ({ color, gallery_text }), fusionne
 * form_config.branding dans la même écriture (LAB-302). Titre et bouton de l'email vides, branding
 * vide : non écrits (kioskFormConfigForSave). Retourne le form_config enregistré.
 */
export function saveKioskConfig(eventId, kioskConfig, brandingPatch) {
  return rewriteFormConfig(eventId, (stored) => kioskFormConfigForSave(stored, kioskConfig, brandingPatch));
}

function updateEventBranding(eventId, patch) {
  return rewriteFormConfig(eventId, (stored) => withBranding(stored, mergeBranding(stored.branding, patch)));
}

// Relit form_config, applique `change` et réécrit tout le JSON ; retourne le form_config écrit.
async function rewriteFormConfig(eventId, change) {
  const updated = change(await readEventFormConfig(eventId));
  const { error } = await supabase
    .from('events').update({ form_config: updated }).eq('id', eventId);
  if (error) throw error;
  return updated;
}

function callKioskEmailPreview(body, fallback) {
  return callFunction('kiosk-email-preview', { admin: true, json: body, fallback });
}

/** Aperçu de l'email de la borne avec le brouillon non enregistré (LAB-302). Retourne { subject, html }. */
export function previewKioskEmail(eventId, { media = 'photo', draft } = {}) {
  return callKioskEmailPreview({ event_id: eventId, action: 'preview', media, draft }, "L'aperçu n'a pas pu être chargé");
}

/**
 * Email de test à l'adresse du compte connecté (LAB-302). Retourne { sent: true, to } ou
 * { sent: false, message } (aucun fournisseur) ; lève une Error sinon (429 : trop de tests).
 */
export function sendKioskEmailTest(eventId, { media = 'photo', draft } = {}) {
  return callKioskEmailPreview({ event_id: eventId, action: 'test', media, draft }, "L'email de test n'a pas pu être envoyé");
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

/**
 * Logo de l'événement (email et galerie, LAB-302) : {event_id}/brand-logo.png|jpg, enregistré dès
 * l'envoi dans form_config.branding.logo_url (URL avec ?v=). Retourne { logoUrl, formConfig }.
 */
export async function uploadEventBrandLogo(eventId, file) {
  const problem = eventLogoProblem(file);
  if (problem) throw new Error(problem);
  const publicUrl = await uploadKioskBucketImage(file, (ext) => eventLogoPath(eventId, ext));
  const kept = eventLogoPath(eventId, kioskBackgroundExtension(file));
  // L'ancien logo dans l'autre format ne sert plus.
  await supabase.storage.from('kiosk-backgrounds')
    .remove(eventLogoPaths(eventId).filter((p) => p !== kept)).catch(() => {});
  const logoUrl = orgLogoUrl(publicUrl, Date.now());
  const formConfig = await updateEventBranding(eventId, { logo_url: logoUrl });
  return { logoUrl, formConfig };
}

/** Supprime le logo de l'événement : logo_url retiré de form_config.branding, fichiers supprimés. */
export async function removeEventBrandLogo(eventId) {
  const formConfig = await updateEventBranding(eventId, { logo_url: null });
  await supabase.storage.from('kiosk-backgrounds').remove(eventLogoPaths(eventId)).catch(() => {});
  return formConfig;
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
