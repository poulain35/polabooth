import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fetchEventKioskLogSummary, fetchKioskMachineHistory, fetchLicenses } from '../../lib/supabase';
import { countText, eventLogsSummaryText, formatExactTime, kioskWindows, resolveKiosk, timeAgo } from '../../lib/kioskLogs';
import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { StatusPill } from '../ui/status-pill';
import { Skeleton } from '../ui/skeleton';
import KioskLogsPanel from './KioskLogsPanel';

// LAB-328 : « Journal de la borne » de la fiche de l'événement. Repliée par défaut : seul le résumé
// (comptes, bornes, première et dernière activité) est lu au chargement de la fiche, par des requêtes
// légères ; les journaux ne sont lus qu'à l'ouverture, par le panneau de LAB-327 limité à l'événement
// et rangé par séance.

function SummaryItem({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function Dot({ color }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color ? '' : 'bg-border'}`}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden="true"
    />
  );
}

export default function EventKioskLogsSection({ eventId, eventName }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [licenses, setLicenses] = useState([]);
  const [history, setHistory] = useState(null);

  const loadSummary = useCallback(() => fetchEventKioskLogSummary(eventId)
    .then((s) => { setSummary(s); setError(''); })
    .catch((e) => setError(e.message || 'Lecture des journaux impossible.'))
    .finally(() => setLoading(false)), [eventId]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Bornes du compte, retirées comprises, et historique des PC : nom et couleur des bornes concernées.
  useEffect(() => {
    let alive = true;
    fetchLicenses({ includeRetired: true }).then((l) => { if (alive) setLicenses(l); }).catch(() => {});
    fetchKioskMachineHistory().then((h) => { if (alive) setHistory(h); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const windows = useMemo(() => kioskWindows(licenses, history), [licenses, history]);
  const kiosks = useMemo(
    () => (summary?.machines ?? []).map((m) => resolveKiosk(m, windows)),
    [summary, windows]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Résumé relu à chaque ouverture : la borne a pu envoyer des journaux depuis.
    if (next && !loading) { setLoading(true); loadSummary(); }
  }

  const empty = summary && summary.total === 0;

  return (
    <Card className="overflow-hidden" data-testid="event-kiosk-logs">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-card py-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <CardHeading
          as="h3"
          className="min-w-0 flex-1 flex-nowrap items-center"
          tone="muted"
          icon={(
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          titleClassName="flex flex-wrap items-center gap-2"
          title={<>
            Journal de la borne
            {summary?.errors > 0 && (
              <StatusPill tone="red" data-testid="event-kiosk-logs-badge">
                {countText(summary.errors, 'erreur')}
              </StatusPill>
            )}
          </>}
          descriptionClassName="truncate"
          description={loading && !summary ? 'Lecture…' : error ? 'Résumé indisponible' : eventLogsSummaryText(summary)}
        />
        {open ? <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4 sm:px-card">
          {error && (
            <Notice tone="red">{error}</Notice>
          )}

          {loading && !summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-control" />)}
            </div>
          ) : empty ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="event-kiosk-logs-empty">
              Aucun journal de la borne pour cet événement.
            </p>
          ) : summary && (
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-3 sm:grid-cols-4" data-testid="event-kiosk-logs-summary">
              <SummaryItem label="Erreurs">
                <span className={summary.errors ? 'text-destructive' : 'text-foreground'}>{summary.errors}</span>
              </SummaryItem>
              <SummaryItem label="Alertes">
                <span className={summary.warnings ? 'text-state-amber-fg' : 'text-foreground'}>{summary.warnings}</span>
              </SummaryItem>
              <SummaryItem label="Première activité">
                {formatExactTime(summary.first)}
              </SummaryItem>
              <SummaryItem label="Dernière activité">
                {formatExactTime(summary.last)}
                <span className="block text-xs font-normal text-muted-foreground">{timeAgo(summary.last)}</span>
              </SummaryItem>
              <div className="col-span-2 sm:col-span-4 min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {kiosks.length > 1 ? 'Bornes concernées' : 'Borne concernée'}
                </dt>
                <dd className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                  {kiosks.map((k) => (
                    <span key={k.machineId} className="inline-flex items-center gap-1.5 text-sm text-foreground font-medium">
                      <Dot color={k.color} />
                      {k.known ? k.name : `PC inconnu ${k.shortId}`}
                      {k.known && k.machineName && k.machineName !== k.name && (
                        <span className="text-xs font-normal text-muted-foreground">PC {k.machineName}</span>
                      )}
                      {k.retired && <span className="text-xs font-normal text-muted-foreground">· retirée</span>}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          )}

          {(error || (summary && !empty)) && (
            <KioskLogsPanel licenses={licenses} eventId={eventId} eventName={eventName} bySession embedded />
          )}
        </div>
      )}
    </Card>
  );
}
