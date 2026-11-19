// LAB-429 (spec docs/specs/reglages-appareil-photo.md) : réglages de l'appareil photo d'une borne depuis le SaaS.
// Règles pures de la carte « Appareil photo » : état du rapport de la borne (kiosk_licenses.camera_report),
// listes proposées, brouillon, valeurs changées, avertissement du flash et suivi de la demande
// (kiosk_licenses.camera_request). Le serveur ne connaît pas les codes Canon : il garde ceux que la borne
// propose (D9) ; seuls les libellés envoyés par la borne sont affichés.
import { isKioskOffline } from './kioskEventPush.js';

/** Réglages dans l'ordre d'affichage (D1). La température n'apparaît qu'avec la balance « Température de couleur ». */
export const CAMERA_SETTINGS = [
  { key: 'tv', label: 'Vitesse' },
  { key: 'av', label: 'Ouverture' },
  { key: 'iso', label: 'ISO' },
  { key: 'wb', label: 'Balance des blancs' },
  { key: 'kelvin', label: 'Température' },
];

/** Code Canon de la balance des blancs « Température de couleur » (kEdsWhiteBalance_ColorTemp). */
export const WB_COLOR_TEMPERATURE = 9;

/** Vitesse de synchronisation du flash du R100 (D8) : au-delà, bande noire possible. */
export const FLASH_SYNC_DENOMINATOR = 200;

export const FLASH_WARNING = 'Plus rapide que 1/200 : le flash risque de ne couvrir qu\'une partie de la photo.';
export const NO_REPORT_MESSAGE = 'La borne n\'a pas encore envoyé les réglages de son appareil photo.';
export const NO_REPORT_HINT = 'Ils arrivent au prochain signal de la borne (toutes les 2 minutes), avec un appareil Canon branché et une version de la borne à jour.';
export const UNSUPPORTED_MESSAGE = 'Réglages disponibles avec un appareil Canon.';
export const OFFLINE_HINT = 'Borne hors ligne : appliqué à son retour.';

