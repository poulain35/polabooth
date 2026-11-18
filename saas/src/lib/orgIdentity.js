// Carte « Entreprise » des paramètres (open core, lot L5) : identité de l'entreprise réunie en un
// seul endroit. Colonnes d'organizations (contact_*, email_sender_*) et des clés de business_profile :
// signature des emails et lien d'avis (send-delivery, send-event-report), puis la marque des emails
// (open core L7, lue par _shared/email-brand.ts : logo, site, avis, réseaux, mentions légales).
// Un champ vide est enregistré NULL (colonnes) ou '' (profil) : les emails gardent leur valeur par défaut.

import { IDENTITY_KEYS } from './businessProfile.js';

/** Colonnes d'organizations écrites par la carte. */
export const IDENTITY_COLUMNS = [
  'contact_company', 'contact_phone', 'contact_email', 'contact_address', 'email_sender_name', 'email_sender_email',
];

/** Marque des emails (open core L7) : en-tête, pied de page et mentions légales de tous les emails. */
const EMAIL_BRAND_KEYS = [
  'email_logo_url', 'website_url', 'email_reviews_text',
  'social_facebook_url', 'social_instagram_url', 'social_linkedin_url', 'email_legal_footer',
];

/** Clés de business_profile écrites par la carte (et plus par « Galeries et bilan client », ex-« Profil de l'entreprise »). */
export const IDENTITY_PROFILE_KEYS = [...IDENTITY_KEYS, ...EMAIL_BRAND_KEYS];

/** Champs d'adresse web : vides ou en http(s), sinon ignorés par les emails. */
const URL_KEYS = ['google_review_url', 'email_logo_url', 'website_url', 'social_facebook_url', 'social_instagram_url', 'social_linkedin_url'];
const URL_RE = /^https?:\/\/\S+$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** État initial du formulaire, depuis la ligne organizations. */
export function identityForm(org) {
  const row = isObject(org) ? org : {};
  const bp = isObject(row.business_profile) ? row.business_profile : {};
  return {
    ...Object.fromEntries(IDENTITY_COLUMNS.map((k) => [k, str(row[k])])),
    ...Object.fromEntries(IDENTITY_PROFILE_KEYS.map((k) => [k, str(bp[k])])),
  };
}

/** Erreurs bloquantes, par champ (vide si le formulaire est enregistrable). */
export function identityErrors(form) {
  const errors = {};
  const sender = str(form.email_sender_email).trim();
  if (sender && !EMAIL_RE.test(sender)) errors.email_sender_email = "Adresse de l'expéditeur invalide.";
  const contact = str(form.contact_email).trim();
  if (contact && !EMAIL_RE.test(contact)) errors.contact_email = 'Email de contact invalide.';
  for (const key of URL_KEYS) {
    const url = str(form[key]).trim();
    if (url && !URL_RE.test(url)) errors[key] = 'Adresse web invalide (elle doit commencer par https://).';
  }
  return errors;
}

/** Valeurs à écrire : colonnes (vide → NULL) et patch de business_profile (vide → ''). */
export function identitySave(form) {
  const columns = Object.fromEntries(IDENTITY_COLUMNS.map((k) => [k, str(form[k]).trim() || null]));
  const businessPatch = Object.fromEntries(IDENTITY_PROFILE_KEYS.map((k) => [k, str(form[k]).trim()]));
  return { columns, businessPatch };
}
