// Marque de l'instance (open core L7) pour les pages qui s'affichent sans organisation chargée :
// connexion, accueil, éditeur client, pages publiques. Le code ouvert ne contient aucune marque :
// les valeurs viennent du fichier privé src/modules/brand.js s'il est installé, sinon des valeurs
// neutres ci-dessous (construction ouverte : VITE_PRIVATE_MODULES=none, voir vite.config.js).
// Un champ vide fait disparaître ce qui en dépend (logo → nom en texte, site → pas de lien…).
import installed from '../modules/brand.js';

const NEUTRAL_BRAND = Object.freeze({
  name: 'Photobooth',
  tagline: '',
  city: '',
  phone: '',
  phoneHref: '',
  email: '',
  site: '',
  legal: '',
  logoHorizontal: '',
  logoSquare: '',
});

/** Marque installée par-dessus les valeurs neutres (seules les chaînes non vides sont reprises). */
function resolveBrand(brand) {
  const out = { ...NEUTRAL_BRAND };
  if (brand && typeof brand === 'object') {
    for (const key of Object.keys(NEUTRAL_BRAND)) {
      if (typeof brand[key] === 'string' && brand[key].trim()) out[key] = brand[key].trim();
    }
  }
  return Object.freeze(out);
}

export const BRAND = resolveBrand(installed);

/** Adresse du site sans protocole (libellé de lien), '' sans site. */
export const siteLabel = (site = BRAND.site) => String(site || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
