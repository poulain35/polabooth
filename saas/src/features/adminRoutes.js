// Adresses de l'admin (refonte de la navigation, LAB-335).
// Logique pure, testée dans adminRoutes.test.js. Spec : docs/specs/refonte-navigation-admin.md.

export const ADMIN_HOME = '/admin/aujourdhui';

/** Onglets de « Demandes et devis » (`/admin/ventes?tab=`), fournis par les modules (`sales.tabs`). */
export const SALES_TABS = ['demandes', 'devis', 'prospects'];

/**
 * Onglets de la page Bornes (`/admin/bornes?tab=`), LAB-338. Alertes : fonctionnalité kiosk_alerts ;
 * code : admin de la plateforme seulement. Une alerte précise : `?tab=alertes&alerte=<id>`.
 * materiel : stock de matériel par type (LAB-358), fonctionnalité du socle.
 */
export const BORNES_TABS = ['etat', 'materiel', 'ecrans', 'alertes', 'code', 'versions'];

/** Onglets définitifs de la fiche de l'événement (`/admin/events/:id?tab=`), posés au lot 3. */
export const EVENT_TABS = ['resume', 'creation', 'borne', 'jour-j', 'livraison'];

/**
 * Sections de la page Réglages (`/admin/reglages#…`), dans l'ordre du sommaire (LAB-338).
 * « offres » n'apparaît qu'avec un module qui remplit l'emplacement `settings.sections` ;
 * « galerie » qu'avec la galerie et la réservation, ou avec le bilan client.
 */
export const SETTINGS_SECTIONS = [
  { id: 'entreprise', label: 'Entreprise' },
  { id: 'offres', label: 'Offres et réservation' },
  { id: 'emails', label: 'Emails aux clients' },
  { id: 'editeur', label: 'Éditeur du client' },
  { id: 'galerie', label: 'Galerie et bilan' },
  { id: 'fonctionnalites', label: 'Fonctionnalités' },
  { id: 'services', label: 'Services connectés' },
];

/** Recompose une adresse : `params` remplace ces clés de `search`, `hash` (s'il est donné) le fragment. */
export function withParams(pathname, search = '', hash = '', params = {}, newHash) {
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') query.delete(key);
    else query.set(key, value);
  }
  const qs = query.toString();
  const rawHash = newHash != null ? newHash : String(hash ?? '').replace(/^#/, '');
  return `${pathname}${qs ? `?${qs}` : ''}${rawHash ? `#${rawHash}` : ''}`;
}

/** Onglet demandé s'il fait partie de `available`, sinon le premier disponible (ou null). */
export function pickTab(requested, available) {
  if (!Array.isArray(available) || available.length === 0) return null;
  return available.includes(requested) ? requested : available[0];
}
