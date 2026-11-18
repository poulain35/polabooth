// Réglages de l'habillage et de l'email de la borne dans la fiche de l'événement (LAB-302, spec
// email-galerie-couleurs, lot L3). Règles pures (pas de réseau ni de DOM), testées dans
// eventBrandingAdmin.test.js. Les règles partagées avec le serveur sont dans eventBranding.js.

import { checkColor, TEXT_LIMITS, unknownVariables } from './eventBranding.js';
import { kioskBackgroundExtension } from './kioskBackground.js';

// ── Logo de l'événement (D8) ─────────────────────────────────────────────────────────────────

export const EVENT_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Message d'erreur à montrer à l'admin, ou null si le fichier est accepté (PNG ou JPG, 2 Mo). */
export function eventLogoProblem(file) {
  if (!file) return 'Aucun fichier choisi.';
  if (!kioskBackgroundExtension(file)) return 'Format non accepté : choisissez une image PNG ou JPG (pas de SVG).';
  if (file.size > EVENT_LOGO_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return `Image trop lourde (${mb} Mo) : 2 Mo au maximum. Réduisez sa taille et réessayez.`;
  }
  return null;
}

/** Chemin du logo dans le bucket kiosk-backgrounds (dossier de l'événement, LAB-282). */
export function eventLogoPath(eventId, ext) {
  return `${eventId}/brand-logo.${ext}`;
}

/** Chemins possibles du logo, pour le supprimer quel que soit son format. */
export function eventLogoPaths(eventId) {
  return [eventLogoPath(eventId, 'png'), eventLogoPath(eventId, 'jpg')];
}

// ── form_config.branding ─────────────────────────────────────────────────────────────────────

const BRANDING_KEYS = ['color', 'logo_url', 'gallery_text'];
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** Valeurs éditées dans la fiche, à partir de form_config.branding (absent : tout vide). */
export function brandingDraftFrom(formConfig) {
  const b = isRecord(formConfig?.branding) ? formConfig.branding : {};
  return { color: str(b.color), logo_url: str(b.logo_url) || null, gallery_text: str(b.gallery_text) };
}

/**
 * Branding enregistré après application de `patch` : seules les trois clés connues, valeurs vides
 * (null, '', blanc) retirées. Rien de réglé : null (la clé branding n'est pas écrite).
 */
export function mergeBranding(stored, patch) {
  const merged = { ...(isRecord(stored) ? stored : {}), ...(isRecord(patch) ? patch : {}) };
  const out = {};
  for (const key of BRANDING_KEYS) {
    const v = merged[key];
    if (typeof v === 'string' && v.trim()) out[key] = key === 'color' ? v.trim().toUpperCase() : v;
  }
  return Object.keys(out).length ? out : null;
}

/** form_config avec ce branding (null : clé retirée). */
export function withBranding(formConfig, branding) {
  const { branding: _old, ...rest } = isRecord(formConfig) ? formConfig : {};
  return branding ? { ...rest, branding } : rest;
}

// ── form_config.kiosk.email ──────────────────────────────────────────────────────────────────

/** Champs de texte de l'email, dans l'ordre de la fiche, avec leur libellé. */
const EMAIL_TEXT_FIELDS = [
  { key: 'subject', label: 'Objet' },
  { key: 'title', label: 'Titre' },
  { key: 'message', label: 'Message' },
  { key: 'button_label', label: 'Bouton' },
];

/** Titre et bouton (LAB-302) vides : non écrits, l'email garde les textes d'aujourd'hui. */
export function cleanKioskEmail(email) {
  if (!isRecord(email)) return email;
  const out = { ...email };
  for (const key of ['title', 'button_label']) {
    if (!str(out[key]).trim()) delete out[key];
  }
  return out;
}

/**
 * form_config enregistré par « Enregistrer la configuration » : kiosk remplacé (titre et bouton vides
 * retirés), branding fusionné avec `brandingPatch` (couleur, texte de la galerie ; le logo est
 * enregistré dès son envoi). `brandingPatch` absent : branding inchangé.
 */
