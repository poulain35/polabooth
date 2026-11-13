// Logo de la société (LAB-257) : envoyé dans Paramètres > Entreprise, affiché sur
// l'accueil de la borne. Règles pures (pas de réseau ni de DOM), testées dans orgLogo.test.js.

export const ORG_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Types acceptés et extension du fichier rangé dans kiosk-backgrounds/org/{org_id}/. Pas de SVG. */
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const LOGO_EXTENSIONS = { png: 'png', jpg: 'jpg', jpeg: 'jpg' };

/** Extension du fichier logo (png ou jpg), ou null si le format n'est pas accepté. */
export function orgLogoExtension(file) {
  if (!file) return null;
  if (file.type) return LOGO_TYPES[file.type] ?? null;
  const ext = String(file.name ?? '').split('.').pop().toLowerCase();
  return LOGO_EXTENSIONS[ext] ?? null;
}

/** Message d'erreur à montrer à l'admin, ou null si le fichier est accepté. */
export function orgLogoProblem(file) {
  if (!file) return 'Aucun fichier choisi.';
  if (!orgLogoExtension(file)) {
    return 'Format non accepté : choisissez une image PNG ou JPG (pas de SVG). '
      + 'Un PNG à fond transparent rend le mieux sur la borne.';
  }
  if (file.size > ORG_LOGO_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return `Image trop lourde (${mb} Mo) : 2 Mo au maximum. Réduisez sa taille et réessayez.`;
  }
  return null;
}

/** Chemin du logo dans le bucket kiosk-backgrounds. */
export function orgLogoPath(orgId, ext) {
  return `org/${orgId}/logo.${ext}`;
}

/** Chemins possibles du logo d'une société, pour le supprimer quel que soit son format. */
export function orgLogoPaths(orgId) {
  return [orgLogoPath(orgId, 'png'), orgLogoPath(orgId, 'jpg')];
}

/**
 * URL enregistrée dans organizations.logo_url. Un nouvel envoi garde le même chemin : le paramètre
 * v change l'URL pour que la borne (cache par URL) et le navigateur reprennent la nouvelle image.
 */
export function orgLogoUrl(publicUrl, version) {
  return `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}v=${version}`;
}
