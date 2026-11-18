// Erreurs graves de la borne pendant un événement (LAB-329) — logique pure, aucune I/O (node --test + Deno).
//
// Lu dans kiosk_logs (niveau error), pas dans l'état du battement de cœur. Ouvert/résolu avec
// hystérésis : ouverture sur un plantage dans les 30 dernières minutes, ou au moins N erreurs
// d'appareil photo en 15 minutes ; résolution après 30 minutes sans aucune de ces erreurs.

import { escapeHtml } from '../_shared/email-layout.ts';
import { KIOSK_ERRORS_QUIET_MIN, offlineAfterMinutes, type AlertCandidate } from './evaluate.ts';

/** Fenêtre de comptage des erreurs d'appareil photo (min). */
const KIOSK_ERRORS_CAMERA_WINDOW_MIN = 15;
const KIOSK_ERRORS_DEFAULT_CAMERA_THRESHOLD = 5;
/** La soirée continue après minuit : l'événement reste en cours jusqu'à 6 h (Paris) le lendemain de la fin. */
const EVENT_NIGHT_END_HOUR = 6;

/**
 * Contextes d'un plantage, écrits par les gestionnaires globaux de App.xaml.cs : `ui` (exception du fil
 * d'affichage, retour à un écran sûr) et `task` (tâche non observée) arrivent dans kiosk_logs tout de suite.
 * `app` (exception non gérée, arrêt du processus) et `ui-recovery` passent par fatal.log : la borne les
 * recopie au redémarrage, à leur heure d'origine (LAB-332).
 */
const CRASH_CONTEXTS = ['app', 'task', 'ui', 'ui-recovery'];

export interface KioskLogRow {
  machine_id: string;
  event_id: string | null;
  level: string;
  context: string | null;
  message: string | null;
  occurred_at: string;
}

export interface KioskEventRow {
  id: string;
  name: string | null;
  org_id?: string | null;
  photobooth_id?: string | null;
  status?: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface KioskLicenseRow {
  id: string;
  machine_id: string;
  label?: string | null;
  last_seen_at: string | null;
}

export interface OpenKioskErrorsAlert {
  id: string;
  event_id: string | null;
  machine_id: string | null;
}

export const isCrashLog = (l: KioskLogRow) => l.level === 'error' && CRASH_CONTEXTS.includes(l.context ?? '');

/** `camera` (prise de vue, appareil non détecté) et `camera-evt` (événements Canon), niveau error. */
export const isCameraErrorLog = (l: KioskLogRow) =>
  l.level === 'error' && /^camera(-|$)/.test(l.context ?? '');

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});
const PARIS_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });
const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

const parisDay = (ms: number) => PARIS_DAY.format(new Date(ms));
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Événement en cours : du jour (Paris) de début au jour de fin, et jusqu'à 6 h le lendemain de la fin.
 * Au jour près, car les heures saisies ne disent pas la durée réelle (début = fin à midi, souvent).
 * Une seule date : elle vaut pour les deux. Sans date, ou archivé : pas en cours.
 */
export function isEventInProgress(ev: Pick<KioskEventRow, 'status' | 'start_date' | 'end_date'>, now: number): boolean {
  if (ev.status === 'archived') return false;
  const start = Date.parse(ev.start_date ?? ev.end_date ?? '');
  const end = Date.parse(ev.end_date ?? ev.start_date ?? '');
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const today = parisDay(now);
  const last = parisDay(end);
  if (today >= parisDay(start) && today <= last) return true;
  return today === nextDay(last) && Number(PARIS_HOUR.format(new Date(now))) < EVENT_NIGHT_END_HOUR;
}

/** Seuil d'erreurs d'appareil photo en 15 min : réglage `kiosk_errors.camera_errors`, 1 à 50, 5 par défaut. */
export function cameraErrorThreshold(cfg: Record<string, any>): number {
  const n = Math.round(Number(cfg.kiosk_errors?.camera_errors));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : KIOSK_ERRORS_DEFAULT_CAMERA_THRESHOLD;
}

