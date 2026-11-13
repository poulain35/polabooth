// Bandeau « Vous organisez un événement ? » des galeries publiques photo et audio (LAB-130),
// barre fixe en bas de l'écran depuis LAB-142 (fermeture retenue pour la session).
// Réglage : organizations.business_profile.gallery_booking_banner (absent = affiché), exposé à anon
// sous la seule forme du booléen `booking_banner` de la RPC get_public_event.
import { ORG } from '../components/public/polaStyles.js';

export const BOOKING_BANNER_SETTING = 'gallery_booking_banner';

/** Clé sessionStorage de la fermeture de la barre (une fois fermée, plus affichée de la session). */
export const BANNER_DISMISS_KEY = 'pola:gallery-booking-banner-dismissed';

const UTM = { utm_source: 'galerie', utm_medium: 'web' };

function campaign(eventType) {
  const slug = typeof eventType === 'string' ? eventType.trim().toLowerCase() : '';
  return /^[a-z0-9_-]{1,40}$/.test(slug) ? slug : '';
}

function siteUrl(site, path, params) {
  const url = new URL(`${String(site).replace(/\/+$/, '')}/${path}/`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Liens du bandeau : disponibilités (avec le type d'événement en utm_campaign s'il est connu) et
 * entreprises. Le bilan client (LAB-236) passe ses propres UTM et garde le type aussi pour les entreprises.
 */
export function bookingBannerLinks(eventType, site = ORG.site, { utm = UTM, businessCampaign = false } = {}) {
  if (!site) return null; // instance sans site vitrine (open core L7) : pas de bandeau ni de lien
  const c = campaign(eventType);
  const withCampaign = c ? { ...utm, utm_campaign: c } : utm;
  return {
    booking: siteUrl(site, 'disponibilites', withCampaign),
    business: siteUrl(site, 'pour-les-entreprises', businessCampaign ? withCampaign : utm),
  };
}

/** Affiché par défaut : seul un `false` explicite (réglage désactivé) le masque. */
export function isBookingBannerEnabled(value) {
  return value !== false;
}

/** Règle d'affichage : réglage actif et galerie non vide (jamais sur une page d'erreur). */
export function shouldShowBookingBanner({ enabled, itemCount }) {
  return isBookingBannerEnabled(enabled) && Number(itemCount) > 0;
}

/** Barre fermée pendant cette session ? Stockage indisponible (navigation privée, bloqué) : non. */
// L'accès même à window.sessionStorage peut lever (SecurityError) : il reste dans le try.
export function isBookingBannerDismissed(storage) {
  try {
    return (storage ?? globalThis.sessionStorage)?.getItem(BANNER_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Retient la fermeture pour la session ; sans stockage, la barre reste fermée jusqu'au rechargement. */
export function dismissBookingBanner(storage) {
  try {
    (storage ?? globalThis.sessionStorage)?.setItem(BANNER_DISMISS_KEY, '1');
  } catch { /* stockage indisponible */ }
}
