// organizations.business_profile : cartes « Galeries et bilan client » (ex-« Profil de l'entreprise », LAB-135), « Emails automatiques
// au client » (LAB-262, access_email_auto / delivery_auto) et « Entreprise » (open core L5, company_name /
// google_review_url) des réglages admin.
// Le formulaire ne possède que ses clés : l'enregistrement fusionne avec la valeur en base pour ne pas
// effacer les clés posées ailleurs (balance_window_days, clés ajoutées à la main…).
import { BOOKING_BANNER_SETTING, isBookingBannerEnabled } from './galleryBanner.js';
import { DEFAULT_FOR_FALLBACK, eventReportDefaultFor } from './eventReportAdmin.js';

export const BUSINESS_PROFILE_DEFAULT = {
  company_name: '',
  google_review_url: '',
  access_email_auto: { enabled: false, days_before: 30 },
  delivery_auto:     { enabled: false, days_after: 2 },
  [BOOKING_BANNER_SETTING]: true,
  // Bilan client proposé d'office (LAB-238) : 'professionnel', 'tous' ou 'aucun'.
  event_report: { default_for: DEFAULT_FOR_FALLBACK },
};

const NESTED = ['access_email_auto', 'delivery_auto', 'event_report'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** État initial du formulaire : défauts puis valeur en base. */
export function businessProfileForm(stored) {
  const bp = isObject(stored) ? stored : {};
  return {
    ...BUSINESS_PROFILE_DEFAULT,
    ...bp,
    access_email_auto: { ...BUSINESS_PROFILE_DEFAULT.access_email_auto, ...(isObject(bp.access_email_auto) ? bp.access_email_auto : {}) },
    delivery_auto:     { ...BUSINESS_PROFILE_DEFAULT.delivery_auto,     ...(isObject(bp.delivery_auto)     ? bp.delivery_auto     : {}) },
    event_report:      { ...(isObject(bp.event_report) ? bp.event_report : {}), default_for: eventReportDefaultFor(bp) },
  };
}

/** Clés du formulaire, normalisées. Toujours toutes présentes : un champ vidé écrit '' et remplace l'ancienne valeur. */
export function businessProfilePatch(cfg) {
  return {
    company_name:      cfg.company_name?.trim() ?? '',
    google_review_url: cfg.google_review_url?.trim() ?? '',
    access_email_auto: {
      enabled: !!cfg.access_email_auto?.enabled,
      days_before: Math.max(1, Math.round(Number(cfg.access_email_auto?.days_before) || BUSINESS_PROFILE_DEFAULT.access_email_auto.days_before)),
    },
    delivery_auto: {
      enabled: !!cfg.delivery_auto?.enabled,
      days_after: Math.max(0, Math.round(Number(cfg.delivery_auto?.days_after) || BUSINESS_PROFILE_DEFAULT.delivery_auto.days_after)),
    },
    [BOOKING_BANNER_SETTING]: isBookingBannerEnabled(cfg[BOOKING_BANNER_SETTING]),
    event_report: { default_for: eventReportDefaultFor(cfg) },
  };
}

/** Clés écrites par la carte « Emails automatiques au client » (LAB-262), plus par celle du profil. */
export const CLIENT_EMAIL_KEYS = ['access_email_auto', 'delivery_auto'];

/** Clés écrites par la carte « Entreprise » (open core L5, src/lib/orgIdentity.js), plus par celle du profil. */
export const IDENTITY_KEYS = ['company_name', 'google_review_url'];

/** Patch de la carte du profil : ses clés seulement, pour ne pas écraser les réglages enregistrés par les autres cartes. */
export function profilePatch(cfg) {
  const patch = businessProfilePatch(cfg);
  for (const k of [...CLIENT_EMAIL_KEYS, ...IDENTITY_KEYS]) delete patch[k];
  return patch;
}

/** Valeur à écrire : valeur en base, clés du patch par-dessus (les sous-objets d'automatisation fusionnés aussi). */
export function mergeBusinessProfile(stored, patch) {
  const base = isObject(stored) ? stored : {};
  const merged = { ...base, ...patch };
  for (const k of NESTED) {
    if (isObject(patch[k])) merged[k] = { ...(isObject(base[k]) ? base[k] : {}), ...patch[k] };
  }
  return merged;
}