/** Texte brut d'un détail HTML (base, webhook) : balises retirées, entités d'escapeHtml rendues. */
export function detailText(html: string): string {
  return html.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function lastLine(logs: KioskLogRow[]): string {
  const last = logs.reduce((a, b) => (Date.parse(b.occurred_at) > Date.parse(a.occurred_at) ? b : a));
  const msg = (last.message ?? '').trim();
  const short = msg.length > 200 ? `${msg.slice(0, 199)}…` : msg;
  return `Dernière à ${PARIS_TIME.format(new Date(last.occurred_at))}${short ? ` : « ${escapeHtml(short)} »` : ''}.`;
}

/** Alerte d'une borne pour un événement, ou null. `logs` : journaux de cette borne pour cet événement. */
export function evaluateKioskErrors(p: {
  cfg: Record<string, any>;
  eventName: string;
  machineName: string;
  logs: KioskLogRow[];
  now: number;
}): AlertCandidate | null {
  const within = (l: KioskLogRow, min: number) => {
    const t = Date.parse(l.occurred_at);
    return !Number.isNaN(t) && p.now - t <= min * 60_000;
  };
  const crashes = p.logs.filter((l) => isCrashLog(l) && within(l, KIOSK_ERRORS_QUIET_MIN));
  const camera = p.logs.filter((l) => isCameraErrorLog(l) && within(l, KIOSK_ERRORS_CAMERA_WINDOW_MIN));
  const cameraHit = camera.length >= cameraErrorThreshold(p.cfg);
  if (!crashes.length && !cameraHit) return null;

  const machine = `<strong>${escapeHtml(p.machineName)}</strong>`;
  const parts: string[] = [];
  if (crashes.length) {
    const s = crashes.length > 1 ? 's' : '';
    parts.push(`L'application de la borne ${machine} a planté (${crashes.length} erreur${s} grave${s} `
      + `en ${KIOSK_ERRORS_QUIET_MIN} min). ${lastLine(crashes)}`);
  }
  if (cameraHit) {
    parts.push(`${crashes.length ? 'Elle' : `La borne ${machine}`} a eu <strong>${camera.length} erreurs `
      + `d'appareil photo</strong> en ${KIOSK_ERRORS_CAMERA_WINDOW_MIN} min. ${lastLine(camera)}`);
  }
  parts.push('Vérifiez que les invités peuvent toujours prendre des photos.');

  return {
    type: 'kiosk_errors',
    subject: `🚨 ${crashes.length ? 'Plantage de la borne' : "Erreurs d'appareil photo"} — ${p.eventName}`,
    heading: '🚨 Erreurs graves sur la borne',
    detail: parts.join(' '),
    color: '#ef4444',
  };
}

export interface KioskErrorsPlan {
  open: { eventId: string; eventName: string; machineId: string; machineName: string; candidate: AlertCandidate }[];
  resolve: { alertId: string; eventId: string | null; eventName: string; machineId: string | null; machineName: string }[];
}

/**
 * Plan d'une organisation : alertes kiosk_errors à ouvrir et à résoudre.
 *
 * Un journal compte pour son `event_id` (rempli par la borne dès qu'un événement est chargé) ; sans
 * event_id, pour l'événement en cours assigné à la borne (`photobooth_id`) ; sinon il est ignoré
 * (borne hors événement). L'événement doit être de l'organisation ou assigné à la borne : une borne
 * ne fait pas lire le nom de l'événement d'un autre compte. Ouverture seulement si le type est activé,
 * l'événement en cours et aucune alerte déjà ouverte pour (événement, borne). Résolution après
 * KIOSK_ERRORS_QUIET_MIN sans erreur, sauf si la borne ne répond plus pendant l'événement : son
 * silence ne dit pas qu'elle va bien (c'est machine_offline qui prévient).
 */
export function planKioskErrors(p: {
  cfg: Record<string, any>;
  orgId: string;
  licenses: KioskLicenseRow[];
  events: KioskEventRow[];
  logs: KioskLogRow[];
  openAlerts: OpenKioskErrorsAlert[];
  now: number;
}): KioskErrorsPlan {
  const plan: KioskErrorsPlan = { open: [], resolve: [] };
  const licenseByMachine = new Map(p.licenses.map((l) => [l.machine_id, l]));
  const eventById = new Map(p.events.map((e) => [e.id, e]));
  const nameOf = (l: KioskLicenseRow | undefined, machineId: string | null) => l?.label || machineId || '—';

  const assignedInProgress = new Map<string, string>();
  for (const e of [...p.events].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))) {
    if (!e.photobooth_id || assignedInProgress.has(e.photobooth_id) || !isEventInProgress(e, p.now)) continue;
    assignedInProgress.set(e.photobooth_id, e.id);
  }

  const groups = new Map<string, { ev: KioskEventRow; lic: KioskLicenseRow; logs: KioskLogRow[] }>();
  for (const log of p.logs) {
    if (!isCrashLog(log) && !isCameraErrorLog(log)) continue;
    const t = Date.parse(log.occurred_at);
    if (Number.isNaN(t) || p.now - t > KIOSK_ERRORS_QUIET_MIN * 60_000) continue;
    const lic = licenseByMachine.get(log.machine_id);
    if (!lic) continue;
    const eventId = log.event_id ?? assignedInProgress.get(lic.id);
    const ev = eventId ? eventById.get(eventId) : undefined;
    if (!ev || (ev.org_id !== p.orgId && ev.photobooth_id !== lic.id)) continue;
    const key = `${ev.id}|${lic.machine_id}`;
    const g = groups.get(key) ?? { ev, lic, logs: [] };
    g.logs.push(log);
    groups.set(key, g);
  }

  const openKeys = new Set(p.openAlerts.map((a) => `${a.event_id}|${a.machine_id}`));

  if (p.cfg.kiosk_errors?.enabled) {
    for (const [key, { ev, lic, logs }] of groups) {
      if (openKeys.has(key) || !isEventInProgress(ev, p.now)) continue;
      const machineName = nameOf(lic, lic.machine_id);
      const eventName = ev.name || '—';
      const candidate = evaluateKioskErrors({ cfg: p.cfg, eventName, machineName, logs, now: p.now });
      if (candidate) plan.open.push({ eventId: ev.id, eventName, machineId: lic.machine_id, machineName, candidate });
    }
  }

  for (const a of p.openAlerts) {
    if (groups.has(`${a.event_id}|${a.machine_id}`)) continue;
    const ev = a.event_id ? eventById.get(a.event_id) : undefined;
    const lic = a.machine_id ? licenseByMachine.get(a.machine_id) : undefined;
    const lastSeen = lic?.last_seen_at ? Date.parse(lic.last_seen_at) : 0;
    const silent = !lastSeen || p.now - lastSeen > offlineAfterMinutes(p.cfg) * 60_000;
    if (lic && ev && silent && isEventInProgress(ev, p.now)) continue;
    plan.resolve.push({
      alertId: a.id, eventId: a.event_id, eventName: ev?.name || '—',
      machineId: a.machine_id, machineName: nameOf(lic, a.machine_id),
    });
  }
  return plan;
}

/** Page Kiosks de l'admin, sur les journaux de l'événement (`?event=<id>`). */
export function kioskLogsUrl(appUrl: string, eventId: string | null): string {
  return `${appUrl}/admin/bornes${eventId ? `?event=${encodeURIComponent(eventId)}` : ''}`;
}
