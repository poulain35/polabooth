// LAB-245 : envoyer l'événement sur la borne depuis le SaaS (fiche de l'événement, page Licences).
// État affiché d'un envoi, à partir des colonnes event_push_* de kiosk_licenses, et listes de choix.

/** Au-delà de ce délai sans signal (heartbeat toutes les 2 min), la borne est considérée hors ligne. */
export const KIOSK_OFFLINE_AFTER_MS = 10 * 60 * 1000;

export const EVENT_PUSH_OFFLINE_MESSAGE = "Borne hors ligne : l'événement sera chargé à son prochain démarrage.";

/** LAB-246 : la borne en ligne lit l'envoi toutes les 20 s sur l'accueil ou la saisie du code. */
export const EVENT_PUSH_SOON_MESSAGE = 'La borne va le charger dans les prochaines secondes';

const PUSHABLE_STATUSES = ['active', 'submitted'];

const time = (iso) => (iso ? new Date(iso).getTime() : NaN);

/** Nom affiché d'une borne. */
export function kioskLabel(lic) {
  return lic?.label || lic?.machine_name || 'Borne sans nom';
}

/** Borne sans signal depuis plus de 10 min (ou jamais vue). */
export function isKioskOffline(lic, now = Date.now()) {
  const seen = time(lic?.last_seen_at);
  return Number.isNaN(seen) || now - seen > KIOSK_OFFLINE_AFTER_MS;
}

/**
 * État de l'envoi en cours sur une borne :
 * - none      : aucun envoi ;
 * - requested : envoyé, pas encore lu par la borne ;
 * - received  : lu par la borne, chargé au premier écran sans séance invité ;
 * - applied   : affiché sur la borne ;
 * - failed    : la borne n'a pas pu charger l'événement (raison dans error).
 * offline : borne sans signal depuis plus de 10 min.
 */
export function eventPushStatus(lic, now = Date.now()) {
  const offline = isKioskOffline(lic, now);
  const eventId = lic?.event_push_id ?? null;
  const requestedAt = lic?.event_push_requested_at ?? null;
  if (!eventId || !requestedAt) return { state: 'none', offline };

  const base = {
    eventId,
    requestedAt,
    receivedAt: lic.event_push_received_at ?? null,
    appliedAt: lic.event_push_applied_at ?? null,
    error: lic.event_push_error ?? null,
    offline,
  };
  if (base.appliedAt) return { ...base, state: 'applied' };
  if (base.error) return { ...base, state: 'failed' };
  if (base.receivedAt) return { ...base, state: 'received' };
  return { ...base, state: 'requested' };
}

/** Heure « HH:MM » en français (fuseau du navigateur, ou celui donné pour les tests). */
export function formatPushTime(iso, timeZone) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

/** Phrase d'état d'un envoi, ou null sans envoi. */
export function eventPushMessage(status, timeZone) {
  switch (status?.state) {
    case 'requested':
      return `Envoyé à ${formatPushTime(status.requestedAt, timeZone)} — en attente de la borne`;
    case 'received':
      return `Reçu par la borne à ${formatPushTime(status.receivedAt, timeZone)}`;
    case 'applied':
      return `Affiché sur la borne à ${formatPushTime(status.appliedAt, timeZone)} ✓`;
    case 'failed':
      return `La borne n'a pas pu charger l'événement : ${status.error}`;
    default:
      return null;
  }
}

/**
 * Précision sous l'état d'un envoi pas encore chargé, ou null :
 * - borne hors ligne : chargé au prochain démarrage ;
 * - borne en ligne, envoi pas encore lu : chargé dans les prochaines secondes (lecture toutes les 20 s).
 * Reçu par une borne en ligne : la borne attend la fin de la séance invité, pas de précision.
 */
export function eventPushHint(status) {
  if (status?.state !== 'requested' && status?.state !== 'received') return null;
  if (status.offline) return EVENT_PUSH_OFFLINE_MESSAGE;
  return status.state === 'requested' ? EVENT_PUSH_SOON_MESSAGE : null;
}

/** Annulation possible tant que la borne n'a pas affiché l'événement. */
export function canCancelEventPush(status) {
  return status?.state === 'requested' || status?.state === 'received' || status?.state === 'failed';
}

/**
 * Envoi de cet événement sur cette borne. Si la borne attend un autre événement, otherPending
 * l'indique (le nouvel envoi le remplacera) et l'état affiché est « none ».
 */
export function eventPushStatusFor(lic, eventId, now = Date.now()) {
  const status = eventPushStatus(lic, now);
  if (status.state === 'none' || status.eventId === eventId) return { ...status, otherPending: false };
  const otherPending = status.state === 'requested' || status.state === 'received';
  return { state: 'none', offline: status.offline, otherPending };
}

/**
 * Choix du « Photobooth assigné » : bornes non retirées, plus la borne déjà assignée même retirée
 * (sinon la liste affiche un choix vide), marquée « (retirée) ».
 */
export function kioskChoices(licenses, selectedId) {
  return (licenses ?? [])
    .filter((lic) => !lic.retired_at || lic.id === selectedId)
    .map((lic) => ({
      id: lic.id,
      label: lic.retired_at ? `${kioskLabel(lic)} (retirée)` : kioskLabel(lic),
      retired: !!lic.retired_at,
    }));
}

/** Bornes sur lesquelles on peut envoyer un événement de ce compte : actives, non retirées. */
export function pushableKiosks(licenses, orgId) {
  return (licenses ?? []).filter((lic) => !lic.retired_at && lic.is_active && lic.org_id === orgId);
}

/** Borne proposée par défaut : celle assignée à l'événement si possible, sinon la seule du compte. */
export function defaultPushKiosk(kiosks, photoboothId) {
  if (photoboothId && kiosks.some((k) => k.id === photoboothId)) return photoboothId;
  return kiosks.length === 1 ? kiosks[0].id : '';
}

/**
 * Événements qu'on peut envoyer sur cette borne : même compte, en cours (active, submitted).
 * Ceux assignés à la borne d'abord, puis par date de début (sans date à la fin).
 */
export function pushableEvents(events, orgId, licenseId) {
  const start = (ev) => {
    const t = time(ev.start_date);
    return Number.isNaN(t) ? Infinity : t;
  };
  return (events ?? [])
    .filter((ev) => ev.org_id === orgId && PUSHABLE_STATUSES.includes(ev.status))
    .sort((a, b) => {
      const pa = a.photobooth_id === licenseId ? 0 : 1;
      const pb = b.photobooth_id === licenseId ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const d = start(a) - start(b);
      return Number.isNaN(d) ? 0 : d;
    });
}

/** Événement qu'on peut envoyer (pas archivé). */
export function isEventPushable(ev) {
  return PUSHABLE_STATUSES.includes(ev?.status);
}
