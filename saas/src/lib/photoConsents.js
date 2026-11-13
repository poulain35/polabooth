// Consentements photo de la borne (LAB-226, table kiosk_photo_consents de LAB-223) : date de
// suppression, tableau d'export et CSV de preuve. Fonctions pures.
import { PURGE_GRACE_DAYS } from './mediaExpiry.js';
import { formatParisDate, formatParisDateTime, slugify, toGuestCsv } from './guestResponsesExport.js';

const DAY_MS = 86_400_000;
const PARIS = 'Europe/Paris';

/**
 * Miroir de photo_consents_purge_at (SQL) : expires_at + 30 jours, ou null (jamais purgés).
 * Calculé ici plutôt que par RPC : expires_at est déjà chargé avec l'événement et suit les
 * modifications de la fiche sans requête. Base de données en UTC : + 30 jours = + 30 × 24 h.
 */
export function photoConsentsPurgeAt(expiresAt) {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t + PURGE_GRACE_DAYS * DAY_MS).toISOString();
}

/** Phrase affichée sous le titre du bloc. */
export function photoConsentsRetentionLabel(expiresAt, now = new Date()) {
  const purgeAt = photoConsentsPurgeAt(expiresAt);
  if (!purgeAt) return 'Gardés jusqu\'à la suppression de l\'événement (les photos n\'expirent pas)';
  const when = Date.parse(purgeAt) <= now.getTime() ? 'depuis le' : 'à partir du';
  return `Suppression automatique ${when} ${formatParisDate(purgeAt)} (30 jours après l'expiration des photos)`;
}

/** Libellé de la borne : nom de la licence, à défaut l'identifiant machine. */
export function machineLabel(machineId, licenses = []) {
  const lic = (licenses ?? []).find((l) => l?.machine_id === machineId);
  return lic?.label || machineId || '';
}

const byConsentedAt = (a, b) => (Date.parse(a.consented_at) - Date.parse(b.consented_at))
  || String(a.id).localeCompare(String(b.id));

/** Tableau de preuve { header, rows }, du plus ancien au plus récent. */
export function buildPhotoConsentsTable(consents, { licenses = [] } = {}) {
  const header = [
    'Date et heure (Paris)',
    'Horodatage UTC',
    'Séance',
    'Borne',
    'Identifiant machine',
    'Texte accepté',
    'Reçu par le serveur (Paris)',
    'Identifiant du consentement',
  ];
  const rows = [...(consents ?? [])].sort(byConsentedAt).map((c) => [
    formatParisDateTime(c.consented_at),
    c.consented_at ?? '',
    c.session_id ?? '',
    machineLabel(c.machine_id, licenses),
    c.machine_id ?? '',
    c.consent_text ?? '',
    formatParisDateTime(c.received_at),
    c.id ?? '',
  ]);
  return { header, rows };
}

/** CSV Excel FR (même format que l'export des réponses : ;, CRLF, BOM, préfixe ' anti-formule). */
export const toPhotoConsentsCsv = toGuestCsv;

/** consentements-photo-{slug}-{AAAA-MM-DD}.csv (date de l'événement, à défaut celle du jour). */
export function photoConsentsFileName(event, now = new Date()) {
  const slug = slugify(event?.name) || slugify(event?.client_name) || slugify(event?.access_code) || 'evenement';
  const day = String(event?.start_date ?? '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? day
    : new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(now);
  return `consentements-photo-${slug}-${date}.csv`;
}
