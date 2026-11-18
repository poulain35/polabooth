// Logique pure d'évaluation des alertes parc kiosk — aucune I/O, testable (node --test + Deno).
// Alertes matériel (battement de cœur, imprimante, appareil photo, quota, papier) et messages de
// résolution ; erreurs graves de la borne lues dans ses journaux (LAB-329) : kiosk-errors.ts.

export type AlertType = 'machine_offline' | 'printer_problem' | 'print_quota_near' | 'paper_low' | 'camera_problem'
  | 'kiosk_errors';

export interface AlertCandidate {
  type: AlertType;
  subject: string;
  heading: string;
  detail: string;
  color: string;
}

const PRINTER_BAD = ['paper_out', 'paper_jam', 'error', 'offline', 'not_found'];

const PRINTER_LABEL: Record<string, string> = {
  paper_out: 'plus de papier',
  paper_jam: 'bourrage papier',
  error:     'en erreur',
  offline:   'hors ligne',
  not_found: 'introuvable',
};

export interface AlertInputs {
  cfg: Record<string, any>;
  eventName: string;
  machineName: string;
  lastSeenAt: string | null;
  printerStatus: string | null;
  cameraStatus?: string | null; // kiosk_licenses.camera_status : 'ok' | 'disconnected' | null (jamais dit)
  maxPrints: number | null;   // quota événement (null = pas de quota)
  printsUsed: number;         // copies imprimées pour l'événement
  paperCapacity: number | null;
  paperUsed: number;          // copies depuis le dernier rechargement
  now: number;                // Date.now()
}

/** Délai (min) au-delà duquel la machine est considérée hors ligne (réglage de machine_offline). */
export function offlineAfterMinutes(cfg: Record<string, any>): number {
  return Number(cfg.machine_offline?.after_minutes ?? 10);
}

/** La machine a-t-elle donné signe de vie dans le délai de machine_offline ? */
function seenRecently(inp: AlertInputs): boolean {
  const lastSeen = inp.lastSeenAt ? new Date(inp.lastSeenAt).getTime() : 0;
  return !!lastSeen && (inp.now - lastSeen) <= offlineAfterMinutes(inp.cfg) * 60_000;
}

/**
 * Types dont l'état est inconnu en ce moment : une alerte ouverte n'est ni relancée ni résolue.
 * camera_problem : appareil signalé débranché mais machine hors ligne. L'état de l'appareil est
 * figé au dernier battement de cœur ; c'est machine_offline qui prévient, et l'alerte appareil
 * photo ne doit pas être résolue à tort (« Appareil photo OK ») tant que la borne ne répond pas.
 */
export function heldAlertTypes(inp: AlertInputs): AlertType[] {
  if (inp.cfg.camera_problem?.enabled && inp.cameraStatus === 'disconnected' && !seenRecently(inp)) {
    return ['camera_problem'];
  }
  return [];
}

