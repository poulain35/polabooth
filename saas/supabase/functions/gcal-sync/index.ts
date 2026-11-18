/**
 * gcal-sync — synchronise un événement SaaS vers Google Calendar (LAB-29, fonctionnalité
 * google_calendar, ouverte).
 *
 * Reçoit { event_id } et crée (insert), met à jour (patch) ou supprime l'événement correspondant
 * dans Google Calendar (couleur Tomate). L'ID Google est stocké dans events.gcal_event_id pour rester
 * idempotent (pas de doublon). Corps et logique : _shared/gcal-event.ts.
 *
 * Réservation en ligne active pour l'org (module privé booking) : l'appel est confié à
 * booking-gcal-sync, qui reprend les infos et l'id Google du lead relié (open core, lot L3b).
 *
 * Auth Google : OAuth2 refresh token (compatible compte Google perso), dans Paramètres > Clés ou
 * en secrets d'edge functions (jamais côté client) : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REFRESH_TOKEN (scope https://www.googleapis.com/auth/calendar.events) ; agenda dans
 * Paramètres (google_calendar_id) ou GOOGLE_CALENDAR_ID (ex. "primary").
 *
 * Dégradation propre : si un secret manque, répond 200 { skipped: true } sans planter.
 */

import { corsResponse, handleCors } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { requireServiceOrOrgAdmin, resolveOrgId, type OrgResource } from '../_shared/admin-guard.ts';
import { isFeatureEnabled, requireFeature } from '../_shared/features.ts';
import { GCAL_NOT_CONFIGURED, gcalDeps, syncEventGcal } from '../_shared/gcal-event.ts';
import type { FetchLike } from '../_shared/gcal-slots.ts';
import { publicAppUrl } from '../_shared/app-url.ts';

const APP_URL = publicAppUrl()
  .replace(/\/+$/, '');

/** Confie l'appel au module de réservation (service_role) et renvoie sa réponse telle quelle. */
async function delegateToBooking(eventId: string): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return corsResponse(500, { error: 'Configuration Supabase absente.' });
  try {
    const res = await fetch(`${url}/functions/v1/booking-gcal-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ event_id: eventId }),
    });
    return corsResponse(res.status, await res.json().catch(() => ({})));
  } catch (e) {
    console.error('gcal-sync : booking-gcal-sync injoignable', eventId, e);
    return corsResponse(502, { error: 'booking-gcal-sync injoignable.' });
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let eventId: string | null = null;
  try {
    const payload = await req.json();
    eventId = typeof payload?.event_id === 'string' ? payload.event_id : null;
  } catch {
    return corsResponse(400, { error: 'Corps JSON invalide.' });
  }
  if (!eventId) return corsResponse(400, { error: 'event_id requis.' });

  const db = adminClient();
  // Appel interne (service_role) ou admin propriétaire de l'org de l'événement.
  const resource: OrgResource = { kind: 'event', id: eventId };
  const access = await requireServiceOrOrgAdmin(
    req.headers.get('Authorization'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), sessionUser, db, resource,
  );
  if (access.response) return access.response;
  const { orgId } = await resolveOrgId(db, resource);
  if (orgId) {
    const disabled = await requireFeature(db, orgId, 'google_calendar');
    if (disabled) return disabled;
    const { data: org } = await db.from('organizations').select('features').eq('id', orgId).maybeSingle();
    if (isFeatureEnabled(org?.features, 'booking')) return await delegateToBooking(eventId);
  }

  const deps = await gcalDeps(db, orgId, APP_URL, fetch as unknown as FetchLike);
  const outcome = deps ? await syncEventGcal(deps, eventId) : GCAL_NOT_CONFIGURED;
  return corsResponse(outcome.status, outcome.body);
});
