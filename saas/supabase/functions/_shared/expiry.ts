/**
 * Règles d'expiration des accès client.
 *
 * - Lien du modèle (template) : expire automatiquement à la fin de l'événement
 *   (fin du jour de `end_date`). Aucune date stockée dédiée.
 * - Liens photos & audio : expirent à `events.expires_at` (par défaut fin + 2 mois,
 *   modifiable dans l'admin).
 */

/** Le lien du modèle est-il expiré ? Basé sur la fin de l'événement. */
export function templateLinkExpired(endDate: string | null | undefined): boolean {
  if (!endDate) return false;
  const deadline = new Date(endDate);
  deadline.setHours(23, 59, 59, 999);
  return deadline < new Date();
}

/** Expiration par défaut des liens photos & audio : fin d'événement + 2 mois. */
export function defaultMediaExpiry(endDate: string | null | undefined): string | null {
  if (!endDate) return null;
  const d = new Date(endDate);
  d.setMonth(d.getMonth() + 2);
  return d.toISOString();
}
