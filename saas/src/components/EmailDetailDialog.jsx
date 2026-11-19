import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { getEmailEvents, getEmailLog, syncEmailLog } from '../lib/supabase';
import {
  EMAIL_CONTEXT_KIND_LABELS, SMTP_TRACKING_LABEL, buildEmailTimeline, emailContextLink, emailStatusMeta, emailTypeLabel, formatEmailDate,
  isTrackingAvailable, noTrackingMessage, syncErrorMessage,
} from '../lib/emailTracking';
import { INSTALLED_MODULES } from '../features/modules';
import EmailStatusBadge from './EmailStatusBadge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Spinner } from './ui/spinner';
import { Notice } from './admin/CardParts';
import { useCopy } from '../hooks/useCopy';

// Point de la frise : même couleur que la pastille du statut correspondant.
const DOT = {
  sent: 'bg-state-gray-fg',
  delivered: 'bg-state-navy-fg',
  opened: 'bg-state-orange-fg',
  click: 'bg-state-green-fg',
};

// Encadré neutre « pas de suivi » : fond muted plutôt que le gris des états (rendu d'origine).
const MUTED_NOTICE = 'bg-muted text-muted-foreground';
const LINK = 'font-medium text-primary-ink hover:underline';

/**
 * Détail d'un email (LAB-124) : message-id Brevo, frise des événements, resynchronisation.
 * En SMTP (lot S2) : ni identifiant Brevo, ni frise, ni resynchronisation ; le motif d'un refus reste affiché.
 * `initialLog` (ligne déjà chargée) s'affiche aussitôt ; `onUpdated(log)` reçoit la ligne à jour.
 */
