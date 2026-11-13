/**
 * Carte « Bilan client » de la fiche événement (LAB-238, spec LAB-209 SAAS-2) : fonctions pures.
 * Préparer (build_event_report), état des bornes, choix des photos, aperçu, envoi (send-event-report),
 * renvoi, révocation. Aucun chiffre n'est calculé ici : ils viennent tous de la RPC.
 */
import { MAX_PHOTOS, frozenLabel } from './eventReport.js';
import { isVideoUrl } from '../utils/media.js';

/** Codes de blocage de build_event_report (P0001). Même liste que send-event-report/logic.ts (test de parité). */
export const BLOCKER_CODES = ['kiosk_pending', 'kiosk_unknown', 'kiosk_not_seen', 'kiosk_unidentified', 'no_client_email'];

export const NOTHING_TO_REPORT = 'Rien à présenter pour cet événement.';
export const NO_CLIENT_EMAIL = 'Ajoutez l’e-mail du client dans la fiche de l’événement.';

/** Réglage organizations.business_profile.event_report.default_for (contrainte CHECK en base). */
export const DEFAULT_FOR_VALUES = ['professionnel', 'tous', 'aucun'];
export const DEFAULT_FOR_FALLBACK = 'professionnel';
export const DEFAULT_FOR_OPTIONS = [
  { value: 'professionnel', label: 'Clients professionnels' },
  { value: 'tous', label: 'Tous les clients' },
  { value: 'aucun', label: 'Personne (à la main seulement)' },
];

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
});
const DATE_PLAIN = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const time = (value) => {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};
const dateTime = (value) => (time(value) === null ? '' : DATE_TIME.format(new Date(value)));
const datePlain = (value) => (time(value) === null ? '' : DATE_PLAIN.format(new Date(value)));

/** Valeur du réglage, comme la fonction SQL event_report_default_for (défaut : professionnel). */
export function eventReportDefaultFor(businessProfile) {
  const v = isObject(businessProfile) && isObject(businessProfile.event_report)
    ? businessProfile.event_report.default_for
    : undefined;
  return DEFAULT_FOR_VALUES.includes(v) ? v : DEFAULT_FOR_FALLBACK;
}

/** Bilan proposé d'office : réglage « tous », ou « professionnel » pour un lead professionnel (comme la RPC). */
export function isReportProposed(defaultFor, clientType) {
  if (defaultFor === 'tous') return true;
  return defaultFor === 'professionnel' && clientType === 'professionnel';
}

/** Vignette affichable d'une photo (comme reportPhotos : miniature, sinon la photo si ce n'est pas une vidéo). */
export function photoThumb(photo) {
  const https = (v) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) ? v : null);
  return https(photo?.thumbnail_url) ?? (isVideoUrl(photo?.photo_url) ? null : https(photo?.photo_url));
}

