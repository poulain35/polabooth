import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MoreHorizontal, Copy, ExternalLink, ClipboardCheck, Download, Images, Pencil, Check, CalendarClock, Send,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cardVariants } from '../../components/ui/card';
import { IconCircle } from '../../components/ui/icon-circle';
import { Initials, InitialsStack, INITIALS_TONES } from '../../components/ui/initials';
import {
  SegmentedControl, segmentedTrackClass, segmentedItemClass, segmentedItemActiveClass, segmentedItemIdleClass,
} from '../../components/ui/segmented-control';
import { StatusPill } from '../../components/ui/status-pill';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import DataTable, { SortHeader } from '../../components/DataTable';
import { supabase } from '../../lib/supabase';
import { DESIGN_KIND_LABELS, DESIGN_KINDS, mainFrame, pendingKindsByEvent } from '../../lib/clientDesigns';
import { toast } from 'sonner';
import { useFeatures } from '../../hooks/useFeatures';
import { EVENT_STAGES, eventInStage, eventStatusKey, stageFromParams } from '../../lib/eventStages';
import { CreateButton, PAGE_WIDTH_CLASS, PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { cn } from '../../lib/utils';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDateTime } from '../../lib/dates';
import { copyText } from '../../lib/clipboard';
import { Spinner } from '../../components/ui/spinner';

// Vue Calendrier (?vue=calendrier) : contenu de l'ancien planning, gardé par la fonctionnalité planning.
const AdminPlanning = lazy(() => import('./AdminPlanning'));

const STATUS_STYLES = {
  archived:  { label: 'Archivé',     tone: 'gray' },
  unplanned: { label: 'À planifier', tone: 'amber' },
  upcoming:  { label: 'À venir',     tone: 'gray' },
  finished:  { label: 'Terminé',     tone: 'green' },
  ongoing:   { label: 'En cours',    tone: 'violet' },
};

function computeEventStatus(ev) {
  const key = eventStatusKey(ev);
  return { key, ...STATUS_STYLES[key] };
}

// Filtres d'étape (?etape=) : même calcul que la barre d'étapes de la fiche (lib/eventStages.js).
const ALL_STAGES = 'tous';
const STAGE_FILTERS = [{ id: ALL_STAGES, label: 'Tous' }, ...EVENT_STAGES];

// Cartes d'état en tête de liste : une par filtre d'étape existant (les archives restent dans le contrôle segmenté).
const STAGE_CARDS = [
  { id: 'a-preparer', tone: 'lemon', icon: Pencil },
  { id: 'prets', tone: 'mint', icon: Check },
  { id: 'semaine', tone: 'lilac', icon: CalendarClock },
  { id: 'a-livrer', tone: 'sky', icon: Send },
].map((card) => ({ ...card, label: EVENT_STAGES.find((s) => s.id === card.id).label }));


/** Pastel stable pour un nom : le même client garde la même couleur d'initiales. */
function toneOf(name) {
  let sum = 0;
  for (const char of String(name)) sum += char.codePointAt(0);
  return INITIALS_TONES[sum % INITIALS_TONES.length];
}

function eventsCsv(rows) {
  return toCsv({
    header: ['Nom', 'Client', 'Email', 'Code', 'Début', 'Fin', 'Statut', 'Impressions'],
    rows: rows.map((ev) => [
      ev.name, ev.client_name, ev.client_email, ev.access_code,
      ev.start_date ?? '', ev.end_date ?? '', computeEventStatus(ev).label, ev._prints ?? 0,
    ]),
  });
}

export default function AdminEvents() {
  const [searchParams] = useSearchParams();
  const { isAvailable } = useFeatures();
  const calendar = searchParams.get('vue') === 'calendrier' && isAvailable('planning');

  if (!calendar) return <EventList />;

  return (
    <div className={`${PAGE_WIDTH_CLASS} flex h-full flex-col`}>
      <div className="shrink-0 px-4 pb-4 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <EventsHeader calendar />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex justify-center py-24"><Spinner /></div>}>
          <AdminPlanning />
        </Suspense>
      </div>
    </div>
  );
}

