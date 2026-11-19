import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, ScrollText, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  supabase, deleteKioskLogs, fetchKioskLogEvents, fetchKioskLogsForExport, fetchKioskLogsPage,
  fetchKioskMachineHistory, fetchNewKioskLogs, fetchRecentEventsForLogs,
} from '../../lib/supabase';
import {
  CONTEXT_GROUPS, DEFAULT_FILTERS, LEVELS, LOG_PAGE_SIZE, LOG_PAGE_SIZES, LOG_PAGE_SIZE_KEY, PERIODS,
  acceptLinkedEvent, parseLogPageSize,
  buildLogFilters, buildLogsText, countText, describeFilters, eventLabel, eventOptions, explainLog,
  formatExactTime, formatTimeRange, groupBySession, groupLogs, kioskOptions, kioskText, kioskWindows,
  latestCreatedAt, logCursor, logsFileName, mergeLogs, missingEventIds, resolveKiosk, sessionLabel, timeAgo,
} from '../../lib/kioskLogs';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { IconCircle } from '../ui/icon-circle';
import { Input } from '../ui/input';
import { SegmentedControl } from '../ui/segmented-control';
import { StatusPill } from '../ui/status-pill';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { CardHeading, Notice } from './CardParts';
import { downloadBlob } from '../../lib/download';

// LAB-327 : journaux des bornes, lisibles. Chaque journal dit sa borne (nom, couleur, PC), son
// événement et sa séance ; les journaux identiques à la suite sont réunis ; les erreurs connues ont
// une phrase claire et « Que faire ». Filtres appliqués côté serveur, « Voir plus » par curseur.
// `eventId` (facultatif) limite le panneau à un événement : filtre « Événement », nom de l'événement
// sur chaque journal et « Purger » masqués. Fiche de l'événement (LAB-328) : `bySession` range les
// journaux par séance (blocs dépliables), `embedded` retire le titre et l'ancre de la page Kiosks,
// `eventName` nomme l'export.
// `initialEventId` (lien `?event=` des alertes, LAB-329) : filtre « Événement » réglé au départ s'il
// est connu (sinon ignoré) ; `onLinkedEvent(true)` quand la première page filtrée est affichée (la page
// peut alors défiler jusqu'au panneau), `onLinkedEvent(false)` si le lien est ignoré.

// Ton de la pastille de niveau (StatusPill) ; le libellé (Erreur, Alerte, Info) porte toujours le niveau.
const LEVEL_TONE = { error: 'red', warning: 'amber', info: 'gray' };

// Surface d'un bloc selon ce qui l'entoure : `card` sur le fond de la page, `soft` dans une carte (fiche de
// l'événement, séance dépliée), `plain` dans un bloc doux.
const SURFACE = { card: 'bg-card shadow-card', soft: 'bg-soft', plain: 'bg-card' };

const TEXT_BUTTON = 'rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Le temps réel (postgres_changes) n'arrive que si kiosk_logs est dans la publication ; la relecture
// périodique prend le relais sinon.
const POLL_MS = 30_000;
const REALTIME_DEBOUNCE_MS = 1000;
const SEARCH_DEBOUNCE_MS = 350;

