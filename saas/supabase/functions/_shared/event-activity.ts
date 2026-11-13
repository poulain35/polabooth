// LAB-232 (spec LAB-209, SAAS-1) : compteurs event_activity écrits par les edge functions
// (service_role). Une ligne ne contient que event_id, kind et photo_id : ni adresse, ni IP, ni
// identifiant d'invité. Sans import Deno/esm.sh : testé par event-activity-lab232.test.ts.
//
// Une erreur d'écriture ne fait jamais échouer l'envoi d'e-mail ni l'affichage de la galerie :
// recordEventActivity ne lève jamais.

export const QR_VIA = 'qr';

// Code Postgres d'un doublon : index unique event_activity_qr_open_photo_key (une ouverture par
// QR code comptée par photo, migration 20261130000000).
export const UNIQUE_VIOLATION = '23505';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type EventActivity =
  | { event_id: string; kind: 'kiosk_email' }
  | { event_id: string; kind: 'qr_open'; photo_id: string };

export type ActivityResult = 'recorded' | 'duplicate' | 'failed' | 'skipped';

// deno-lint-ignore no-explicit-any
export interface ActivityDb { from(table: string): any }

/** E-mail compté seulement si Brevo l'a accepté (messageId) : rien sans clé Brevo ni hors allowlist. */
export function kioskEmailActivity(eventId: string, messageId: string | null | undefined): EventActivity | null {
  if (!eventId || typeof messageId !== 'string' || messageId === '') return null;
  return { event_id: eventId, kind: 'kiosk_email' };
}

/**
 * Ouverture par QR code : lien `?photo={id}&via=qr` (QR de la borne) et photo de l'événement.
 * Sans `via=qr` (galerie, diaporama, lien partagé), rien n'est compté.
 */
export function qrOpenActivity(
  eventId: string,
  params: URLSearchParams,
  eventPhotoIds: Iterable<string>,
): EventActivity | null {
  if (!eventId || params.get('via') !== QR_VIA) return null;
  const photo = params.get('photo')?.trim().toLowerCase() ?? '';
  if (!UUID_RE.test(photo)) return null;
  for (const id of eventPhotoIds) {
    if (typeof id === 'string' && id.toLowerCase() === photo) return { event_id: eventId, kind: 'qr_open', photo_id: id };
  }
  return null;
}

export async function recordEventActivity(db: ActivityDb, activity: EventActivity | null): Promise<ActivityResult> {
  if (!activity) return 'skipped';
  try {
    const { error } = await db.from('event_activity').insert(activity);
    if (!error) return 'recorded';
    if (error.code === UNIQUE_VIOLATION) return 'duplicate';
    console.warn(`event_activity : ${activity.kind} non enregistré (${error.code ?? 'erreur'})`);
    return 'failed';
  } catch {
    console.warn(`event_activity : ${activity.kind} non enregistré`);
    return 'failed';
  }
}

/**
 * Envoi d'un e-mail de la borne puis comptage. `send` lève si Brevo refuse : rien n'est compté et
 * l'erreur remonte telle quelle. Un échec d'écriture du compteur ne change pas le résultat de l'envoi.
 */
export async function sendKioskEmailAndCount(
  db: ActivityDb,
  eventId: string,
  send: () => Promise<string | null>,
): Promise<string | null> {
  const messageId = await send();
  await recordEventActivity(db, kioskEmailActivity(eventId, messageId));
  return messageId;
}