function EventsHeader({ calendar = false, description, actions }) {
  const { isAvailable } = useFeatures();
  return (
    <PageHeader
      title="Événements"
      description={description}
      actions={(
        <>
          {isAvailable('planning') && <ViewSwitch calendar={calendar} />}
          {actions}
          <CreateButton to="/admin/events/new">Nouvel événement</CreateButton>
        </>
      )}
    />
  );
}

/** Sélecteur de vue Liste / Calendrier (?vue=). */
function ViewSwitch({ calendar }) {
  const item = (active) => cn(segmentedItemClass, active ? segmentedItemActiveClass : segmentedItemIdleClass);
  return (
    <nav aria-label="Vue" className={segmentedTrackClass}>
      <Link to="?vue=liste" aria-current={!calendar ? 'page' : undefined} className={item(!calendar)}>Liste</Link>
      <Link to="?vue=calendrier" aria-current={calendar ? 'page' : undefined} className={item(calendar)}>Calendrier</Link>
    </nav>
  );
}

/** Vignette du cadre photo validé de l'événement ; emplacement vide en pointillés s'il n'y en a pas. */
function FrameThumb({ url }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center">
      {url && !failed ? (
        <img
          src={url}
          alt="Cadre photo validé"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full rounded bg-muted object-contain ring-1 ring-border"
        />
      ) : (
        <span role="img" aria-label="Pas de cadre photo validé" className="h-[42px] w-[30px] rounded border border-dashed border-input" />
      )}
    </span>
  );
}

/** Carte d'état : le nombre d'événements de l'étape, et le filtre de cette étape au clic. */
function StageCard({ card, events, pending, loading, active, onSelect }) {
  const Icon = card.icon;
  const clients = events.filter((ev) => ev.client_name).map((ev) => ({ name: ev.client_name, tone: toneOf(ev.client_name) }));
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        cardVariants({ tone: card.tone }),
        'flex flex-col gap-4 p-4 text-left ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-card',
        active && 'ring-2 ring-strong ring-offset-2',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <IconCircle tone="white"><Icon /></IconCircle>
        <InitialsStack items={clients} max={3} aria-hidden="true" className="hidden sm:inline-flex" />
      </span>
      <span className="block">
        <span className="block text-figure">{loading ? '–' : events.length}</span>
        <span className="mt-1 block text-[13px] text-muted-foreground">
          {card.label}
          {pending > 0 && ` · dont ${pending} à valider`}
        </span>
      </span>
    </button>
  );
}

