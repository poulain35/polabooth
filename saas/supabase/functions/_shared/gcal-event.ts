// Événement Google Agenda d'un événement SaaS (LAB-29, fonctionnalité google_calendar, ouverte).
// La réservation en ligne (privée) s'y branche par `GcalEventLinkFinder` : elle fournit le corps,
// l'état et l'id Google du lead relié (_shared/modules/booking/gcal-booking.ts, fonction booking-gcal-sync).
// Sans import Deno ni esm.sh : fetch, client Supabase et jeton Google sont injectés (testé sous `node --test`).

import { syncSlotCalendar, type FetchLike } from './gcal-slots.ts';
import { serviceSecrets } from './service-secrets.ts';
import { getServiceSetting, type SettingsDb } from './secrets.ts';

/** Couleur « Tomate » de Google Agenda : celle des prestations historiques. */
export const GCAL_PRESTATION_COLOR = '11';
export const GCAL_TIME_ZONE = 'Europe/Paris';
const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const EVENT_GCAL_COLUMNS = 'id, name, client_name, access_code, start_date, end_date, photobooth_id, gcal_event_id';

export interface EventForGcal {
  id: string;
  name?: string | null;
  client_name?: string | null;
  access_code?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  photobooth_id?: string | null;
  gcal_event_id?: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);

/** Event SaaS sans réservation en ligne (créé à la main, ou devis legacy) : couleur Tomate, horaires. */
export function buildEventGcalBody(ev: EventForGcal, opts: { appUrl: string; boothName?: string | null }): Record<string, unknown> {
  const lines: string[] = [];
  if (ev.client_name) lines.push(`Client : ${ev.client_name}`);
  if (opts.boothName) lines.push(`Borne assignée : ${opts.boothName}`);
  if (ev.access_code) {
    lines.push(`Code d'accès : ${ev.access_code}`);
    lines.push(`Éditeur : ${opts.appUrl}/e/${ev.access_code}`);
  }
  return {
    summary: text(ev.name) ?? `Événement ${ev.access_code ?? ''}`.trim(),
    description: lines.join('\n'),
    colorId: GCAL_PRESTATION_COLOR,
    start: { dateTime: ev.start_date, timeZone: GCAL_TIME_ZONE },
    end: { dateTime: ev.end_date || ev.start_date, timeZone: GCAL_TIME_ZONE },
  };
}

// ── Synchronisation ──────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface GcalDb { from(table: string): any }

export interface GcalSyncDeps {
  db: GcalDb;
  calendarId: string;
  /** Jeton OAuth Google, demandé seulement si un appel Google est nécessaire. */
  getToken: () => Promise<string>;
  fetchImpl: FetchLike;
  apiBase?: string;
  appUrl: string;
}

export interface GcalSyncOutcome {
  status: number;
  body: Record<string, unknown>;
}

export const gcalFail = (status: number, error: string): GcalSyncOutcome => ({ status, body: { error } });
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Crée, met à jour ou supprime (`body` null) l'événement Google ; une erreur devient un 502. */
export async function pushToGoogle(
  d: GcalSyncDeps, gcalEventId: string | null, body: Record<string, unknown> | null,
): Promise<{ action: string; gcalEventId: string | null } | GcalSyncOutcome> {
  let accessToken: string;
  try {
    accessToken = await d.getToken();
  } catch (e) {
    return gcalFail(502, errorText(e, 'OAuth Google échoué.'));
  }
  try {
    return await syncSlotCalendar({
      calendarId: d.calendarId, accessToken, gcalEventId, cancelled: body === null, body,
      fetchImpl: d.fetchImpl, apiBase: d.apiBase,
    });
  } catch (e) {
    return gcalFail(502, errorText(e, 'Google Calendar indisponible.'));
  }
}

async function boothNameOf(db: GcalDb, photoboothId: string | null | undefined): Promise<string | null> {
  if (!photoboothId) return null;
  const { data } = await db.from('kiosk_licenses').select('label, machine_id').eq('id', photoboothId).maybeSingle();
  return data ? (data.label || data.machine_id || null) : null;
}

