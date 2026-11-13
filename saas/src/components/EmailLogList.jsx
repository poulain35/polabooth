import { useState } from 'react';
import { emailTypeLabel, formatEmailDate, isProblemStatus } from '../lib/emailTracking';
import EmailStatusBadge from './EmailStatusBadge';
import EmailDetailDialog from './EmailDetailDialog';

/**
 * Liste compacte des emails d'une fiche (lead ou événement) : type, date, statut ; un clic ouvre le
 * détail. `onUpdated(log)` reçoit la ligne resynchronisée pour mettre la liste à jour.
 */
export default function EmailLogList({ logs, onUpdated, className = '' }) {
  const [selected, setSelected] = useState(null);

  return (
    <>
      <div className={`space-y-1 ${className}`}>
        {logs.map((log) => (
          <button
            key={log.id}
            type="button"
            onClick={() => setSelected(log)}
            className={`w-full flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 -mx-2 text-left text-xs transition-colors ${
              isProblemStatus(log.status) ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'}`}
          >
            <span className="text-gray-600 truncate">
              {emailTypeLabel(log.type)} · {formatEmailDate(log.sent_at, false)}
            </span>
            <EmailStatusBadge status={log.status} />
          </button>
        ))}
      </div>
      <EmailDetailDialog
        emailLogId={selected?.id ?? null}
        initialLog={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        onUpdated={onUpdated}
        hideContextLink
      />
    </>
  );
}
