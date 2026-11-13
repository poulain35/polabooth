/**
 * Bilan client d'un événement (LAB-236, spec LAB-209 SAAS-3) : mise en forme du payload de
 * get_event_report / build_event_report (migration 20261201000000_event_reports.sql). Fonctions
 * pures : aucun chiffre n'est calculé ici, on ne fait que choisir quoi montrer et comment l'écrire.
 * Règle : une clé absente de `metrics` = bloc masqué ; une valeur présente à 0 s'affiche à 0.
 */
import { bookingBannerLinks } from './galleryBanner.js';
import { isVideoUrl } from '../utils/media.js';
import { ORG } from '../components/public/polaStyles.js';
import { BRAND } from './instanceBrand.js';

export const REPORT_UTM = { utm_source: 'rapport', utm_medium: 'email' };
export const UNAVAILABLE_MESSAGE = 'Ce bilan n’est plus disponible';
export const MAX_PHOTOS = 6;
export const MAX_HOUR_DAYS = 3;
// Une séance entre minuit et 6 h appartient à la soirée de la veille (si la veille a des séances).
const NIGHT_END_HOUR = 6;

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = new Intl.NumberFormat('fr-FR');
const DATE_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATE_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DATE_PLAIN = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

/** Jeton au format UUID : sinon inutile d'interroger le serveur (même message que pour un jeton inconnu). */
export const isReportToken = (token) => typeof token === 'string' && TOKEN_RE.test(token.trim());

/** Nombre entier positif ou nul venu du serveur, sinon null (valeur absente ou invalide = rien d'affiché). */
export function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** 1234 → « 1 234 » (espace fine insécable du format fr-FR). */
export const formatCount = (n) => NUMBER.format(n);

