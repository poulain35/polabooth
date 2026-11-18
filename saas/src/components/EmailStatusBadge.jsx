import { emailBadgeMeta } from '../lib/emailTracking';
import { StatusPill } from './ui/status-pill';

/** Pastille du statut de suivi d'un email (email_logs.status), partagée par toutes les vues admin. En SMTP : suivi indisponible. */
export default function EmailStatusBadge({ status, className }) {
  // Sans suivi (SMTP), seule l'erreur d'envoi garde son statut : le reste affiche « suivi indisponible » en gris.
  // Le ton vient de `lib/emailTracking` ; un statut inconnu reste gris.
  const meta = emailBadgeMeta(status);
  return <StatusPill tone={meta.tone} className={className}>{meta.label}</StatusPill>;
}
