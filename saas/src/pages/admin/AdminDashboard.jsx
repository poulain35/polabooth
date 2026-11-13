import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Calendar, Image as ImageIcon, Printer, ImagePlus } from 'lucide-react';
import { supabase, getDashboardStats, fetchLicenses, getGuestExportReminders } from '../../lib/supabase';
import { exportReminderBadge, exportReminderDetail, exportReminderText } from '../../lib/guestExportReminder';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useFeatures } from '../../hooks/useFeatures';
import { moduleHook } from '../../features/modules';
import ModuleSlot from '../../components/ModuleSlot';

// Palette graphiques
const C = {
  events:  '#3b82f6',
  photos:  '#7c3aed',
  prints:  '#ec4899',
  pending: '#f59e0b',
};
const STATUS_COLORS = { unplanned: '#a855f7', upcoming: '#0ea5e9', ongoing: '#10b981', finished: '#f59e0b', archived: '#94a3b8' };
const STATUS_LABELS = { unplanned: 'À planifier', upcoming: 'À venir', ongoing: 'En cours', finished: 'Terminé', archived: 'Archivé' };

// Buckets journaliers des N derniers jours
function lastNDays(n) {
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push({ key: d.toISOString().slice(0, 10), date: d, events: 0, photos: 0, prints: 0, pending: 0 });
  }
  return days;
}
function bucketOf(days, iso) {
  if (!iso) return null;
  const key = new Date(iso).toISOString().slice(0, 10);
  return days.find((d) => d.key === key) ?? null;
}
function computeStatus(ev) {
  if (ev.status === 'archived') return 'archived';
  const now = Date.now();
  const start = ev.start_date ? new Date(ev.start_date).getTime() : null;
  const end = ev.end_date ? new Date(ev.end_date).getTime() : null;
  if (!start) return 'unplanned';
  if (start > now) return 'upcoming';
  if (end && end < now) return 'finished';
  return 'ongoing';
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

// Santé parc : état live des machines (réutilise les colonnes du heartbeat kiosk)
const PRINTER_BAD = ['paper_out', 'paper_jam', 'error', 'offline', 'not_found'];
const PRINTER_LABEL = {
  ready: 'Imprimante prête', offline: 'Impr. hors ligne', paper_out: 'Plus de papier',
  paper_jam: 'Bourrage', error: 'Erreur impr.', not_found: 'Impr. introuvable', unknown: 'Impr. inconnue',
};
const CAMERA_LABEL = { ok: 'Appareil OK', disconnected: 'Appareil débranché' };
function hasIssue(l) {
  return !isOnline(l.last_seen_at) || PRINTER_BAD.includes(l.printer_status) || l.camera_status === 'disconnected';
}
function isOnline(lastSeenAt) {
  return !!lastSeenAt && (Date.now() - new Date(lastSeenAt).getTime()) < 5 * 60_000;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtDateLong(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function isThisWeek(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return d >= now && d <= in7;
}

// ── KPI Card avec sparkline ──────────────────────────────────────────────────
function KpiCard({ label, value, sub, Icon, color, spark, dataKey, loading, to }) {
  const content = (
    <Card className={`rounded-2xl p-5 flex flex-col gap-3 overflow-hidden ${to ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
          {loading
            ? <Skeleton className="h-8 w-20 rounded-lg mt-1.5" />
            : <p className="text-2xl font-bold text-foreground leading-tight mt-1">{value}</p>}
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
      </div>
      {!loading && spark?.length > 0 && (
        <div className="h-9 -mx-1 -mb-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.8} fill={`url(#spark-${dataKey})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

// ── Section title ─────────────────────────────────────────────────────────────
function SectionTitle({ children }) {
  return <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</h2>;
}

// Carte « Contacts à exporter » (LAB-224) : réponses du questionnaire de la borne avant leur suppression
function GuestExportCard({ reminder: r }) {
  const tone = r.urgent
    ? { border: 'border-red-200 hover:border-red-300', iconBg: 'bg-red-100', icon: 'text-red-600', badge: 'bg-red-600 text-white', chevron: 'group-hover:text-red-500' }
    : { border: 'border-teal-200', iconBg: 'bg-teal-100', icon: 'text-teal-600', badge: 'bg-teal-100 text-teal-700', chevron: 'group-hover:text-teal-500' };
  return (
    <Link to={`/admin/events/${r.eventId}?tab=questionnaire`} title={exportReminderText(r)}
      className={`flex items-center gap-3 bg-card rounded-2xl border ${tone.border} p-4 shadow-sm hover:shadow-md transition-all group`}>
      <div className={`w-9 h-9 rounded-xl ${tone.iconBg} flex items-center justify-center shrink-0`}>
        <svg className={`w-4 h-4 ${tone.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{r.eventName}</p>
        <p className="text-xs text-gray-400 mt-0.5">{exportReminderDetail(r)}</p>
      </div>
      <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${tone.badge}`}>{exportReminderBadge(r)}</span>
      <svg className={`w-4 h-4 text-gray-300 ${tone.chevron} transition-colors shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [stats,      setStats]      = useState(null);
  const [licenses,   setLicenses]   = useState([]);
  const [series30,   setSeries30]   = useState([]);   // aires Overview (30 j)
  const [spark14,    setSpark14]    = useState([]);   // sparklines KPI (14 j)
  const [statusData, setStatusData] = useState([]);   // donut par statut
  const [statusCounts, setStatusCounts] = useState({ unplanned: 0, upcoming: 0, ongoing: 0, finished: 0, archived: 0 }); // KPI en cours / à venir
  const [salesData,  setSalesData]  = useState(null);  // tunnel de vente et échéances (module réservation)
  const [guestReminders, setGuestReminders] = useState([]); // contacts invités à exporter (LAB-224)
  const [overviewMetric, setOverviewMetric] = useState('photos');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const { isAvailable } = useFeatures();

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const since = new Date(Date.now() - 30 * 864e5).toISOString();
        const salesLoad = moduleHook('dashboard.load');
        const [s, l, photoRes, printRes, eventRes, allEventsRes, sales, guests] = await Promise.all([
          getDashboardStats(),
          fetchLicenses({ includeRetired: true }), // retirées : couleur et nom des anciens événements
          supabase.from('photos').select('created_at').gte('created_at', since),
          supabase.from('print_logs').select('printed_at, copies').gte('printed_at', since),
          supabase.from('events').select('created_at').gte('created_at', since),
          supabase.from('events').select('start_date, end_date, status'),
          salesLoad ? salesLoad.run() : null,
          getGuestExportReminders().catch(() => []),
        ]);
        if (!alive) return;
        setStats(s); setLicenses(l);
        setSalesData(sales);
        setGuestReminders(guests);

        // Séries journalières
        const d30 = lastNDays(30);
        for (const p of photoRes.data ?? [])  { const b = bucketOf(d30, p.created_at); if (b) b.photos += 1; }
        for (const p of printRes.data ?? [])  { const b = bucketOf(d30, p.printed_at); if (b) b.prints += (p.copies ?? 1); }
        for (const e of eventRes.data ?? [])  { const b = bucketOf(d30, e.created_at); if (b) b.events += 1; }
        for (const d of s?.pendingDesigns ?? []) { const b = bucketOf(d30, d.submitted_at); if (b) b.pending += 1; }
        setSeries30(d30.map((d) => ({ label: d.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), photos: d.photos, prints: d.prints })));
        setSpark14(d30.slice(-14).map((d) => ({ events: d.events, photos: d.photos, prints: d.prints, pending: d.pending })));

        // Donut par statut
        const counts = { unplanned: 0, upcoming: 0, ongoing: 0, finished: 0, archived: 0 };
        for (const ev of allEventsRes.data ?? []) counts[computeStatus(ev)]++;
        setStatusCounts(counts);
        setStatusData(Object.entries(counts)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => ({ name: STATUS_LABELS[k], value: v, color: STATUS_COLORS[k] })));
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    // Rafraîchit uniquement l'état du parc (léger) sur heartbeat / changement de licence
    async function refreshLicenses() {
      try { const l = await fetchLicenses({ includeRetired: true }); if (alive) setLicenses(l); } catch { /* non bloquant */ }
    }

    load();

    // Temps réel : un heartbeat kiosk met à jour la carte « Santé du parc » sans recharger
    const channel = supabase
      .channel('dashboard-licenses-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_licenses' }, refreshLicenses)
      .subscribe();

    // Filet : garde les « il y a X min » / statut en ligne à jour même sans événement
    const timer = setInterval(refreshLicenses, 30_000);

    return () => { alive = false; supabase.removeChannel(channel); clearInterval(timer); };
  }, []);

  function pbColor(photoboothId) {
    return licenses.find(l => l.id === photoboothId)?.color ?? '#d1d5db';
  }
  function pbLabel(photoboothId) {
    const pb = licenses.find(l => l.id === photoboothId);
    return pb ? (pb.label ?? pb.machine_id) : null;
  }

  const now = new Date();
  const month = now.toLocaleDateString('fr-FR', { month: 'long' });

  // Events happening right now (start <= now <= end)
  const ongoingEvents = stats?.activeEvents?.filter(e =>
    e.start_date && e.end_date &&
    new Date(e.start_date) <= now && new Date(e.end_date) >= now
  ) ?? [];

  // Upcoming but not started yet
  const nextEvents = stats?.upcomingEvents?.filter(e =>
    !e.start_date || new Date(e.start_date) > now
  ) ?? [];

  // Compteurs En cours / À venir : calculés sur TOUS les événements (comme le donut
  // et la liste /admin/events, qui ne filtrent pas sur status='active'), sinon le KPI
  // sous-compte les événements au statut non 'active' et diverge de la liste filtrée.
  const ongoingCount  = statusCounts.ongoing;
  const upcomingCount = statusCounts.upcoming;

  // Active events without photobooth this week
  const noMachineWarnings = stats?.upcomingEvents?.filter(e =>
    !e.photobooth_id && isThisWeek(e.start_date)
  ) ?? [];

  // Widgets rattachés à une fonctionnalité activable : vides si elle est désactivée.
  const showDesigns = isAvailable('client_design');
  const pendingDesigns   = showDesigns ? (stats?.pendingDesigns ?? []) : [];
  const shownGuestReminders = isAvailable('guest_form') ? guestReminders : [];

  // Cartes « À faire » des modules installés (réservation : devis, nouveaux clients, échéances).
  const actionCount = moduleHook('dashboard.actionCount');
  const moduleActions = actionCount && isAvailable(actionCount.feature) ? actionCount.run(salesData, isAvailable) : 0;

  const hasActions =
    pendingDesigns.length > 0 ||
    noMachineWarnings.length > 0 ||
    moduleActions > 0 ||
    shownGuestReminders.length > 0;

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-2xl text-sm text-destructive">{error}</div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard
          label="En cours"
          value={loading ? '—' : ongoingCount}
          sub={ongoingCount > 0 ? 'En ce moment' : 'Aucun actuellement'}
          Icon={Calendar} color={STATUS_COLORS.ongoing} spark={spark14} dataKey="events"
          loading={loading} to="/admin/events?filter=ongoing"
        />
        <KpiCard
          label="À venir"
          value={loading ? '—' : upcomingCount}
          sub={upcomingCount > 0 ? 'À préparer →' : 'Rien de prévu'}
          Icon={Calendar} color={STATUS_COLORS.upcoming} spark={spark14} dataKey="events"
          loading={loading} to="/admin/events?filter=upcoming"
        />
        <KpiCard
          label={`Photos — ${month}`}
          value={loading ? '—' : (stats?.photosThisMonth ?? 0).toLocaleString('fr-FR')}
          sub="Depuis le kiosk"
          Icon={ImageIcon} color={C.photos} spark={spark14} dataKey="photos"
          loading={loading} to={isAvailable('gallery') ? '/admin/photos' : undefined}
        />
        <KpiCard
          label={`Impressions — ${month}`}
          value={loading ? '—' : (stats?.printsThisMonth ?? 0).toLocaleString('fr-FR')}
          sub="Copies imprimées"
          Icon={Printer} color={C.prints} spark={spark14} dataKey="prints"
          loading={loading}
        />
        {showDesigns && <KpiCard
          label="Templates en attente"
          value={loading ? '—' : (stats?.pendingDesigns?.length ?? 0)}
          sub={stats?.pendingDesigns?.length > 0 ? 'À valider →' : 'Aucune action requise'}
          Icon={ImagePlus} color={C.pending} spark={spark14} dataKey="pending"
          loading={loading}
          to={stats?.pendingDesigns?.length > 0 ? '/admin/events?filter=pending' : undefined}
        />}
      </div>

      {/* ── Pipeline commercial (module réservation) ── */}
      <ModuleSlot name="dashboard.pipeline" data={salesData} loading={loading} />

      {/* ── Overview (aires) + Donut par statut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Aires */}
        <Card className="rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-foreground">Activité — 30 derniers jours</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Volume quotidien capturé au kiosk</p>
            </div>
            <Tabs value={overviewMetric} onValueChange={setOverviewMetric}>
              <TabsList className="h-8">
                <TabsTrigger value="photos" className="text-xs px-2.5 py-1">Photos</TabsTrigger>
                <TabsTrigger value="prints" className="text-xs px-2.5 py-1">Impressions</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {loading ? (
            <Skeleton className="h-[240px] rounded-xl" />
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series30} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="ov" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={overviewMetric === 'photos' ? C.photos : C.prints} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={overviewMetric === 'photos' ? C.photos : C.prints} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Area type="monotone" dataKey={overviewMetric} name={overviewMetric === 'photos' ? 'Photos' : 'Impressions'}
                    stroke={overviewMetric === 'photos' ? C.photos : C.prints} strokeWidth={2} fill="url(#ov)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Donut par statut */}
        <Card className="rounded-2xl p-5">
          <h2 className="font-semibold text-foreground">Événements par statut</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">Répartition de tous les événements</p>
          {loading ? (
            <Skeleton className="h-[200px] rounded-xl" />
          ) : statusData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">Aucun événement</p>
          ) : (
            <>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                      {statusData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-2">
                {statusData.map((d) => {
                  const total = statusData.reduce((s, x) => s + x.value, 0);
                  return (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-muted-foreground flex-1">{d.name}</span>
                      <span className="font-semibold text-foreground">{Math.round((d.value / total) * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Colonne gauche (2/3) ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Actions requises */}
          {hasActions && (
            <div>
              <SectionTitle>À faire aujourd'hui</SectionTitle>
              <div className="space-y-2">

                {/* Contacts à exporter, suppression dans moins de 7 jours */}
                {shownGuestReminders.filter(r => r.urgent).map(r => <GuestExportCard key={`guest-${r.eventId}`} reminder={r} />)}

                {/* Devis à relancer, nouveaux clients, acomptes, soldes, logistique (module réservation) */}
                <ModuleSlot name="dashboard.actions" data={salesData} setData={setSalesData} />

                {/* Designs en attente */}
                {pendingDesigns.map(d => (
                  <Link key={d.id} to={`/admin/events/${d.event_id}?tab=template`}
                    className="flex items-center gap-3 bg-card rounded-2xl border border-amber-200 p-4 shadow-sm hover:shadow-md hover:border-amber-300 transition-all group">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {d.events?.name || 'Événement sans nom'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Template soumis {timeAgo(d.submitted_at)} · {d.events?.client_name ?? ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">À valider</span>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-amber-500 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}

                {/* Événements sans machine */}
                {noMachineWarnings.map(e => (
                  <Link key={e.id} to={`/admin/events/${e.id}`}
                    className="flex items-center gap-3 bg-card rounded-2xl border border-orange-200 p-4 shadow-sm hover:shadow-md transition-all group">
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.name || 'Événement sans nom'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Aucun photobooth assigné · {fmtDate(e.start_date)}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">Sans machine</span>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-orange-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}

                {/* Contacts à exporter, suppression plus lointaine */}
                {shownGuestReminders.filter(r => !r.urgent).map(r => <GuestExportCard key={`guest-${r.eventId}`} reminder={r} />)}
              </div>
            </div>
          )}

          {/* Agenda 7 jours */}
          <div>
            <SectionTitle>Agenda — 7 prochains jours</SectionTitle>
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
              </div>
            ) : ongoingEvents.length === 0 && nextEvents.length === 0 && (stats?.upcomingEvents?.length ?? 0) === 0 ? (
              <Card className="rounded-2xl p-8 text-center">
                <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-400">Aucun événement dans les 7 prochains jours</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {/* En cours maintenant */}
                {ongoingEvents.map(e => (
                  <Link key={e.id} to={`/admin/events/${e.id}`}
                    className="flex items-center gap-3 bg-card rounded-2xl border border-emerald-200 p-4 shadow-sm hover:shadow-md transition-all group">
                    <span className="w-3 h-3 rounded-full shrink-0 ring-2 ring-emerald-400 ring-offset-2 animate-pulse"
                      style={{ backgroundColor: pbColor(e.photobooth_id) }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.name || 'Sans nom'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {e.client_name && `${e.client_name} · `}
                        {fmtDate(e.start_date)} → {fmtDate(e.end_date)}
                        {pbLabel(e.photobooth_id) && ` · ${pbLabel(e.photobooth_id)}`}
                      </p>
                    </div>
                    <span className="shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      En cours
                    </span>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
                {/* À venir */}
                {stats?.upcomingEvents?.filter(e => !ongoingEvents.find(o => o.id === e.id)).map(e => (
                  <Link key={e.id} to={`/admin/events/${e.id}`}
                    className="flex items-center gap-3 bg-card rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all group">
                    <span className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: pbColor(e.photobooth_id) }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.name || 'Sans nom'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {e.client_name && `${e.client_name} · `}
                        {fmtDateLong(e.start_date)}
                        {pbLabel(e.photobooth_id) && ` · ${pbLabel(e.photobooth_id)}`}
                      </p>
                    </div>
                    {isToday(e.start_date) && (
                      <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">Aujourd'hui</span>
                    )}
                    {!e.photobooth_id && (
                      <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-100 text-orange-600">Sans machine</span>
                    )}
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-primary transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Colonne droite (1/3) ── */}
        <div className="space-y-6">

          {/* Santé du parc */}
          {(() => {
            const fleet = licenses.filter(l => l.is_active && !l.retired_at);
            if (loading || fleet.length === 0) return null;
            const onlineCount = fleet.filter(l => isOnline(l.last_seen_at)).length;
            const issues = fleet.filter(hasIssue);
            const sorted = [...fleet].sort((a, b) => (hasIssue(b) ? 1 : 0) - (hasIssue(a) ? 1 : 0));
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <SectionTitle>Santé du parc</SectionTitle>
                  <Link to="/admin/licenses" className="text-xs text-primary hover:text-primary font-medium transition-colors">Gérer →</Link>
                </div>
                <Card className="rounded-2xl overflow-hidden">
                  {/* Résumé */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${onlineCount === fleet.length ? 'text-emerald-600' : 'text-gray-600'}`}>
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {onlineCount}/{fleet.length} en ligne
                    </span>
                    {issues.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 ml-auto">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        {issues.length} à surveiller
                      </span>
                    )}
                  </div>
                  {/* Liste machines */}
                  {sorted.map((l, i) => {
                    const online = isOnline(l.last_seen_at);
                    const printerBad = PRINTER_BAD.includes(l.printer_status);
                    const cameraBad  = l.camera_status === 'disconnected';
                    return (
                      <Link key={l.id} to="/admin/licenses"
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                        <span className="relative flex h-2 w-2 shrink-0">
                          {online && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700 truncate">{l.label ?? l.machine_id}</p>
                          <p className="text-[11px] text-gray-400">
                            {online ? 'En ligne' : l.last_seen_at ? `Vue ${timeAgo(l.last_seen_at)}` : 'Jamais vue'}
                          </p>
                        </div>
                        {l.printer_status && (
                          <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            printerBad ? 'bg-red-50 text-red-600' : l.printer_status === 'ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${printerBad ? 'bg-red-500' : l.printer_status === 'ready' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                            {PRINTER_LABEL[l.printer_status] ?? l.printer_status}
                          </span>
                        )}
                        {cameraBad && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            {CAMERA_LABEL.disconnected}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </Card>
              </div>
            );
          })()}

          {/* Dernières photos */}
          {isAvailable('gallery') && <div>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Dernières photos</SectionTitle>
              <Link to="/admin/photos" className="text-xs text-primary hover:text-primary font-medium transition-colors">Voir tout →</Link>
            </div>
            {loading ? (
              <div className="grid grid-cols-3 gap-1.5">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
              </div>
            ) : stats?.recentPhotos?.length === 0 ? (
              <Card className="rounded-2xl p-6 text-center">
                <p className="text-sm text-gray-400">Aucune photo pour l'instant</p>
              </Card>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {stats?.recentPhotos?.map(photo => (
                  <Link key={photo.id} to={`/admin/photos/${photo.event_id}`}
                    className="aspect-square rounded-xl overflow-hidden bg-gray-100 hover:opacity-90 transition-opacity group relative">
                    <img
                      src={photo.thumbnail_url ?? photo.photo_url}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-xl" />
                  </Link>
                ))}
              </div>
            )}
          </div>}

          {/* Dernières impressions */}
          <div>
            <SectionTitle>Dernières impressions</SectionTitle>
            {loading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              </div>
            ) : stats?.recentPrints?.length === 0 ? (
              <Card className="rounded-2xl p-6 text-center">
                <p className="text-sm text-gray-400">Aucune impression récente</p>
              </Card>
            ) : (
              <Card className="rounded-2xl overflow-hidden">
                {stats?.recentPrints?.map((print, i) => (
                  <Link key={print.id} to={`/admin/events/${print.event_id}`}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                    <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 truncate">{print.events?.name ?? '—'}</p>
                      <p className="text-[11px] text-gray-400">
                        {print.machine_id ? `${print.machine_id} · ` : ''}{timeAgo(print.printed_at)}
                      </p>
                    </div>
                    <span className="shrink-0 w-6 h-6 rounded-full bg-violet-50 text-violet-700 text-xs font-bold flex items-center justify-center">
                      {print.copies}
                    </span>
                  </Link>
                ))}
              </Card>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