const KEYS = CAMERA_SETTINGS.map(s => s.key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCode = (v) => typeof v === 'number' && Number.isFinite(v);

/** Options valides d'un réglage : [{ code, label }] dont le code est un nombre. */
function optionsOf(report, key) {
  const list = report?.options?.[key];
  if (!Array.isArray(list)) return [];
  return list
    .filter(o => isObject(o) && isCode(o.code))
    .map(o => ({ code: o.code, label: typeof o.label === 'string' && o.label ? o.label : String(o.code) }));
}

/** Libellé d'un code dans la liste de la borne, ou null. */
export function optionLabel(report, key, code) {
  if (!isCode(code)) return null;
  return optionsOf(report, key).find(o => o.code === code)?.label ?? null;
}

/** Message de la molette pas sur M (même texte que le refus du serveur). */
export function lockedMessage(mode) {
  return mode
    ? `Molette de l'appareil sur ${mode} : mettez-la sur M pour changer les réglages.`
    : 'Mettez la molette de l\'appareil sur M pour changer les réglages.';
}

/**
 * État de la carte d'après le rapport de la borne :
 * - none        : rien reçu (borne ancienne, appareil débranché, jamais connectée) ;
 * - unsupported : webcam ou caméra simulée (`supported: false`, D10) ;
 * - ready       : réglages lus ; `locked` si la molette n'est pas sur M (D3).
 */
export function cameraPanel(lic) {
  const report = isObject(lic?.camera_report) ? lic.camera_report : null;
  if (!report) return { kind: 'none' };
  if (report.supported === false) return { kind: 'unsupported', model: report.model ?? null };
  const hasOptions = KEYS.some(k => optionsOf(report, k).length > 0);
  if (!hasOptions) return { kind: 'none' };
  const locked = report.settable !== true;
  return {
    kind: 'ready',
    report,
    model: typeof report.model === 'string' ? report.model : null,
    mode: typeof report.mode === 'string' && report.mode ? report.mode : null,
    locked,
    lockedMessage: locked ? lockedMessage(report.mode) : null,
    receivedAt: report.received_at ?? report.at ?? null,
  };
}

/** Valeurs actuelles de l'appareil (codes), clés inconnues retirées. */
export function currentValues(report) {
  const values = isObject(report?.values) ? report.values : {};
  return Object.fromEntries(KEYS.filter(k => isCode(values[k])).map(k => [k, values[k]]));
}

/** La température se règle seulement avec la balance « Température de couleur » et une liste reçue. */
function kelvinVisible(report, wb) {
  return wb === WB_COLOR_TEMPERATURE && optionsOf(report, 'kelvin').length > 0;
}

/**
 * Réglages à afficher pour ce brouillon : [{ key, label, options, value, valueLabel }].
 * Un réglage sans liste est retiré ; la température suit la balance du brouillon.
 */
export function visibleSettings(report, draft = {}) {
  const values = { ...currentValues(report), ...draft };
  return CAMERA_SETTINGS
    .filter(s => s.key !== 'kelvin' || kelvinVisible(report, values.wb))
    .map(s => ({ ...s, options: optionsOf(report, s.key) }))
    .filter(s => s.options.length > 0)
    .map(s => {
      const value = isCode(values[s.key]) ? values[s.key] : null;
      return { ...s, value, valueLabel: optionLabel(report, s.key, value) };
    });
}

/** Résumé d'une ligne : « 1/125 · 5,6 · ISO 400 · Lumière du jour » (valeurs inconnues omises). */
export function valuesSummary(report, values = currentValues(report)) {
  const parts = [];
  for (const { key } of CAMERA_SETTINGS) {
    if (key === 'kelvin' && values.wb !== WB_COLOR_TEMPERATURE) continue;
    const label = optionLabel(report, key, values[key]);
    if (!label) continue;
    parts.push(key === 'iso' ? `ISO ${label}` : label);
  }
  return parts.join(' · ');
}

/** Brouillon de départ : valeurs de l'appareil, et celles d'une demande pas encore appliquée par-dessus. */
export function initialDraft(report, request) {
  const base = currentValues(report);
  const status = request?.status;
  if ((status === 'pending' || status === 'received') && isObject(request.values)) {
    for (const k of KEYS) if (isCode(request.values[k])) base[k] = request.values[k];
  }
  return base;
}

/**
 * Valeurs à envoyer : celles du brouillon qui diffèrent de l'appareil et figurent dans sa liste.
 * La température n'est envoyée qu'avec la balance « Température de couleur ».
 */
export function changedValues(report, draft = {}) {
  const current = currentValues(report);
  const wb = isCode(draft.wb) ? draft.wb : current.wb;
  const out = {};
  for (const k of KEYS) {
    const v = draft[k];
    if (!isCode(v) || v === current[k]) continue;
    if (k === 'kelvin' && !kelvinVisible(report, wb)) continue;
    if (!optionsOf(report, k).some(o => o.code === v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Dénominateur d'une vitesse « 1/250 » → 250 ; null pour une pose en secondes (« 0"5 », « 30" ») ou un
 * libellé inconnu.
 */
export function shutterDenominator(label) {
  const m = /^\s*1\s*\/\s*(\d+)\s*$/.exec(String(label ?? ''));
  return m ? Number(m[1]) : null;
}

/** Avertissement du flash pour ce libellé de vitesse (D8), ou null. */
export function flashWarning(tvLabel) {
  const d = shutterDenominator(tvLabel);
  return d !== null && d > FLASH_SYNC_DENOMINATOR ? FLASH_WARNING : null;
}

/** Heure « HH:MM » en français (fuseau du navigateur, ou celui donné pour les tests). */
function hhmm(iso, timeZone) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(d);
}

/**
 * Suivi de la dernière demande (D6) :
 * { state: none | pending | received | applied | refused, message, hint, tone, values, result }.
 * Borne hors ligne (plus de 10 min sans signal) et demande pas encore appliquée : « appliqué à son retour ».
 */
export function cameraRequestStatus(lic, { now = Date.now(), timeZone } = {}) {
  const req = isObject(lic?.camera_request) ? lic.camera_request : null;
  const state = req?.status;
  if (!req || !['pending', 'received', 'applied', 'refused'].includes(state)) {
    return { state: 'none', message: null, hint: null, tone: null };
  }
  const offline = isKioskOffline(lic, now);
  const waiting = state === 'pending' || state === 'received';
  const base = {
    state,
    values: isObject(req.values) ? req.values : {},
    result: isObject(req.result) ? req.result : null,
    hint: waiting && offline ? OFFLINE_HINT : null,
  };
  switch (state) {
    case 'pending':
      return { ...base, tone: 'amber', message: `Demandé à ${hhmm(req.requested_at, timeZone)} : en attente de la borne` };
    case 'received':
      return {
        ...base,
        tone: 'amber',
        message: `Reçu par la borne à ${hhmm(req.received_at, timeZone)} : appliqué dès son retour à l'accueil`,
      };
    case 'applied':
      return { ...base, tone: 'green', message: `Appliqué à ${hhmm(req.applied_at, timeZone)} ✓` };
    default:
      return { ...base, tone: 'red', message: `Refusé : ${req.error || 'sans détail'}` };
  }
}