/**
 * Ligne reliée à l'event qui pilote son événement Google (réservation en ligne, module privé) :
 * corps, état actif, id Google déjà connu (repris si l'event n'en a pas : jamais de doublon) et
 * enregistrement de l'id sur cette ligne.
 */
export interface GcalEventLink {
  active: boolean;
  gcalEventId: string | null;
  body(ev: EventForGcal, boothName: string | null): Record<string, unknown> | null;
  saveGcalEventId(id: string | null): Promise<void>;
}

export type GcalEventLinkFinder = (db: GcalDb, eventId: string) => Promise<GcalEventLink | null>;

/** Event SaaS → événement Google. Sans lien : corps de l'event ; avec lien : celui de la ligne reliée. */
export async function syncEventGcal(d: GcalSyncDeps, eventId: string, findLink?: GcalEventLinkFinder): Promise<GcalSyncOutcome> {
  const { data: ev, error } = await d.db.from('events').select(EVENT_GCAL_COLUMNS).eq('id', eventId).maybeSingle();
  if (error) {
    console.error('gcal : lecture de l’événement', eventId, error);
    return gcalFail(500, 'Lecture de l’événement impossible.');
  }
  if (!ev) return gcalFail(404, 'Événement introuvable.');

  const link = findLink ? await findLink(d.db, eventId) : null;
  const current: string | null = ev.gcal_event_id ?? link?.gcalEventId ?? null;

  let body: Record<string, unknown> | null = null;
  if (link && !link.active) {
    if (!current) return { status: 200, body: { ok: true, gcal_event_id: null, action: 'none' } };
  } else {
    const boothName = await boothNameOf(d.db, ev.photobooth_id);
    body = link
      ? link.body(ev, boothName)
      : ev.start_date ? buildEventGcalBody(ev, { appUrl: d.appUrl, boothName }) : null;
    if (!body) return { status: 200, body: { skipped: true, reason: 'Événement sans date de début.' } };
  }

  const r = await pushToGoogle(d, current, body);
  if ('status' in r) return r;
  if (r.gcalEventId !== ev.gcal_event_id) await d.db.from('events').update({ gcal_event_id: r.gcalEventId }).eq('id', ev.id);
  if (link && r.gcalEventId !== link.gcalEventId) await link.saveGcalEventId(r.gcalEventId);
  return { status: 200, body: { ok: true, gcal_event_id: r.gcalEventId, action: r.action } };
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Échange le refresh token contre un access token OAuth2. */
async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth Google échoué : ${data.error_description || data.error || res.status}`);
  }
  return data.access_token as string;
}

/**
 * Dépendances de synchro : clés Google de Paramètres > Clés (sinon secrets d'edge functions, lot L6b)
 * et agenda de l'org. `null` si l'une manque : la fonction répond { skipped } sans planter.
 */
export async function gcalDeps(
  db: GcalDb & SettingsDb, orgId: string | null, appUrl: string, fetchImpl: FetchLike,
): Promise<GcalSyncDeps | null> {
  const google = await serviceSecrets(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
  const clientId = google.GOOGLE_CLIENT_ID;
  const clientSecret = google.GOOGLE_CLIENT_SECRET;
  const refreshToken = google.GOOGLE_REFRESH_TOKEN;
  const calendarId = await getServiceSetting(db, orgId, 'google_calendar_id', 'GOOGLE_CALENDAR_ID');
  if (!clientId || !clientSecret || !refreshToken || !calendarId) return null;
  return {
    db, calendarId, fetchImpl, apiBase: GCAL_API_BASE, appUrl,
    getToken: () => getAccessToken(clientId, clientSecret, refreshToken, fetchImpl),
  };
}

export const GCAL_NOT_CONFIGURED: GcalSyncOutcome = { status: 200, body: { skipped: true, reason: 'Credentials Google non configurés.' } };
