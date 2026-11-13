// Lecture publique d'un événement par code d'accès (LAB-112).
// La clé anon n'a plus de SELECT sur `events` : les pages publiques passent par la RPC
// SECURITY DEFINER `get_public_event(p_code)`, qui ne renvoie que { id, name, company, gallery },
// plus (LAB-130) `booking_banner` (booléen du réglage de l'org) et `event_type` (type du lead converti).

export const PUBLIC_EVENT_RPC = 'get_public_event';

/** Normalise la réponse de la RPC (null si code inconnu ou événement archivé). */
export function parsePublicEvent(data) {
  if (!data || typeof data !== 'object' || !data.id) return null;
  return {
    event: { id: data.id, name: data.name ?? '' },
    companyName: data.company ?? '',
    gallery: data.gallery && typeof data.gallery === 'object' ? data.gallery : {},
    // Absent tant que la migration LAB-130 n'est pas appliquée : bandeau affiché, sans utm_campaign.
    bookingBanner: data.booking_banner !== false,
    eventType: typeof data.event_type === 'string' ? data.event_type : '',
  };
}
