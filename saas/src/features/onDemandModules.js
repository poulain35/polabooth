// Modules sur demande (LAB-422, spec open-core-version-allegee A4) : les fonctionnalités privées dont le
// module n'est pas installé, listées dans Réglages › Fonctionnalités avec un lien pour en parler.
import { FEATURES } from './catalog.js';
import { buildVendorMailto } from '../lib/vendorRequest.js';

/** Fonctionnalités privées (hors socle) absentes de `installed` (ensemble des id de modules installés). */
export function onDemandModules(installed, features = FEATURES) {
  return features.filter((f) => !f.core && f.visibility === 'private' && !installed.has(f.id));
}

/** Lien mailto « Contactez-moi pour en parler » d'un module sur demande. */
export function moduleRequestMailto(feature, { origin = '', version = '' } = {}) {
  return buildVendorMailto({ tool: feature.label, message: '', topic: `module:${feature.id}`, origin, version });
}