/** Renvoie les alertes actuellement déclenchées pour une machine d'un événement en cours. */
export function evaluateAlerts(inp: AlertInputs): AlertCandidate[] {
  const { cfg, eventName, machineName, lastSeenAt, printerStatus, maxPrints, printsUsed, paperCapacity, paperUsed, now } = inp;
  const out: AlertCandidate[] = [];

  // a) Machine hors ligne
  if (cfg.machine_offline?.enabled) {
    const afterMin = offlineAfterMinutes(cfg);
    const lastSeen = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    if (!lastSeen || (now - lastSeen) > afterMin * 60_000) {
      const ago = lastSeen ? `${Math.round((now - lastSeen) / 60_000)} min` : 'jamais vue';
      out.push({
        type: 'machine_offline',
        subject: `⚠️ Machine hors ligne — ${eventName}`,
        heading: '⚠️ Machine hors ligne',
        detail: `La machine <strong>${machineName}</strong> ne donne plus de signe de vie (dernier contact : ${ago}) alors que l'événement est en cours.`,
        color: '#ef4444',
      });
    }
  }

  // b) Problème imprimante
  if (cfg.printer_problem?.enabled && printerStatus && PRINTER_BAD.includes(printerStatus)) {
    const label = PRINTER_LABEL[printerStatus] ?? printerStatus;
    out.push({
      type: 'printer_problem',
      subject: `🖨️ Imprimante ${label} — ${eventName}`,
      heading: '🖨️ Problème imprimante',
      detail: `L'imprimante de la machine <strong>${machineName}</strong> est signalée <strong>${label}</strong>.`,
      color: '#ef4444',
    });
  }

  // b bis) Appareil photo débranché (LAB-263). Seulement si la machine a été vue récemment :
  // sinon c'est machine_offline qui prévient, et l'état de l'appareil n'est plus à jour.
  if (cfg.camera_problem?.enabled && inp.cameraStatus === 'disconnected' && seenRecently(inp)) {
    out.push({
      type: 'camera_problem',
      subject: `📷 Appareil photo débranché — ${eventName}`,
      heading: '📷 Problème appareil photo',
      detail: `L'appareil photo de la machine <strong>${machineName}</strong> n'est pas détecté. Les invités voient l'écran « Problème technique » et ne peuvent pas prendre de photo.`,
      color: '#ef4444',
    });
  }

  // c) Quota d'impressions proche de la limite
  if (cfg.print_quota_near?.enabled && maxPrints) {
    const pct = Math.round((printsUsed / maxPrints) * 100);
    const threshold = Number(cfg.print_quota_near.threshold_pct ?? 90);
    if (pct >= threshold) {
      out.push({
        type: 'print_quota_near',
        subject: `📉 Quota d'impressions à ${pct}% — ${eventName}`,
        heading: '📉 Quota d\'impressions presque atteint',
        detail: `Le quota d'impressions de l'événement est à <strong>${printsUsed}/${maxPrints}</strong> (${pct}%). Pensez à recharger le consommable.`,
        color: '#f59e0b',
      });
    }
  }

  // d) Papier bientôt vide (estimation : capacité rouleau − tirages depuis rechargement)
  if (cfg.paper_low?.enabled && paperCapacity) {
    const remaining = Math.max(0, paperCapacity - paperUsed);
    const remPct = Math.round((remaining / paperCapacity) * 100);
    const threshold = Number(cfg.paper_low.threshold_pct ?? 10);
    if (remPct <= threshold) {
      out.push({
        type: 'paper_low',
        subject: `🧻 Papier bientôt épuisé (≈ ${remaining}) — ${eventName}`,
        heading: '🧻 Stock papier bas',
        detail: `Il reste environ <strong>${remaining}</strong> tirages sur la machine <strong>${machineName}</strong> (${remPct}% du rouleau). Prévoyez un rechargement.`,
        color: '#f59e0b',
      });
    }
  }

  return out;
}

/** Délai sans nouvelle erreur avant « rentré dans l'ordre » (min) ; aussi fenêtre d'un plantage (kiosk-errors.ts). */
export const KIOSK_ERRORS_QUIET_MIN = 30;

/** Messages de résolution (problème rentré dans l'ordre). */
export const RESOLVE: Record<AlertType, { subject: string; heading: string; detail: (m: string) => string }> = {
  machine_offline: {
    subject: '✅ Machine de nouveau en ligne',
    heading: '✅ Machine de retour',
    detail: (m) => `La machine <strong>${m}</strong> a renvoyé un signal : elle est de nouveau en ligne.`,
  },
  printer_problem: {
    subject: '✅ Imprimante OK',
    heading: '✅ Imprimante opérationnelle',
    detail: (m) => `L'imprimante de la machine <strong>${m}</strong> est de nouveau opérationnelle.`,
  },
  print_quota_near: {
    subject: '✅ Quota d\'impressions de nouveau sous le seuil',
    heading: '✅ Quota revenu sous le seuil',
    detail: (m) => `Le quota d'impressions de la machine <strong>${m}</strong> est repassé sous le seuil d'alerte.`,
  },
  camera_problem: {
    subject: '✅ Appareil photo OK',
    heading: '✅ Appareil photo opérationnel',
    detail: (m) => `L'appareil photo de la machine <strong>${m}</strong> est de nouveau détecté : les invités peuvent reprendre des photos.`,
  },
  kiosk_errors: {
    subject: "✅ Plus d'erreur sur la borne",
    heading: '✅ Borne revenue à la normale',
    detail: (m) => `Aucune nouvelle erreur grave sur la borne <strong>${m}</strong> depuis ${KIOSK_ERRORS_QUIET_MIN} minutes.`,
  },
  paper_low: {
    subject: '✅ Papier rechargé',
    heading: '✅ Stock papier rétabli',
    detail: (m) => `Le stock de papier de la machine <strong>${m}</strong> est de nouveau au-dessus du seuil (rouleau rechargé).`,
  },
};