function KioskDot({ color }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color ? '' : 'bg-muted-foreground/40'}`}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden="true"
    />
  );
}

function LogGroup({ group, windows, events, onSession, activeSession, showEvent = true, showSession = true, surface = 'card' }) {
  const [showDetail, setShowDetail] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { log, count } = group;
  const kiosk = resolveKiosk(log, windows);
  const event = showEvent ? eventLabel(log.event_id, events) : null;
  const session = showSession ? sessionLabel(log.session_id) : null;
  const clear = explainLog(log);

  return (
    <article className={`rounded-xl px-3 py-3 sm:px-4 ${SURFACE[surface]}`} data-testid="kiosk-log">
      <div className="flex items-start gap-3">
        <StatusPill tone={LEVEL_TONE[log.level] ?? 'red'} className="min-w-[4.5rem] justify-center">
          {LEVELS[log.level]?.label ?? log.level}
        </StatusPill>

        <div className="min-w-0 flex-1">
          {/* Borne, événement, séance, contexte, version, heure */}
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground" data-testid="kiosk-log-kiosk">
              <KioskDot color={kiosk.color} />
              {kiosk.known ? kiosk.name : `PC inconnu ${kiosk.shortId}`}
              {kiosk.known && kiosk.machineName && kiosk.machineName !== kiosk.name && (
                <span className="font-normal text-muted-foreground">PC {kiosk.machineName}</span>
              )}
              {kiosk.retired && <span className="font-normal text-muted-foreground">· retirée</span>}
            </span>
            {(event || session) && (
              <span className="inline-flex min-w-0 items-center gap-1" data-testid="kiosk-log-event">
                {event && <span className="max-w-[16rem] truncate">{event}</span>}
                {event && session && <span aria-hidden="true">·</span>}
                {session && (
                  <button
                    type="button"
                    onClick={() => onSession(log.session_id)}
                    disabled={activeSession === log.session_id}
                    title="Voir les journaux de cette séance"
                    className={`${TEXT_BUTTON} text-primary-ink hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline`}
                  >
                    {session}
                  </button>
                )}
              </span>
            )}
            {log.context && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-ink">{log.context}</span>}
            {log.app_version && <span>v{log.app_version}</span>}
            <span className="whitespace-nowrap sm:ml-auto" title={timeAgo(log.occurred_at)}>
              {formatExactTime(log.occurred_at)} · {timeAgo(log.occurred_at)}
            </span>
          </div>

          {/* Message clair ou message d'origine */}
          {clear ? (
            <>
              <p className="break-words text-sm font-medium text-foreground">{clear.title}</p>
              <p className="mt-1.5 rounded-lg bg-primary-soft px-2.5 py-1.5 text-[13px] text-ink">
                <span className="font-medium text-primary-ink">Que faire : </span>{clear.advice}
              </p>
            </>
          ) : (
            <p className="break-words text-sm font-medium text-foreground">{log.message}</p>
          )}

          {/* Regroupement */}
          {count > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-strong px-2 py-0.5 font-medium text-strong-foreground" data-testid="kiosk-log-count">×{count}</span>
              <span>du {formatExactTime(group.first)} au {formatExactTime(group.last)}</span>
              <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}
                className={`${TEXT_BUTTON} inline-flex items-center gap-0.5 hover:text-foreground`}>
                {showAll ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {showAll ? 'Masquer' : `Voir les ${count}`}
              </button>
            </div>
          )}
          {showAll && (
            <ul className="mt-1.5 max-h-64 space-y-0.5 overflow-y-auto border-l-2 border-border pl-2 font-mono text-[11px] text-muted-foreground">
              {group.logs.map((l) => (
                <li key={l.id}>
                  {formatExactTime(l.occurred_at)}
                  {l.event_id && l.event_id !== log.event_id && ` · ${eventLabel(l.event_id, events) ?? ''}`}
                  {l.session_id && ` · ${sessionLabel(l.session_id)}`}
                </li>
              ))}
            </ul>
          )}

          {/* Détail : message d'origine et trace */}
          {(clear || log.stack_trace) && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
              className={`${TEXT_BUTTON} mt-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground`}
            >
              {showDetail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {clear ? (log.stack_trace ? 'Message d’origine et trace' : 'Message d’origine') : 'Trace'}
            </button>
          )}
          {showDetail && (
            <div className="mt-2 space-y-2">
              {clear && (
                <p className="break-words rounded-lg bg-muted p-2.5 font-mono text-xs text-foreground" data-testid="kiosk-log-original">
                  {log.message}
                </p>
              )}
              {log.stack_trace && (
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-ink">
                  {log.stack_trace}
                </pre>
              )}
              <p className="break-all text-[11px] text-muted-foreground">
                PC {kiosk.machineId}{kiosk.known ? ` · ${kioskText(kiosk)}` : ''}
                {log.session_id && ` · séance ${log.session_id}`}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// Une séance (fiche de l'événement) : borne, heures et comptes ; journaux dépliables, ouverte
// d'office si elle contient une erreur.
function SessionBlock({ session, windows, events, onSession, activeSession, surface = 'card' }) {
  const [open, setOpen] = useState(session.errors > 0);
  const kiosks = session.machineIds.map((m) => resolveKiosk(session.logs.find((l) => l.machine_id === m), windows));
  return (
    <div className={`rounded-xl ${SURFACE[surface]}`} data-testid="kiosk-log-session">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 ${surface === 'card' ? 'hover:bg-soft' : 'hover:bg-muted'}`}
      >
        {open
          ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">
              {session.sessionId ? `Séance ${session.sessionId.slice(0, 4)}` : 'Hors séance'}
            </span>
            {kiosks.map((k) => (
              <span key={k.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <KioskDot color={k.color} />
                {k.known ? k.name : `PC inconnu ${k.shortId}`}
              </span>
            ))}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{formatTimeRange(session.first, session.last)}</span>
        </span>
        <span className="flex max-w-[45%] shrink-0 flex-wrap items-center justify-end gap-1.5">
          {session.errors > 0 && <StatusPill tone="red">{countText(session.errors, 'erreur')}</StatusPill>}
          {session.warnings > 0 && <StatusPill tone="amber">{countText(session.warnings, 'alerte')}</StatusPill>}
          <span className="whitespace-nowrap text-xs text-muted-foreground">{countText(session.count, 'journal')}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-3 sm:px-3">
          {session.sessionId && activeSession !== session.sessionId && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onSession(session.sessionId)}
                className={`${TEXT_BUTTON} text-xs text-primary-ink hover:underline`}
              >
                Voir cette séance seule
              </button>
            </div>
          )}
          {session.groups.map((g) => (
            <LogGroup
              key={g.key}
              group={g}
              windows={windows}
              events={events}
              activeSession={activeSession}
              onSession={onSession}
              showEvent={false}
              showSession={false}
              surface={surface === 'card' ? 'soft' : 'plain'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Taille de page enregistrée sur cet appareil (25 par défaut, stockage illisible compris). */
function readStoredPageSize() {
  try { return parseLogPageSize(window.localStorage.getItem(LOG_PAGE_SIZE_KEY)); } catch { return parseLogPageSize(null); }
}

export default function KioskLogsPanel({
  licenses = [], eventId = null, initialEventId = null, onLinkedEvent = null, title = 'Journaux des bornes',
  bySession = false, embedded = false, eventName = null,
}) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Panneau de la page Bornes : taille de page au choix ; fiche de l'événement (embedded) : 100 (séances).
  const [pageSize, setPageSize] = useState(() => (embedded ? LOG_PAGE_SIZE : readStoredPageSize()));
  const [searchInput, setSearchInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [events, setEvents] = useState({});
  const [recentEvents, setRecentEvents] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const linkedId = eventId ? null : initialEventId;
  const [linkReady, setLinkReady] = useState(!linkedId);

  const windows = useMemo(() => kioskWindows(licenses, history), [licenses, history]);

  // Clé stable des filtres serveur : la liste des bornes est relue toutes les 30 s par la page,
  // sans que la pagination déjà chargée soit perdue.
  const filterKey = useMemo(
    () => JSON.stringify(buildLogFilters(filters, { windows, eventId, now: 0 })),
    [filters, windows, eventId]);

  const builtRef = useRef(null);
  const reqRef = useRef(0);
  const stateRef = useRef({ logs: [], cursor: null, hasMore: false });
  stateRef.current = { logs, cursor, hasMore };
  const requestedEvents = useRef(new Set());

  // Historique des PC (attribution des journaux, filtre par borne).
  useEffect(() => {
    let alive = true;
    fetchKioskMachineHistory()
      .then((rows) => { if (alive) setHistory(rows); })
      .catch(() => { /* sans historique : bornes d'après leur PC actuel */ })
      .finally(() => { if (alive) setHistoryReady(true); });
    return () => { alive = false; };
  }, []);

  // Lien `?event=` : l'événement n'est appliqué que s'il est connu ; la première lecture attend.
  const onLinkedRef = useRef(onLinkedEvent);
  onLinkedRef.current = onLinkedEvent;
  const linkPending = useRef(false);
  useEffect(() => {
    if (!linkedId) return undefined;
    let alive = true;
    fetchKioskLogEvents([linkedId])
      .then((found) => {
        if (!alive) return;
        const ok = acceptLinkedEvent(linkedId, found);
        if (ok) {
          linkPending.current = true;
          requestedEvents.current.add(linkedId);
          setEvents((prev) => ({ ...prev, ...found }));
          setFilters((f) => ({ ...f, event: linkedId, session: null }));
        }
        if (!ok) onLinkedRef.current?.(false);
      })
      .catch(() => { if (alive) onLinkedRef.current?.(false); })
      .finally(() => { if (alive) setLinkReady(true); });
    return () => { alive = false; };
  }, [linkedId]);

  useEffect(() => {
    if (eventId) return;
    fetchRecentEventsForLogs().then(setRecentEvents).catch(() => {});
  }, [eventId]);

  // Recherche : appliquée après une courte pause de frappe.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const reload = useCallback(async () => {
    const req = ++reqRef.current;
    const built = buildLogFilters(filters, { windows, eventId, now: Date.now() });
    builtRef.current = built;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchKioskLogsPage(built, { limit: pageSize });
      if (req !== reqRef.current) return;
      setLogs(page.logs);
      setCursor(logCursor(page.logs));
      setHasMore(page.hasMore);
    } catch (e) {
      if (req === reqRef.current) setError(e.message || 'Lecture des journaux impossible.');
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
    // filterKey résume filters, windows et eventId pour la requête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, pageSize]);

  useEffect(() => {
    if (historyReady && linkReady) reload();
  }, [historyReady, linkReady, reload]);

  // Première page filtrée sur l'événement du lien affichée : la page peut défiler jusqu'au panneau.
  useEffect(() => {
    if (loading || !linkPending.current || !builtRef.current) return;
    linkPending.current = false;
    onLinkedRef.current?.(true);
  }, [loading]);

  async function loadMore() {
    const built = builtRef.current;
    if (!built || !cursor) return;
    const req = reqRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchKioskLogsPage(built, { cursor, limit: pageSize });
      if (req !== reqRef.current) return;
      setLogs((prev) => mergeLogs(prev, page.logs));
      setCursor(logCursor(page.logs) ?? cursor);
      setHasMore(page.hasMore);
    } catch (e) {
      toast.error(e.message || 'Lecture des journaux impossible.');
    } finally {
      setLoadingMore(false);
    }
  }

  // Nouveaux journaux : temps réel (postgres_changes) et relecture toutes les 30 s.
  const refresh = useCallback(async () => {
    const built = builtRef.current;
    if (!built) return;
    const { logs: current, cursor: cur, hasMore: more } = stateRef.current;
    const since = latestCreatedAt(current);
    if (!since) { reload(); return; }
    const req = reqRef.current;
    try {
      const fresh = await fetchNewKioskLogs(built, since);
      if (req !== reqRef.current) return;
      if (fresh.overflow) { reload(); return; }
      if (fresh.logs.length) setLogs((prev) => mergeLogs(prev, fresh.logs, { cursor: cur, hasMore: more }));
    } catch { /* prochaine relecture */ }
  }, [reload]);

  useEffect(() => {
    if (!historyReady) return undefined;
    let timer = null;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(refresh, REALTIME_DEBOUNCE_MS); };
    const channel = supabase
      .channel(`kiosk-logs-watch-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kiosk_logs' }, debounced)
      .subscribe();
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => { clearTimeout(timer); clearInterval(poll); supabase.removeChannel(channel); };
  }, [historyReady, refresh]);

  // Noms des événements cités par les journaux chargés.
  useEffect(() => {
    const ids = missingEventIds(logs, events).filter((id) => !requestedEvents.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => requestedEvents.current.add(id));
    fetchKioskLogEvents(ids)
      .then((found) => setEvents((prev) => ({ ...prev, ...found })))
      .catch(() => ids.forEach((id) => requestedEvents.current.delete(id)));
  }, [logs, events]);

  function changePageSize(value) {
    const size = parseLogPageSize(value, pageSize);
    setPageSize(size);
    try { window.localStorage.setItem(LOG_PAGE_SIZE_KEY, String(size)); } catch { /* choix non gardé */ }
  }

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setSearchInput(''); };

  const groups = useMemo(() => groupLogs(logs), [logs]);
  const sessions = useMemo(() => (bySession ? groupBySession(logs) : []), [bySession, logs]);
  const kiosks = useMemo(() => kioskOptions(licenses, logs, windows), [licenses, logs, windows]);
  const eventChoices = useMemo(() => eventOptions(logs, events, recentEvents), [logs, events, recentEvents]);
  const errorCount = logs.filter((l) => l.level === 'error').length;
  const hasFilters = describeFilters(filters) !== 'aucun' || searchInput.trim() !== '';

  const kioskLabel = kiosks.find((k) => k.value === filters.kiosk)?.label;
  const filterEventLabel = eventId || (filters.event !== 'all' && filters.event !== 'none')
    ? (eventLabel(eventId || filters.event, events) ?? eventChoices.find((e) => e.value === filters.event)?.label)
    : null;

  async function handleExport() {
    const built = builtRef.current;
    if (!built) return;
    setExporting(true);
    try {
      const { logs: rows, truncated } = await fetchKioskLogsForExport(built);
      if (rows.length === 0) { toast.info('Aucun journal à exporter pour ces filtres.'); return; }
      let known = events;
      const missing = missingEventIds(rows, known);
      if (missing.length) {
        try { known = { ...known, ...(await fetchKioskLogEvents(missing)) }; } catch { /* ids seuls */ }
      }
      const exportEventName = eventId ? (eventLabel(eventId, known) ?? eventName) : null;
      const text = buildLogsText(rows, {
        resolve: (l) => ({
          kiosk: kioskText(resolveKiosk(l, windows)),
          event: l.event_id ? (eventLabel(l.event_id, known) ?? `Événement ${l.event_id}`) : null,
        }),
        filtersText: describeFilters(filters, { kioskLabel, eventLabel: filterEventLabel ?? exportEventName, eventId }),
        truncated,
        ...(eventId ? { title: `Journaux de la borne · ${exportEventName ?? eventId}` } : {}),
      });
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), logsFileName(Date.now(), { eventName: exportEventName }));
      toast.success(`${rows.length} journa${rows.length > 1 ? 'ux exportés' : 'l exporté'}`);
    } catch (e) {
      toast.error(e.message || 'Export impossible.');
    } finally {
      setExporting(false);
    }
  }

  async function handlePurge() {
    if (filters.kiosk === 'all') return;
    if (!confirm(`Supprimer tous les journaux de « ${kioskLabel ?? 'cette borne'} » ?`)) return;
    setClearing(true);
    try {
      await deleteKioskLogs(buildLogFilters({ kiosk: filters.kiosk }, { windows }));
      toast.success('Journaux supprimés');
      reload();
    } catch (e) {
      toast.error(e.message || 'Suppression impossible.');
    } finally {
      setClearing(false);
    }
  }

  // Sur le fond de la page (onglet État), les blocs sont des cartes ; dans la fiche de l'événement
  // (`embedded`), le panneau est déjà dans une carte : blocs doux.
  const surface = embedded ? 'soft' : 'card';
  const emptyText = hasFilters
    ? 'Aucun journal pour ces filtres.'
    : (eventId ? 'Aucun journal de la borne pour cet événement.' : 'Aucun journal reçu.');

  return (
    <section
      id={embedded ? undefined : 'journaux-bornes'}
      className={embedded ? '' : 'mt-3 scroll-mt-4'}
      data-testid="kiosk-logs-panel"
    >
      <div className={`mb-3 flex flex-wrap items-center gap-2 ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && (
          <CardHeading
            titleClassName="flex flex-wrap items-center gap-2"
            title={<>
              {title}
              {errorCount > 0 && (
                <StatusPill tone="red">
                  {errorCount}{hasMore ? '+' : ''} erreur{errorCount > 1 ? 's' : ''}
                </StatusPill>
              )}
            </>}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!eventId && filters.kiosk !== 'all' && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-state-red hover:text-state-red-fg"
              onClick={handlePurge}
              disabled={clearing}
            >
              <Trash2 /> Purger
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading}>
            <Download /> {exporting ? 'Export…' : 'Exporter (.txt)'}
          </Button>
        </div>
      </div>

      {/* Filtres */}
      <div className={`mb-3 space-y-3 rounded-xl p-3 sm:p-4 ${SURFACE[surface]}`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.kiosk} onValueChange={(v) => setFilter('kiosk', v)}>
            <SelectTrigger aria-label="Borne">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les bornes</SelectItem>
              {kiosks.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  <span className="inline-flex items-center gap-2">
                    <KioskDot color={k.color} />
                    {k.label}
                    {k.machineName && k.machineName !== k.label && <span className="text-muted-foreground">PC {k.machineName}</span>}
                    {k.retired && <span className="text-muted-foreground">· retirée</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!eventId && (
            <Select value={filters.event} onValueChange={(v) => setFilter('event', v)}>
              <SelectTrigger aria-label="Événement">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les événements</SelectItem>
                <SelectItem value="none">Sans événement</SelectItem>
                {eventChoices.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={filters.group} onValueChange={(v) => setFilter('group', v)}>
            <SelectTrigger aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {CONTEXT_GROUPS.map((g) => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher un message…"
              aria-label="Rechercher"
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Période"
            value={filters.period}
            onValueChange={(v) => setFilter('period', v)}
            options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
          />
          <SegmentedControl
            aria-label="Niveau"
            value={filters.level}
            onValueChange={(v) => setFilter('level', v)}
            options={[{ value: 'all', label: 'Tous' }, ...Object.entries(LEVELS).map(([value, l]) => ({ value, label: l.label }))]}
          />
          {filters.session && (
            <span className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-soft pl-3 pr-1.5 text-[13px] font-medium text-primary-ink">
              Séance {filters.session.slice(0, 4)}
              <button type="button" aria-label="Retirer le filtre séance" onClick={() => setFilter('session', null)}
                className="rounded-full p-1 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {hasFilters && (
            <button type="button" onClick={resetFilters}
              className={`${TEXT_BUTTON} text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline`}>
              Effacer les filtres
            </button>
          )}
        </div>
      </div>

      {error ? (
        <Notice as="div" tone="red" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" className="text-foreground" onClick={reload}>Réessayer</Button>
        </Notice>
      ) : loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        embedded ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <Card className="flex flex-col items-center gap-3 p-card py-10 text-center">
            <IconCircle tone="muted"><ScrollText /></IconCircle>
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          </Card>
        )
      ) : (
        <>
          <div className="space-y-2">
            {bySession
              ? sessions.map((s) => (
                <SessionBlock
                  key={s.key}
                  session={s}
                  windows={windows}
                  events={events}
                  activeSession={filters.session}
                  onSession={(id) => setFilter('session', id)}
                  surface={surface}
                />
              ))
              : groups.map((g) => (
                <LogGroup
                  key={g.key}
                  group={g}
                  windows={windows}
                  events={events}
                  activeSession={filters.session}
                  onSession={(id) => setFilter('session', id)}
                  showEvent={!eventId}
                  surface={surface}
                />
              ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[13px] text-muted-foreground">
            <span>{logs.length} journa{logs.length > 1 ? 'ux' : 'l'} affiché{logs.length > 1 ? 's' : ''}</span>
            {hasMore && (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Chargement…' : 'Voir plus'}
              </Button>
            )}
            {!embedded && (
              <span className="inline-flex items-center gap-2">
                Par page
                <SegmentedControl
                  aria-label="Journaux par page"
                  value={String(pageSize)}
                  onValueChange={changePageSize}
                  options={LOG_PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                />
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
