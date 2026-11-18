// Sections de la page Réglages affichées selon les fonctionnalités (LAB-338).
import { moduleSlot } from '../../../features/modules';

/** Vrai si un module installé et disponible remplit l'emplacement `settings.sections`. */
export function hasOfferSettings(isAvailable) {
  return moduleSlot('settings.sections').some((item) => isAvailable(item.feature));
}

/** Réglages visibles de la carte « Galerie et bilan » : bandeau (galerie et réservation) et bilan client. */
export function galleryCardFlags(isAvailable) {
  return {
    showBanner: isAvailable('gallery') && isAvailable('booking'),
    showReport: isAvailable('event_report'),
  };
}
