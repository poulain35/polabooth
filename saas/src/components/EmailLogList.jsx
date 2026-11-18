import { useState } from 'react';
import { emailTypeLabel, formatEmailDate } from '../lib/emailTracking';
import { cn } from '../lib/utils';
import EmailStatusBadge from './EmailStatusBadge';
import EmailDetailDialog from './EmailDetailDialog';

/**
 * Liste compacte des emails d'une fiche (lead ou événement) : type, date, statut ; un clic ouvre le
 * détail. `onUpdated(log)` reçoit la ligne resynchronisée pour mettre la liste à jour.
 * Un email en échec se repère à sa pastille (rouge ou ambre, avec son libellé).
 */
export default function EmailLogList({ logs, onUpdated, className = '' }) {
  const [selected, setSelected] = useState(null);

  return (
    <>
      <div className={cn('flex flex-col gap-1', className)}>
        {logs.map((log) => (
          <button
            key={log.id}
            type="button"
            onClick={() => setSelected(log)}
            className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate text-muted-foreground">
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