/** Photos que le bilan peut montrer : approuvées, avec une vignette, dans l'ordre de la soirée. */
export function reportPhotoCandidates(photos) {
  if (!Array.isArray(photos)) return [];
  const at = (p) => time(p.captured_at) ?? time(p.created_at) ?? 0;
  return photos
    .filter((p) => p && p.id && p.status === 'approved' && photoThumb(p))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => at(a.p) - at(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/** Choix par défaut : `max` photos réparties sur la soirée (première et dernière comprises). */
export function defaultReportPhotos(photos, max = MAX_PHOTOS) {
  const list = reportPhotoCandidates(photos);
  const n = list.length;
  const m = Math.min(max, n);
  if (m <= 0) return [];
  if (m === 1) return [list[Math.floor((n - 1) / 2)].id];
  return Array.from({ length: m }, (_, i) => list[Math.round((i * (n - 1)) / (m - 1))].id);
}

/** Sélection mise à jour au clic : retire si présente, ajoute à la fin s'il reste de la place. */
export function toggleReportPhoto(selected, id, max = MAX_PHOTOS) {
  const list = Array.isArray(selected) ? selected : [];
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= max ? list : [...list, id];
}

/** Sélection à afficher : celle en base (photos encore présentes), sinon le choix par défaut. */
export function initialReportSelection(savedIds, photos, max = MAX_PHOTOS) {
  const ids = new Set(reportPhotoCandidates(photos).map((p) => p.id));
  const saved = (Array.isArray(savedIds) ? savedIds : []).filter((id) => ids.has(id)).slice(0, max);
  return saved.length ? saved : defaultReportPhotos(photos, max);
}

const kioskName = (k) => (typeof k?.label === 'string' && k.label.trim() ? `${k.label.trim()} ` : '');

/** Messages des blocages, avec le nom des bornes concernées quand il est connu. */
export function blockerMessages(blockers, kiosks = []) {
  const codes = Array.isArray(blockers) ? blockers : [];
  const list = Array.isArray(kiosks) ? kiosks : [];
  const byState = (state) => list.filter((k) => k?.state === state);
  const perKiosk = (state, text, fallback) => {
    const found = byState(state);
    return found.length ? found.map((k) => text(kioskName(k))) : [fallback];
  };
  const out = [];
  for (const code of BLOCKER_CODES) {
    if (!codes.includes(code)) continue;
    if (code === 'kiosk_pending') {
      out.push(...perKiosk('pending',
        (name) => `La borne ${name}n’a pas fini d’envoyer ses photos et ses impressions. Allumez-la avec une connexion, puis actualisez le bilan.`,
        'Une borne n’a pas fini d’envoyer ses photos et ses impressions. Allumez-la avec une connexion, puis actualisez le bilan.'));
    } else if (code === 'kiosk_unknown') {
      out.push(...perKiosk('unknown',
        (name) => `La borne ${name}n’a pas encore indiqué si tout est envoyé. Allumez-la avec une connexion, puis actualisez le bilan.`,
        'Une borne n’a pas encore indiqué si tout est envoyé. Allumez-la avec une connexion, puis actualisez le bilan.'));
    } else if (code === 'kiosk_not_seen') {
      out.push(...perKiosk('not_seen',
        (name) => `La borne ${name}n’a pas été connectée depuis l’événement.`,
        'La borne n’a pas été connectée depuis l’événement.'));
    } else if (code === 'kiosk_unidentified') {
      out.push('Des photos viennent d’une borne inconnue. Choisissez la borne dans « Photobooth assigné », puis actualisez le bilan.');
    } else if (code === 'no_client_email') {
      out.push(NO_CLIENT_EMAIL);
    }
  }
  return out;
}

/** Message d'une erreur de préparation (RPC) ou d'envoi (send-event-report). */
export function reportErrorMessage(err, kiosks = []) {
  if (!err) return '';
  if (err.code === '22023' || err.code === 'nothing_to_report') return NOTHING_TO_REPORT;
  if (err.code === '42501' || err.code === 'not_found') return 'Événement introuvable.';
  if (err.code === 'blocked' || err.code === 'P0001') {
    const blockers = Array.isArray(err.blockers) && err.blockers.length
      ? err.blockers
      : BLOCKER_CODES.filter((c) => String(err.message ?? '').includes(c));
    const messages = blockerMessages(blockers, kiosks);
    if (messages.length) return messages.join(' ');
  }
  return err.message || 'Une erreur est survenue, réessayez.';
}

/** Une ligne par borne vue pour l'événement. */
export function kioskStatusLines(kiosks) {
  if (!Array.isArray(kiosks)) return [];
  return kiosks.map((k) => {
    const label = typeof k?.label === 'string' && k.label.trim() ? k.label.trim() : 'Borne';
    const seen = dateTime(k?.last_seen_at);
    const seenText = seen ? `, vue le ${seen}` : '';
    const n = Number(k?.pending_uploads) || 0;
    switch (k?.state) {
      case 'ok':
        return { label, state: 'ok', text: `Tout est envoyé${seenText}` };
      case 'pending':
        return { label, state: 'pending', text: `${n} élément${n > 1 ? 's' : ''} en attente${seenText}` };
      case 'unknown':
        return { label, state: 'unknown', text: `N’a pas encore indiqué si tout est envoyé${seenText}` };
      default:
        return { label, state: 'not_seen', text: seen ? `Pas connectée depuis l’événement (vue le ${seen})` : 'Pas connectée depuis l’événement' };
    }
  });
}

/**
 * « Envoyer » : possible si le bilan est préparé, sans blocage, et que rien n'est en cours.
 * `reasons` : messages à afficher sous le bouton désactivé.
 */
export function sendState(prepared, { busy = false } = {}) {
  if (!prepared?.report) return { canSend: false, reasons: [] };
  const reasons = blockerMessages(prepared.blockers, prepared.kiosks);
  return { canSend: !busy && reasons.length === 0, reasons };
}

/** Lien public du bilan. */
export function reportLink(appUrl, token) {
  return token ? `${String(appUrl ?? '').replace(/\/$/, '')}/rapport/${token}` : '';
}

/** Statut du bilan pour l'en-tête de la carte. */
export function reportStatus(report) {
  const status = report?.status;
  if (status === 'sent') {
    const parts = [];
    const sent = datePlain(report.sent_at);
    if (sent) parts.push(`Envoyé le ${sent}`);
    const frozen = frozenLabel(report.frozen_at);
    if (frozen) parts.push(frozen);
    const expires = datePlain(report.expires_at);
    if (expires) parts.push(`lien valable jusqu’au ${expires}`);
    return { tone: 'sent', label: 'Envoyé', detail: parts.join(' · ') };
  }
  if (status === 'revoked') return { tone: 'revoked', label: 'Lien coupé', detail: 'Un nouvel envoi crée un nouveau lien.' };
  if (status === 'draft') return { tone: 'draft', label: 'Brouillon', detail: 'Pas encore envoyé au client.' };
  return { tone: 'none', label: '', detail: '' };
}

/** Bilan de l'aperçu : la vraie réponse de la RPC, avec les photos choisies dans la carte. */
export function previewReport(report, photos, selectedIds) {
  if (!report) return null;
  const byId = new Map((Array.isArray(photos) ? photos : []).map((p) => [p.id, p]));
  const chosen = (Array.isArray(selectedIds) ? selectedIds : [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, url: p.photo_url, thumbnail_url: p.thumbnail_url ?? null }));
  return { ...report, photos: chosen };
}
