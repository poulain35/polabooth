// Lien « Suivre ma réservation » des emails de l'événement (spec suivi-client-reservation, D8 et D9).
// Code ouvert : n'importe rien de _shared/modules/. La demande (`leads`, module privé booking) est lue
// comme une table quelconque : absente de la version ouverte, la lecture échoue et il n'y a pas de lien.
// La forme du lien reprend celle de la page de réservation : `${PUBLIC_APP_URL ?? APP_URL}/reservation/:token`.
// Sans import Deno/esm.sh : testé par client-tracking.test.ts sous `node --test`.

import { publicAppUrl } from './app-url.ts';
import { type FeaturesDb, isFeatureEnabled } from './features.ts';

export interface ClientTrackingOptions {
  /** Adresse du front (tests) ; par défaut PUBLIC_APP_URL, sinon APP_URL, comme la page de réservation. */
  appUrl?: string;
}

/**
 * Lien de suivi de la réservation pour un événement, ou `null` : événement créé à la main (aucune
 * demande avec jeton), fonctionnalité `booking` coupée pour l'organisation, table `leads` absente
 * (version ouverte), adresse du front inconnue ou lecture en échec. Ne lève jamais : un email part
 * toujours, avec ou sans lien.
 */
export async function clientTrackingUrl(
  db: FeaturesDb, eventId: string | null | undefined, opts: ClientTrackingOptions = {},
): Promise<string | null> {
  if (!eventId) return null;
  try {
    // Demande la plus récente convertie en cet événement, avec un jeton.
    const { data: lead, error: leadErr } = await db.from('leads')
      .select('booking_token')
      .eq('converted_event_id', eventId)
      .not('booking_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadErr || typeof lead?.booking_token !== 'string' || !lead.booking_token) return null;

    // Fonctionnalité booking de l'organisation de l'événement (catalogue ouvert, features.ts).
    const { data: event, error: eventErr } = await db.from('events').select('org_id').eq('id', eventId).maybeSingle();
    if (eventErr || !event?.org_id) return null;
    const { data: org, error: orgErr } = await db.from('organizations').select('features').eq('id', event.org_id).maybeSingle();
    if (orgErr || !org || !isFeatureEnabled(org.features, 'booking')) return null;

    const base = (opts.appUrl ?? publicAppUrl()).replace(/\/+$/, '');
    if (!base) return null;
    return `${base}/reservation/${encodeURIComponent(lead.booking_token)}`;
  } catch (e) {
    console.warn('Lien de suivi de la réservation indisponible :', e instanceof Error ? e.message : e);
    return null;
  }
}