/** Singulier pour 0 et 1, comme en français. */
export const plural = (n, one, many) => (n > 1 ? many : one);

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function civil(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « Vendredi 12 décembre 2026 », ou « Du vendredi 12 décembre 2026 au samedi 13 décembre 2026 ». */
export function eventDateLabel(start, end) {
  const s = civil(start);
  const e = civil(end);
  if (s && e && e.getTime() !== s.getTime()) return `Du ${DATE_LONG.format(s)} au ${DATE_LONG.format(e)}`;
  const d = s ?? e;
  return d ? capitalize(DATE_LONG.format(d)) : '';
}

/** « Bilan arrêté au 19 décembre 2026 » (date de Paris du gel) ; vide pour un brouillon. */
export function frozenLabel(frozenAt) {
  if (!frozenAt) return '';
  const d = new Date(frozenAt);
  return Number.isNaN(d.getTime()) ? '' : `Bilan arrêté au ${DATE_PLAIN.format(d)}`;
}

/** Durée totale du livre d'or : « 41 min », « 1 h 05 min », « moins d'une minute ». */
export function formatDuration(seconds) {
  const s = count(seconds);
  if (s === null) return '';
  const minutes = Math.round(s / 60);
  if (minutes === 0) return s > 0 ? 'moins d’une minute' : '0 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

const FIGURES = [
  ['sessions', 'séance photo', 'séances photo'],
  ['prints', 'tirage imprimé', 'tirages imprimés'],
  ['qr_photos', 'photo récupérée par QR code', 'photos récupérées par QR code'],
  ['kiosk_emails', 'photo envoyée par e-mail', 'photos envoyées par e-mail'],
  ['gallery_opens', 'ouverture de la galerie', 'ouvertures de la galerie'],
  ['downloads', 'photo téléchargée', 'photos téléchargées'],
];

/** Cartes chiffrées, dans l'ordre de la maquette ; seules les clés présentes et valides. */
export function reportFigures(metrics) {
  const m = metrics && typeof metrics === 'object' ? metrics : {};
  return FIGURES.flatMap(([key, one, many]) => {
    const n = count(m[key]);
    return n === null ? [] : [{ key, value: formatCount(n), label: plural(n, one, many) }];
  });
}

const hourLabel = (h) => `${h % 24} h`;
const slotLabel = (h) => `${hourLabel(h)} – ${hourLabel(h + 1)}`;

function addDays(day, n) {
  const d = civil(day);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Histogramme par jour (heure de Paris, déjà calculée par le serveur). Les heures de 0 h à 5 h
 * sont rattachées à la veille quand la veille a des séances (soirée qui passe minuit). Une barre
 * par heure entre la première et la dernière heure du jour (0 pour une heure sans séance).
 * Plus de 3 jours, ou aucune séance horodatée : null (bloc masqué).
 */
export function reportHours(metrics) {
  const m = metrics && typeof metrics === 'object' ? metrics : {};
  if (!Array.isArray(m.hours)) return null;
  const valid = m.hours.flatMap((h) => {
    const n = count(h?.sessions);
    const hour = count(h?.hour);
    return n && hour !== null && hour < 24 && civil(h?.day) ? [{ day: h.day.slice(0, 10), hour, n }] : [];
  });
  if (!valid.length) return null;

  const daysWithSessions = new Set(valid.map((h) => h.day));
  const byDay = new Map();
  for (const { day, hour, n } of valid) {
    const prev = addDays(day, -1);
    const night = hour < NIGHT_END_HOUR && daysWithSessions.has(prev);
    const key = night ? prev : day;
    const slot = night ? hour + 24 : hour;
    const slots = byDay.get(key) ?? new Map();
    slots.set(slot, (slots.get(slot) ?? 0) + n);
    byDay.set(key, slots);
  }
  if (byDay.size > MAX_HOUR_DAYS) return null;

  const days = [...byDay.keys()].sort().map((day) => {
    const slots = byDay.get(day);
    const keys = [...slots.keys()];
    const first = Math.min(...keys);
    const last = Math.max(...keys);
    const rows = [];
    for (let h = first; h <= last; h += 1) rows.push({ hour: h, label: hourLabel(h), sessions: slots.get(h) ?? 0 });
    const max = Math.max(...rows.map((r) => r.sessions));
    const peak = rows.find((r) => r.sessions === max);
    return {
      day,
      dayLabel: capitalize(DATE_DAY.format(civil(day))),
      peak: slotLabel(peak.hour),
      rows: rows.map((r) => ({ ...r, ratio: r.sessions / max })),
    };
  });

  const timed = count(m.timed_sessions);
  const sessions = count(m.sessions);
  const note = timed !== null && sessions !== null && timed < sessions
    ? `Calculé sur ${formatCount(timed)} ${plural(timed, 'séance horodatée', 'séances horodatées')} sur ${formatCount(sessions)}.`
    : '';
  return { days, note };
}

/** Livre d'or : « 23 messages, 41 min au total » ; durée omise si une piste n'en a pas (seconds null). */
export function reportAudio(metrics) {
  const a = metrics?.audio;
  if (!a || typeof a !== 'object') return null;
  const messages = count(a.messages);
  if (messages === null) return null;
  const duration = messages > 0 && count(a.seconds) !== null ? formatDuration(a.seconds) : '';
  const text = `${formatCount(messages)} ${plural(messages, 'message', 'messages')}`;
  return { messages, text: duration ? `${text}, ${duration} au total` : text };
}

/** Questionnaire de la borne : deux compteurs, jamais un contact. */
export function reportQuestionnaire(metrics) {
  const q = metrics?.questionnaire;
  if (!q || typeof q !== 'object') return null;
  const responses = count(q.responses);
  if (responses === null) return null;
  if (responses === 0) return { text: 'Aucun invité n’a répondu au questionnaire.' };
  const consents = count(q.consents);
  const head = `${formatCount(responses)} ${plural(responses, 'invité a répondu', 'invités ont répondu')} au questionnaire`;
  // Sans consentement (ou case non proposée), on ne dit rien : 0 ne prouve pas que la case était proposée.
  if (!consents) return { text: `${head}.` };
  return { text: `${head}, dont ${formatCount(consents)} ${plural(consents, 'a accepté', 'ont accepté')} d’être ${plural(consents, 'recontacté', 'recontactés')}.` };
}

/** Photos choisies encore en ligne (6 au plus) : la miniature, à défaut la photo si ce n'est pas une vidéo. */
export function reportPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos.flatMap((p) => {
    const src = httpsUrl(p?.thumbnail_url) ?? (isVideoUrl(p?.url) ? null : httpsUrl(p?.url));
    return src ? [{ id: String(p.id ?? src), src }] : [];
  }).slice(0, MAX_PHOTOS);
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\/\S+$/.test(value)) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

/** Événement pro : lead « professionnel », ou type d'événement « entreprise ». */
export function isProEvent(report) {
  return report?.client_type === 'professionnel' || String(report?.event_type ?? '').trim().toLowerCase() === 'entreprise';
}

/** « Réserver à nouveau » : page entreprises pour un pro, disponibilités sinon (mêmes liens que le bandeau des galeries). */
export function rebookUrl(report, site = ORG.site) {
  const links = bookingBannerLinks(report?.event_type, site, { utm: REPORT_UTM, businessCampaign: true });
  if (!links) return null;
  return isProEvent(report) ? links.business : links.booking;
}

/** Lien d'avis : seulement une URL https valide (le serveur le vérifie aussi) ; sinon pas de bouton. */
export const reviewUrl = (report) => httpsUrl(report?.review_url);

function appBase(appUrl) {
  return typeof appUrl === 'string' ? appUrl.replace(/\/+$/, '') : '';
}

function codeUrl(appUrl, path, report, online) {
  const code = typeof report?.access_code === 'string' ? report.access_code.trim() : '';
  if (!online || !code || !appBase(appUrl)) return null;
  return `${appBase(appUrl)}/${path}/${encodeURIComponent(code)}`;
}

/**
 * Tout ce que la page affiche, à partir du payload. `null` si le payload n'est pas un bilan
 * (jeton inconnu, révoqué ou expiré : la RPC renvoie null).
 */
export function buildReportView(report, { appUrl = '', site = ORG.site } = {}) {
  if (!report || typeof report !== 'object' || !report.metrics || typeof report.metrics !== 'object') return null;
  const metrics = report.metrics;
  const audio = reportAudio(metrics);
  return {
    company: typeof report.company === 'string' && report.company.trim() ? report.company.trim() : BRAND.name,
    title: typeof report.name === 'string' && report.name.trim() ? report.name.trim() : 'Votre événement',
    date: eventDateLabel(report.start_date, report.end_date),
    frozen: frozenLabel(report.frozen_at),
    figures: reportFigures(metrics),
    hours: reportHours(metrics),
    photos: reportPhotos(report.photos),
    galleryUrl: codeUrl(appUrl, 'photos', report, report.gallery_online === true),
    audio: audio && { ...audio, url: codeUrl(appUrl, 'audio', report, report.audio_online === true) },
    questionnaire: reportQuestionnaire(metrics),
    rebookUrl: rebookUrl(report, site),
    reviewUrl: reviewUrl(report),
  };
}
