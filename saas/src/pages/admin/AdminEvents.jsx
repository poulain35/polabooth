import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, MoreHorizontal, Copy, ExternalLink, ClipboardCheck, Download } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import DataTable, { SortHeader } from '../../components/DataTable';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';

function computeEventStatus(ev) {
  if (ev.status === 'archived') {
    return { key: 'archived', label: 'Archivé', cls: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-400',    pulse: false };
  }
  const now   = new Date();
  const start = ev.start_date ? new Date(ev.start_date) : null;
  const end   = ev.end_date   ? new Date(ev.end_date)   : null;
  if (!start) {
    return { key: 'unplanned', label: 'À planifier', cls: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500', pulse: false };
  }
  if (start > now) {
    return { key: 'upcoming', label: 'À venir',  cls: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-500',     pulse: false };
  }
  if (end && end < now) {
    return { key: 'finished', label: 'Terminé',  cls: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   pulse: false };
  }
  return   { key: 'ongoing',  label: 'En cours', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', pulse: true  };
}

function StatusBadge({ ev }) {
  const { label, cls, dot, pulse } = computeEventStatus(ev);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dot} opacity-60`} />}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dot}`} />
      </span>
      {label}
    </span>
  );
}

const STATUS_FILTERS = [
  { key: 'all',       label: 'Tous' },
  { key: 'unplanned', label: 'À planifier' },
  { key: 'upcoming',  label: 'À venir' },
  { key: 'ongoing',  label: 'En cours' },
  { key: 'finished', label: 'Terminé' },
  { key: 'archived', label: 'Archivés' },
  { key: 'pending',  label: 'À valider' },
];

const fmtDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function toCsv(rows) {
  const head = ['Nom', 'Client', 'Email', 'Code', 'Début', 'Fin', 'Statut', 'Impressions'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((ev) => [
    ev.name, ev.client_name, ev.client_email, ev.access_code,
    ev.start_date ?? '', ev.end_date ?? '', computeEventStatus(ev).label, ev._prints ?? 0,
  ].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\n');
}

export default function AdminEvents() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [printTotals, setPrintTotals] = useState({});
  const [pendingDesigns, setPendingDesigns] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const initialFilter = STATUS_FILTERS.some(f => f.key === searchParams.get('filter')) ? searchParams.get('filter') : 'all';
  const [statusFilter, setStatusFilter] = useState(initialFilter);

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

    const [{ data: eventsData }, { data: logsData }, { data: designsData }] = await Promise.all([
      supabase
        .from('events')
        .select('id, name, client_name, client_email, start_date, end_date, access_code, status, created_at, expires_at, max_prints:form_config->kiosk->result->max_prints_per_event')
        .order('created_at', { ascending: false }),
      supabase.from('print_logs').select('event_id, copies'),
      supabase.from('client_designs').select('event_id').eq('status', 'submitted'),
    ]);

    const totals = {};
    for (const row of logsData ?? []) totals[row.event_id] = (totals[row.event_id] ?? 0) + row.copies;

    setEvents(eventsData ?? []);
    setPrintTotals(totals);
    setPendingDesigns(new Set((designsData ?? []).map(d => d.event_id)));
    setLoading(false);
  }

  // Filtrage par onglet de statut (la recherche/tri/pagination sont gérés par le DataTable)
  const rows = useMemo(() => events.filter(ev => {
    if (statusFilter === 'pending') return pendingDesigns.has(ev.id);
    if (statusFilter === 'all') return true;
    return computeEventStatus(ev).key === statusFilter;
  }).map(ev => ({ ...ev, _prints: printTotals[ev.id] ?? 0 })), [events, statusFilter, pendingDesigns, printTotals]);

  function copyCode(code) {
    navigator.clipboard?.writeText(code);
    toast.success('Code copié');
  }

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `evenements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
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
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span>{ev.name || <span className="italic text-muted-foreground">Sans nom</span>}</span>
            {pendingDesigns.has(ev.id) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />À valider
              </span>
            )}
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
          <div className="text-muted-foreground">
            <div>{ev.client_name ?? '—'}</div>
            {ev.client_email && <div className="text-xs text-muted-foreground/70">{ev.client_email}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: 'access_code',
      header: 'Code',
      meta: { label: 'Code' },
      cell: ({ row }) => (
        <code className="bg-primary/10 text-primary px-2 py-0.5 rounded font-mono text-xs font-bold tracking-widest">
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
          <div className="flex flex-col gap-0.5 text-muted-foreground">
            <span>{fmtDateTime(ev.start_date)}</span>
            {ev.end_date && ev.end_date !== ev.start_date && (
              <span className="text-xs text-muted-foreground/70">→ {fmtDateTime(ev.end_date)}</span>
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
        if (max == null && done === 0) return <span className="text-muted-foreground/50">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{done}/{max ?? '∞'}</span>
            <span className="text-xs text-muted-foreground/70">réalisé/max</span>
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
      cell: ({ row }) => <StatusBadge ev={row.original} />,
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
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => navigate(ev.id)}>
                <ExternalLink className="w-4 h-4" />Ouvrir le détail
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyCode(ev.access_code)}>
                <Copy className="w-4 h-4" />Copier le code
              </DropdownMenuItem>
              {pendingDesigns.has(ev.id) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate(`${ev.id}?tab=template`)}>
                    <ClipboardCheck className="w-4 h-4" />Valider le template
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], [navigate, pendingDesigns]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Événements</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {loading ? 'Chargement…' : `${events.length} événement${events.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <Button onClick={() => navigate('new')} className="self-start sm:self-auto">
          <Plus className="w-4 h-4" />
          Nouvel événement
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Rechercher par nom, client, code…"
        onRowClick={(ev) => navigate(ev.id)}
        emptyMessage="Aucun événement ne correspond aux filtres."
        toolbarLeft={
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList className="h-9">
              {STATUS_FILTERS.map(sf => (
                <TabsTrigger key={sf.key} value={sf.key} className="text-xs px-2.5">
                  {sf.label}
                  {sf.key === 'pending' && pendingDesigns.size > 0 && (
                    <span className="ml-1 px-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">{pendingDesigns.size}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        toolbarRight={
          <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4" />Export
          </Button>
        }
      />
    </div>
  );
}
