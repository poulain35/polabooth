// Alertes des bornes (LAB-338) : logique pure de l'onglet Alertes de la page Bornes
// (`pages/admin/bornes/AlertsTab.jsx`). Réglages (`organizations.alert_config`), libellés,
// alertes ouvertes et résolues, adresse d'une alerte précise. Testé dans kioskAlerts.test.js.

/** Réglages par défaut des alertes (`organizations.alert_config`). */
export const ALERT_DEFAULT = {
  enabled: false,
  recipient_email: '',
  machine_offline:  { enabled: false, after_minutes: 10 },
  printer_problem:  { enabled: false },
  camera_problem:   { enabled: false },
  print_quota_near: { enabled: false, threshold_pct: 90 },
  paper_low:        { enabled: false, threshold_pct: 10 },
  kiosk_errors:     { enabled: false, camera_errors: 5 },
};

/** Types d'alerte, dans l'ordre de l'écran. */
export const ALERT_TYPES = ['machine_offline', 'printer_problem', 'camera_problem', 'print_quota_near', 'paper_low', 'kiosk_errors'];

/** Nom court de chaque type d'alerte (mêmes mots que la cloche des notifications). */
const ALERT_LABELS = {
  machine_offline:  'Borne hors ligne',
  printer_problem:  'Problème imprimante',
  camera_problem:   'Appareil photo débranché',
  print_quota_near: "Quota d'impressions",
  paper_low:        'Papier bientôt vide',
  kiosk_errors:     'Erreurs sur la borne',
};

export const alertLabel = (type) => ALERT_LABELS[type] ?? type ?? 'Alerte';

/** Réglages enregistrés fusionnés avec les valeurs par défaut, type par type. */
export function alertConfigForm(saved) {
  const cfg = saved && typeof saved === 'object' ? saved : {};
  const form = { ...ALERT_DEFAULT, ...cfg };
  for (const type of ALERT_TYPES) form[type] = { ...ALERT_DEFAULT[type], ...(cfg[type] ?? {}) };
  return form;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paramètre `alerte` de l'adresse : identifiant d'alerte valide (minuscules) ou null. */
export function parseAlertParam(value) {
  const id = String(value ?? '').trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** Adresse de l'onglet Alertes, sur une alerte précise si `alertId` est donné. */
export function alertsTabHref(alertId) {
  const id = parseAlertParam(alertId);
  return id ? `/admin/bornes?tab=alertes&alerte=${id}` : '/admin/bornes?tab=alertes';
}

/** Journaux des bornes (onglet Alertes), filtrés sur un événement si `eventId` est donné. */
export function kioskLogsHref(eventId) {
  const id = String(eventId ?? '').trim();
  return id ? `/admin/bornes?tab=alertes&event=${encodeURIComponent(id)}` : '/admin/bornes?tab=alertes';
}

/** Durée pendant laquelle une alerte résolue reste affichée. */
export const RESOLVED_DAYS = 7;

/**
 * Alertes ouvertes (non résolues), puis résolues depuis moins de `days` jours, les plus récentes
 * d'abord. L'alerte visée par l'adresse (`keepId`) est toujours gardée, même plus ancienne.
 */
export function splitAlerts(alerts, { now = new Date(), days = RESOLVED_DAYS, keepId = null } = {}) {
  const limit = new Date(now).getTime() - days * 86_400_000;
  const byDate = [...(alerts ?? [])].sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  const open = byDate.filter((a) => !a.resolved_at);
  const resolved = byDate.filter((a) => a.resolved_at
    && (new Date(a.resolved_at).getTime() >= limit || a.id === keepId));
  return { open, resolved };
}

/** Liens utiles d'une alerte : l'événement (onglet Jour J) et, pour les erreurs, les journaux. */
export function alertLinks(alert) {
  const links = [];
  if (alert?.event_id) {
    const id = encodeURIComponent(alert.event_id);
    links.push({ label: "Voir l'événement", to: `/admin/events/${id}?tab=jour-j` });
    if (alert.alert_type === 'kiosk_errors') links.push({ label: 'Voir les journaux', to: kioskLogsHref(alert.event_id) });
  }
  return links;
}

/**
 * Texte brut du détail d'une alerte (`kiosk_alerts.detail`, écrit en HTML par check-kiosk-alerts) :
 * balises retirées, entités rendues, comme `detailText` côté serveur.
 */
export function alertDetailText(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Nom de la borne d'une alerte, d'après les bornes connues (machine_id). */
export function alertMachineName(alert, licenses) {
  const lic = (licenses ?? []).find((l) => l.machine_id && l.machine_id === alert?.machine_id);
  if (lic) return lic.label || lic.machine_name || 'Borne sans nom';
  return alert?.machine_id ? 'Borne inconnue' : 'Borne';
}