export function kioskFormConfigForSave(stored, kiosk, brandingPatch) {
  const base = isRecord(stored) ? stored : {};
  const next = { ...base, kiosk: isRecord(kiosk) && 'email' in kiosk ? { ...kiosk, email: cleanKioskEmail(kiosk.email) } : kiosk };
  return brandingPatch === undefined ? next : withBranding(next, mergeBranding(base.branding, brandingPatch));
}

// ── Contrôles avant l'enregistrement ─────────────────────────────────────────────────────────

/** Couleur saisie, telle qu'enregistrée (majuscules, sans blanc). */
export function normalizeColor(value) {
  return str(value).trim().toUpperCase();
}

/** Erreurs bloquantes (messages) : couleur illisible ou mal formée, textes trop longs. */
export function brandingErrors(draft, { emailEnabled = false, email = {} } = {}) {
  const errors = [];
  const color = checkColor(normalizeColor(draft?.color));
  if (!color.ok) errors.push(color.error);
  if (Array.from(str(draft?.gallery_text)).length > TEXT_LIMITS.gallery_text.input) {
    errors.push(`Texte de la galerie : ${TEXT_LIMITS.gallery_text.input} caractères au maximum`);
  }
  if (emailEnabled) {
    for (const { key, label } of EMAIL_TEXT_FIELDS) {
      const max = TEXT_LIMITS[key].input;
      if (Array.from(str(email?.[key])).length > max) errors.push(`Email, ${label.toLowerCase()} : ${max} caractères au maximum`);
    }
  }
  return errors;
}

/**
 * Avertissements (non bloquants) sur les textes de l'email : variable inconnue (laissée telle quelle
 * dans l'email), {event_date} sans date, {client_name} sans nom de client.
 */
export function emailWarnings(email, event) {
  const warnings = [];
  const texts = EMAIL_TEXT_FIELDS.map(({ key, label }) => ({ label, text: str(email?.[key]) }));
  for (const { label, text } of texts) {
    for (const name of unknownVariables(text)) {
      warnings.push(`${label} : variable inconnue {${name}}, elle restera telle quelle dans l'email.`);
    }
  }
  const all = texts.map((t) => t.text).join('\n');
  if (all.includes('{event_date}') && !str(event?.start_date).trim()) {
    warnings.push("La date de l'événement n'est pas renseignée : {event_date} sera vide.");
  }
  if (all.includes('{client_name}') && !str(event?.client_name).trim()) {
    warnings.push("Le nom du client n'est pas renseigné : {client_name} sera vide.");
  }
  return warnings;
}

/** Brouillon envoyé à kiosk-email-preview : les valeurs de la fiche, non enregistrées. */
export function previewDraft(email, branding) {
  const e = isRecord(email) ? email : {};
  return {
    email: {
      subject: str(e.subject), title: str(e.title), message: str(e.message), button_label: str(e.button_label),
      sender_name: str(e.sender_name), sender_email: str(e.sender_email),
    },
    branding: {
      color: normalizeColor(branding?.color),
      logo_url: str(branding?.logo_url),
      gallery_text: str(branding?.gallery_text),
    },
  };
}

/** Lisibilité de la couleur en direct : { tone: 'empty' | 'ok' | 'error', text, theme }. */
export function colorStatus(value) {
  const color = normalizeColor(value);
  if (!color) return { tone: 'empty', text: 'Sans couleur : couleurs habituelles de l\'email et de la galerie.', theme: null };
  const check = checkColor(color);
  if (!check.ok) return { tone: 'error', text: check.error, theme: null };
  const titleNote = check.theme.titleColor === color ? 'titre en couleur' : 'titre en texte foncé (couleur trop claire)';
  const textNote = check.theme.accentText === '#FFFFFF' ? 'texte blanc' : 'texte foncé';
  return { tone: 'ok', text: `Lisible : bouton en ${textNote}, ${titleNote}.`, theme: check.theme };
}