export default function EmailDetailDialog({ emailLogId, initialLog = null, open, onOpenChange, onUpdated, hideContextLink = false }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
        {emailLogId && (
          <EmailDetail
            key={emailLogId}
            emailLogId={emailLogId}
            initialLog={initialLog}
            onClose={() => onOpenChange(false)}
            onUpdated={onUpdated}
            hideContextLink={hideContextLink}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Monté à chaque ouverture (Radix démonte le contenu du Dialog à la fermeture) : état neuf.
function EmailDetail({ emailLogId, initialLog, onClose, onUpdated, hideContextLink }) {
  const [log, setLog] = useState(initialLog);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null); // { ok: boolean, text }
  const { copied, copy } = useCopy();

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEmailLog(emailLogId), getEmailEvents(emailLogId)])
      .then(([row, evs]) => {
        if (cancelled) return;
        if (row) setLog(row);
        else setError('Cet email est introuvable.');
        setEvents(evs);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [emailLogId]);

  async function handleCopy() {
    if (await copy(log.provider_message_id)) return;
    setSyncMsg({ ok: false, text: 'Copie impossible : sélectionnez l\'identifiant à la main.' });
    setTimeout(() => setSyncMsg(null), 3000);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await syncEmailLog(emailLogId);
      const [row, evs] = await Promise.all([getEmailLog(emailLogId), getEmailEvents(emailLogId)]);
      if (row) {
        setLog(row);
        onUpdated?.(row);
      }
      setEvents(evs);
      setSyncMsg({ ok: true, text: 'Suivi mis à jour depuis Brevo.' });
      setTimeout(() => setSyncMsg(null), 2000);
    } catch (e) {
      setSyncMsg({ ok: false, text: syncErrorMessage(e) });
      setTimeout(() => setSyncMsg(null), e?.status === 429 ? 6000 : 3000);
    } finally {
      setSyncing(false);
    }
  }

  const timeline = log ? buildEmailTimeline(log, events) : [];
  const status = log ? emailStatusMeta(log.status) : null;
  const context = !hideContextLink && log ? emailContextLink(log, INSTALLED_MODULES) : null;
  const hasMessageId = Boolean(log?.provider_message_id);
  const tracking = isTrackingAvailable();
  // Refus Brevo à l'envoi : le motif est intégré au message « aucun suivi » (pas de doublon).
  const rejectedAtSend = tracking && !hasMessageId && log?.status === 'error';

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6">{log ? emailTypeLabel(log.type) : 'Email'}</DialogTitle>
        <DialogDescription className="truncate">
          {log?.subject || 'Objet non enregistré'}
        </DialogDescription>
      </DialogHeader>

      {!log && loading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <Notice role="alert" tone="red">{error}</Notice>}

      {log && (
        <div className="flex min-w-0 flex-col gap-5 text-sm">
          {/* Résumé */}
          <dl className="grid grid-cols-[auto,minmax(0,1fr)] items-center gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Statut</dt>
            <dd><EmailStatusBadge status={log.status} /></dd>
            <dt className="text-muted-foreground">Destinataire</dt>
            <dd className="break-all text-foreground">{log.recipient}</dd>
            <dt className="text-muted-foreground">Envoyé le</dt>
            <dd className="text-foreground">{formatEmailDate(log.sent_at)}</dd>
            {context && (
              <>
                <dt className="text-muted-foreground">{EMAIL_CONTEXT_KIND_LABELS[context.kind] ?? 'Fiche'}</dt>
                <dd>
                  <Link to={context.to} className={`inline-flex items-center gap-1 ${LINK}`} onClick={onClose}>
                    {context.label}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </dd>
              </>
            )}
          </dl>

          {/* Motif d'échec (refus Brevo à l'envoi, rebond, blocage…) */}
          {log.error_reason && !rejectedAtSend && (
            <Notice as="div" tone={status?.problem ? 'red' : 'amber'}>
              <p className="font-medium">Motif</p>
              <p className="break-words">{log.error_reason}</p>
            </Notice>
          )}

          {!tracking && (
            <Notice className={MUTED_NOTICE}>
              {SMTP_TRACKING_LABEL} : la réception, les ouvertures et les clics ne sont pas suivis.
            </Notice>
          )}

          {tracking && (<>
          {/* Identifiant Brevo */}
          <div>
            <p className="mb-1.5 text-muted-foreground">Identifiant du message Brevo</p>
            {hasMessageId ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-2 text-xs text-foreground" title={log.provider_message_id}>
                  {log.provider_message_id}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopy} aria-label="Copier l'identifiant Brevo">
                  {copied ? <Check className="text-state-green-fg" /> : <Copy />}
                  {copied ? 'Copié' : 'Copier'}
                </Button>
              </div>
            ) : (
              <Notice tone={rejectedAtSend ? 'red' : 'gray'} className={rejectedAtSend ? 'break-words' : `break-words ${MUTED_NOTICE}`}>
                {noTrackingMessage(log)}
              </Notice>
            )}
          </div>

          {/* Frise */}
          <div>
            <p className="mb-2 text-muted-foreground">Historique</p>
            <ol className="relative ml-1.5 flex flex-col gap-3 border-l border-border">
              {timeline.map((item) => (
                <li key={item.key} className="relative pl-4">
                  <span aria-hidden="true" className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${
                    item.problem ? 'bg-state-red-fg' : DOT[item.kind] ?? 'bg-state-gray-fg'}`} />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={`font-medium ${item.problem ? 'text-state-red-fg' : 'text-foreground'}`}>{item.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatEmailDate(item.at)}
                      {item.count > 1 && item.lastAt !== item.at && <> → {formatEmailDate(item.lastAt)}</>}
                    </span>
                  </div>
                  {item.detail && <p className={`break-words text-xs ${item.problem ? 'text-state-red-fg' : 'text-muted-foreground'}`}>{item.detail}</p>}
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className={`break-all text-xs ${LINK}`}>
                      {item.link}
                    </a>
                  ) : item.link && <p className="break-all text-xs text-muted-foreground">{item.link}</p>}
                </li>
              ))}
            </ol>
            {hasMessageId && !loading && events.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Aucun événement reçu de Brevo pour l'instant. Une resynchronisation peut récupérer l'historique.
              </p>
            )}
            {loading && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Chargement de l'historique…
              </p>
            )}
          </div>

          {/* Resynchronisation */}
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {log.updated_at ? `Suivi mis à jour le ${formatEmailDate(log.updated_at)}` : ''}
              </p>
              <Button type="button" variant="outline" onClick={handleSync} disabled={!hasMessageId || syncing}
                title={hasMessageId ? undefined : 'Aucun identifiant Brevo : resynchronisation impossible'}>
                {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {syncing ? 'Synchronisation…' : 'Resynchroniser avec Brevo'}
              </Button>
            </div>
            {syncMsg && (
              <Notice role="status" tone={syncMsg.ok ? 'green' : 'red'}>
                {syncMsg.text}
              </Notice>
            )}
          </div>
          </>)}
        </div>
      )}
    </>
  );
}