function EventList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAvailable, isInstalled } = useFeatures();
  const hasDelivery = isAvailable('gallery') || isAvailable('audio_guestbook') || isAvailable('guest_form');
  // Colonnes de réservation (devis, acompte) : seulement avec le module booking, absent du schéma ouvert.
  const withBooking = isInstalled('booking');
  const [events, setEvents] = useState([]);
  const [printTotals, setPrintTotals] = useState({});
  // event_id → kinds envoyés à valider ('print' = template, 'home' = écran d'accueil, LAB-290).
  const [pendingDesigns, setPendingDesigns] = useState(() => new Map());
  // Contexte des étapes : event_id → cadres (statut, numéro, image), écran d'accueil envoyé, livraison envoyée.
  const [framesByEvent, setFramesByEvent] = useState(() => new Map());
  const [deliveredEvents, setDeliveredEvents] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const stage = stageFromParams(searchParams);
  function setStage(next) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('filter');
      if (next === ALL_STAGES) params.delete('etape'); else params.set('etape', next);
      return params;
    }, { replace: true });
  }

  useEffect(() => { loadEvents(); }, []);

  async function loadEvents() {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', session.session.user.id)
      .maybeSingle();

    if (!org) {
      const user = session.session.user;
      const { data: newOrg } = await supabase
        .from('organizations')
        .insert({ owner_id: user.id, name: user.email?.split('@')[0] ?? 'Mon organisation', notify_email: user.email })
        .select('id')
        .single();
      if (!newOrg) { setLoading(false); return; }
    }

    const columns = 'id, name, client_name, client_email, start_date, end_date, access_code, status, created_at, expires_at, photobooth_id, '
      + (withBooking ? 'quote_status, deposit_status, deposit_amount, ' : '')
      + 'max_prints:form_config->kiosk->result->max_prints_per_event';
    const [{ data: eventsData }, { data: logsData }, { data: designsData }, { data: deliveryData }] = await Promise.all([
      supabase
        .from('events')
        .select(columns)
        .order('created_at', { ascending: false }),
      supabase.from('print_logs').select('event_id, copies'),
      supabase.from('client_designs').select('event_id, kind, status, slot, final_png_url').in('kind', DESIGN_KINDS).in('status', ['submitted', 'approved']),
      supabase.from('email_logs').select('event_id').eq('type', 'delivery'),
    ]);

    const totals = {};
    for (const row of logsData ?? []) totals[row.event_id] = (totals[row.event_id] ?? 0) + row.copies;
    const frames = new Map();
    for (const row of designsData ?? []) {
      if ((row.kind ?? 'print') !== 'print') continue;
      frames.set(row.event_id, [
        ...(frames.get(row.event_id) ?? []),
        { status: row.status, slot: row.slot, final_png_url: row.final_png_url },
      ]);
    }

    setEvents(eventsData ?? []);
    setPrintTotals(totals);
    setPendingDesigns(pendingKindsByEvent((designsData ?? []).filter((row) => row.status === 'submitted')));
    setFramesByEvent(frames);
    setDeliveredEvents(new Set((deliveryData ?? []).map((row) => row.event_id)));
    setLoading(false);
  }

  // Événements de chaque étape : sert aux chiffres des cartes, aux compteurs des filtres et au filtrage.
  const eventsByStage = useMemo(() => {
    const now = new Date();
    const byStage = Object.fromEntries(EVENT_STAGES.map((s) => [s.id, []]));
    for (const ev of events) {
      const ctx = {
        frames: framesByEvent.get(ev.id) ?? [],
        homePending: pendingDesigns.get(ev.id)?.includes('home') ?? false,
        deliverySent: deliveredEvents.has(ev.id),
        isAvailable,
        now,
      };
      for (const s of EVENT_STAGES) if (eventInStage(ev, s.id, ctx)) byStage[s.id].push(ev);
    }
    return byStage;
  }, [events, pendingDesigns, framesByEvent, deliveredEvents, isAvailable]);

  // Filtrage par étape (la recherche/tri/pagination sont gérés par le DataTable)
  const rows = useMemo(
    () => (stage ? eventsByStage[stage] : events).map((ev) => ({ ...ev, _prints: printTotals[ev.id] ?? 0 })),
    [events, eventsByStage, stage, printTotals],
  );

  async function copyCode(code) {
    if (await copyText(code)) toast.success('Code copié');
    else toast.error('Copie impossible : sélectionnez le code à la main.');
  }

  function exportCsv() {
    downloadCsv(eventsCsv(rows), `evenements-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const columns = useMemo(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => <SortHeader column={column}>Événement</SortHeader>,
      enableHiding: false,
      meta: { label: 'Événement' },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <div className="flex items-center gap-3">
            <FrameThumb url={mainFrame(framesByEvent.get(ev.id))?.final_png_url} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
              <span>{ev.name || <span className="italic text-muted-foreground">Sans nom</span>}</span>
              {(pendingDesigns.get(ev.id) ?? []).map((kind) => (
                <StatusPill key={kind} tone="amber">
                  {kind === 'home' ? `${DESIGN_KIND_LABELS.home} à valider` : 'À valider'}
                </StatusPill>
              ))}
            </div>
          </div>
        );
      },
    },
    {
      id: 'client',
      accessorFn: (ev) => `${ev.client_name ?? ''} ${ev.client_email ?? ''}`,
      header: 'Client',
      meta: { label: 'Client', headClass: 'hidden md:table-cell', cellClass: 'hidden md:table-cell' },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <div className="flex items-center gap-2.5">
            {ev.client_name && <Initials name={ev.client_name} tone={toneOf(ev.client_name)} aria-hidden="true" />}
            <div className="min-w-0">
              <div className={ev.client_name ? 'text-foreground' : 'text-muted-foreground'}>{ev.client_name ?? '—'}</div>
              {ev.client_email && <div className="text-xs text-muted-foreground">{ev.client_email}</div>}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'access_code',
      header: 'Code',
      meta: { label: 'Code' },
      cell: ({ row }) => (
        <code className="rounded-md bg-primary-soft px-2 py-1 font-mono text-xs font-medium text-primary-ink">
          {row.original.access_code}
        </code>
      ),
    },
    {
      id: 'date',
      accessorFn: (ev) => ev.start_date ?? '',
      header: ({ column }) => <SortHeader column={column}>Date</SortHeader>,
      meta: { label: 'Date', headClass: 'hidden sm:table-cell', cellClass: 'hidden sm:table-cell' },
      cell: ({ row }) => {
        const ev = row.original;
        if (!ev.start_date) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            <span>{formatDateTime(ev.start_date)}</span>
            {ev.end_date && ev.end_date !== ev.start_date && (
              <span className="text-xs text-muted-foreground">→ {formatDateTime(ev.end_date)}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'prints',
      accessorFn: (ev) => ev._prints ?? 0,
      header: ({ column }) => <SortHeader column={column}>Impressions</SortHeader>,
      meta: { label: 'Impressions', headClass: 'hidden lg:table-cell', cellClass: 'hidden lg:table-cell' },
      cell: ({ row }) => {
        const ev = row.original;
        const max = ev.max_prints ?? null;
        const done = ev._prints ?? 0;
        if (max == null && done === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{done}/{max ?? '∞'}</span>
            <span className="text-xs text-muted-foreground">réalisé/max</span>
          </div>
        );
      },
    },
    {
      id: 'status',
      accessorFn: (ev) => computeEventStatus(ev).label,
      header: 'Statut',
      enableSorting: false,
      meta: { label: 'Statut' },
      cell: ({ row }) => {
        const { label, tone } = computeEventStatus(row.original);
        return <StatusPill tone={tone}>{label}</StatusPill>;
      },
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      enableSorting: false,
      meta: { headClass: 'w-10', cellClass: 'text-right' },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => navigate(ev.id)}>
                <ExternalLink className="w-4 h-4" />Ouvrir le détail
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyCode(ev.access_code)}>
                <Copy className="w-4 h-4" />Copier le code
              </DropdownMenuItem>
              {hasDelivery && (
                <DropdownMenuItem onSelect={() => navigate(`/admin/events/${ev.id}?tab=livraison`)}>
                  <Images className="w-4 h-4" />Photos et livraison
                </DropdownMenuItem>
              )}
              {pendingDesigns.has(ev.id) && <DropdownMenuSeparator />}
              {pendingDesigns.get(ev.id)?.includes('print') && (
                <DropdownMenuItem onSelect={() => navigate(`${ev.id}?tab=creation`)}>
                  <ClipboardCheck className="w-4 h-4" />Valider le cadre photo
                </DropdownMenuItem>
              )}
              {pendingDesigns.get(ev.id)?.includes('home') && (
                <DropdownMenuItem onSelect={() => navigate(`${ev.id}?tab=creation#ecran-accueil`)}>
                  <ClipboardCheck className="w-4 h-4" />Valider l’écran d’accueil
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], [navigate, pendingDesigns, framesByEvent, hasDelivery]);

  return (
    <PageContainer>
      <EventsHeader
        description={loading ? 'Chargement…' : `${events.length} événement${events.length > 1 ? 's' : ''}`}
        actions={(
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download />Exporter
          </Button>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-card">
        {STAGE_CARDS.map((card) => (
          <StageCard
            key={card.id}
            card={card}
            events={eventsByStage[card.id]}
            pending={card.id === 'a-preparer' ? eventsByStage[card.id].filter((ev) => pendingDesigns.has(ev.id)).length : 0}
            loading={loading}
            active={stage === card.id}
            onSelect={() => setStage(stage === card.id ? ALL_STAGES : card.id)}
          />
        ))}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Rechercher par nom, client, code…"
        onRowClick={(ev) => navigate(ev.id)}
        emptyMessage="Aucun événement ne correspond aux filtres."
        toolbarLeft={(
          <SegmentedControl
            aria-label="Étape"
            value={stage ?? ALL_STAGES}
            onValueChange={setStage}
            className="max-w-none flex-nowrap"
            options={STAGE_FILTERS.map((sf) => ({
              value: sf.id,
              label: sf.label,
              count: loading ? undefined : (sf.id === ALL_STAGES ? events : eventsByStage[sf.id]).length,
            }))}
          />
        )}
      />
    </PageContainer>
  );
}
