import { emailBadgeMeta } from '../lib/emailTracking';

/** Badge du statut de suivi d'un email (email_logs.status), partagé par toutes les vues admin. En SMTP : suivi indisponible. */
export default function EmailStatusBadge({ status, className = '' }) {
  const s = emailBadgeMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap shrink-0 ${s.cls} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}
