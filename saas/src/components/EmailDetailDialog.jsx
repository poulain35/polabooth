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

const DOT = {
  sent: 'bg-gray-400',
  delivered: 'bg-blue-500',
  opened: 'bg-violet-500',
  click: 'bg-emerald-500',
};

/**
 * Détail d'un email (LAB-124) : message-id Brevo, frise des événements, resynchronisation.
 * En SMTP (lot S2) : ni identifiant Brevo, ni frise, ni resynchronisation ; le motif d'un refus reste affiché.
 * `initialLog` (ligne déjà chargée) s'affiche aussitôt ; `onUpdated(log)` reçoit la ligne à jour.
 */
export default function EmailDetailDialog({ emailLogId, initialLog = null, open, onOpenChange, onUpdated, hideContextLink = false }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
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
  const [copied, setCopied] = useState(false);

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
    try {
      await navigator.clipboard.writeText(log.provider_message_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSyncMsg({ ok: false, text: 'Copie impossible : sélectionnez l\'identifiant à la main.' });
      setTimeout(() => setSyncMsg(null), 3000);
    }
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
          <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</p>}

      {log && (
        <div className="space-y-5 text-sm min-w-0">
          {/* Résumé */}
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Statut</dt>
            <dd><EmailStatusBadge status={log.status} /></dd>
            <dt className="text-muted-foreground">Destinataire</dt>
            <dd className="text-foreground break-all">{log.recipient}</dd>
            <dt className="text-muted-foreground">Envoyé le</dt>
            <dd className="text-foreground">{formatEmailDate(log.sent_at)}</dd>
            {context && (
              <>
                <dt className="text-muted-foreground">{EMAIL_CONTEXT_KIND_LABELS[context.kind] ?? 'Fiche'}</dt>
                <dd>
                  <Link to={context.to} className="inline-flex items-center gap-1 text-violet-700 hover:underline" onClick={onClose}>
                    {context.label}<ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </dd>
              </>
            )}
          </dl>

          {/* Motif d'échec (refus Brevo à l'envoi, rebond, blocage…) */}
          {log.error_reason && !rejectedAtSend && (
            <div className={`rounded-lg px-3 py-2 ${status?.problem ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
              <p className="font-medium">Motif</p>
              <p className="break-words">{log.error_reason}</p>
            </div>
          )}

          {!tracking && (
            <p className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-200 text-gray-600">
              {SMTP_TRACKING_LABEL} : la réception, les ouvertures et les clics ne sont pas suivis.
            </p>
          )}

          {tracking && (<>
          {/* Identifiant Brevo */}
          <div>
            <p className="text-muted-foreground mb-1">Identifiant du message Brevo</p>
            {hasMessageId ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700" title={log.provider_message_id}>
                  {log.provider_message_id}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopy} aria-label="Copier l'identifiant Brevo">
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copié' : 'Copier'}
                </Button>
              </div>
            ) : (
              <p className={`rounded-lg px-3 py-2 break-words ${rejectedAtSend ? 'bg-red-50 text-red-700' : 'bg-gray-50 border border-gray-200 text-gray-600'}`}>
                {noTrackingMessage(log)}
              </p>
            )}
          </div>

          {/* Frise */}
          <div>
            <p className="text-muted-foreground mb-2">Historique</p>
            <ol className="relative border-l border-gray-200 ml-1.5 space-y-3">
              {timeline.map((item) => (
                <li key={item.key} className="pl-4 relative">
                  <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${
                    item.problem ? 'bg-red-500' : DOT[item.kind] ?? 'bg-gray-400'}`} />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={`font-medium ${item.problem ? 'text-red-700' : 'text-foreground'}`}>{item.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatEmailDate(item.at)}
                      {item.count > 1 && item.lastAt !== item.at && <> → {formatEmailDate(item.lastAt)}</>}
                    </span>
                  </div>
                  {item.detail && <p className={`text-xs ${item.problem ? 'text-red-600' : 'text-muted-foreground'} break-words`}>{item.detail}</p>}
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-700 hover:underline break-all">
                      {item.link}
                    </a>
                  ) : item.link && <p className="text-xs text-muted-foreground break-all">{item.link}</p>}
                </li>
              ))}
            </ol>
            {hasMessageId && !loading && events.length === 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Aucun événement reçu de Brevo pour l'instant. Une resynchronisation peut récupérer l'historique.
              </p>
            )}
            {loading && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Chargement de l'historique…
              </p>
            )}
          </div>

          {/* Resynchronisation */}
          <div className="border-t pt-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {log.updated_at ? `Suivi mis à jour le ${formatEmailDate(log.updated_at)}` : ''}
              </p>
              <Button type="button" variant="outline" onClick={handleSync} disabled={!hasMessageId || syncing}
                title={hasMessageId ? undefined : 'Aucun identifiant Brevo : resynchronisation impossible'}>
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {syncing ? 'Synchronisation…' : 'Resynchroniser avec Brevo'}
              </Button>
            </div>
            {syncMsg && (
              <p className={`text-sm rounded-lg px-3 py-2 ${syncMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {syncMsg.text}
              </p>
            )}
          </div>
          </>)}
        </div>
      )}
    </>
  );
}
