// Section repliée en bas de la page Aujourd'hui (LAB-336) : tunnel de vente (module), activité des
// 30 derniers jours, événements par statut, dernières photos et impressions.
// Blocs repris de l'ancien tableau de bord ; ses données ne sont lues qu'à l'ouverture de la section.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Printer } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { IconCircle } from '../../../components/ui/icon-circle';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Skeleton } from '../../../components/ui/skeleton';
import { useFeatures } from '../../../hooks/useFeatures';
import { timeAgo } from '../../../lib/todayItems';
import ModuleSlot from '../../../components/ModuleSlot';

const METRICS = [
  { value: 'photos', label: 'Photos', color: 'hsl(var(--chart-1))' },
  { value: 'prints', label: 'Impressions', color: 'hsl(var(--chart-2))' },
];

// Le thème n'a que deux couleurs de série : le graphe par statut reprend les encres des pastilles d'état,
// pour qu'un statut ait la même couleur ici et dans les listes.
const STATUSES = {
  unplanned: { label: 'À planifier', color: 'hsl(var(--state-amber-fg))', dot: 'bg-state-amber-fg' },
  upcoming: { label: 'À venir', color: 'hsl(var(--state-blue-fg))', dot: 'bg-state-blue-fg' },
  ongoing: { label: 'En cours', color: 'hsl(var(--state-violet-fg))', dot: 'bg-state-violet-fg' },
  finished: { label: 'Terminé', color: 'hsl(var(--state-green-fg))', dot: 'bg-state-green-fg' },
  archived: { label: 'Archivé', color: 'hsl(var(--state-gray-fg))', dot: 'bg-state-gray-fg' },
};

const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
const TOOLTIP_STYLE = {
  borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12,
  background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))',
};

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

function CardHeading({ title, description, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <CardTitle as="h2">{title}</CardTitle>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** statusCounts : nombre d'événements par statut (calculé par la page). */
export default function ActivitySection({ stats, statusCounts, salesData, salesLoading, loading }) {
  const [series30, setSeries30] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [overviewMetric, setOverviewMetric] = useState('photos');
  const { isAvailable } = useFeatures();

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const since = new Date(Date.now() - 30 * 864e5).toISOString();
        const [photoRes, printRes] = await Promise.all([
          supabase.from('photos').select('created_at').gte('created_at', since),
          supabase.from('print_logs').select('printed_at, copies').gte('printed_at', since),
        ]);
        if (!alive) return;
        const d30 = lastNDays(30);
        for (const p of photoRes.data ?? []) { const b = bucketOf(d30, p.created_at); if (b) b.photos += 1; }
        for (const p of printRes.data ?? []) { const b = bucketOf(d30, p.printed_at); if (b) b.prints += (p.copies ?? 1); }
        setSeries30(d30.map((d) => ({ label: d.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), photos: d.photos, prints: d.prints })));
      } finally {
        if (alive) setSeriesLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

  const metric = METRICS.find((m) => m.value === overviewMetric) ?? METRICS[0];
  const statusData = Object.entries(statusCounts ?? {})
    .filter(([key, value]) => value > 0 && STATUSES[key])
    .map(([key, value]) => ({ key, name: STATUSES[key].label, value, color: STATUSES[key].color, dot: STATUSES[key].dot }));
  const statusTotal = statusData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex flex-col gap-5">
      <ModuleSlot name="dashboard.pipeline" data={salesData} loading={salesLoading} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="min-w-0 p-card lg:col-span-2">
          <CardHeading title="Activité — 30 derniers jours" description="Volume quotidien capturé par les bornes">
            <SegmentedControl aria-label="Série affichée" value={overviewMetric} onValueChange={setOverviewMetric} options={METRICS} />
          </CardHeading>
          {seriesLoading ? (
            <Skeleton className="h-[240px] rounded-xl" />
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series30} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey={metric.value} name={metric.label}
                    stroke={metric.color} strokeWidth={2} fill={metric.color} fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="min-w-0 p-card">
          <CardHeading title="Événements par statut" description="Répartition de tous les événements" />
          {loading ? (
            <Skeleton className="h-[200px] rounded-xl" />
          ) : statusData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Aucun événement</p>
          ) : (
            <>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                      {statusData.map((d) => <Cell key={d.key} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1.5">
                {statusData.map((d) => (
                  <li key={d.key} className="flex items-center gap-2 text-[13px]">
                    <span className={`size-2.5 shrink-0 rounded-full ${d.dot}`} aria-hidden="true" />
                    <span className="flex-1 text-muted-foreground">{d.name}</span>
                    <span className="font-medium tabular-nums text-foreground">{Math.round((d.value / statusTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-5">
        {isAvailable('gallery') && (
          <Card className="min-w-0 p-card">
            <CardHeading title="Dernières photos">
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/events?etape=a-livrer" aria-label="Voir toutes les photos à livrer">Voir tout</Link>
              </Button>
            </CardHeading>
            {loading ? (
              <div className="grid grid-cols-3 gap-1.5">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
              </div>
            ) : stats?.recentPhotos?.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Aucune photo pour l’instant</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {stats?.recentPhotos?.map((photo) => (
                  <Link key={photo.id} to={`/admin/events/${photo.event_id}?tab=livraison`}
                    className="aspect-square overflow-hidden rounded-xl bg-muted transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <img
                      src={photo.thumbnail_url ?? photo.photo_url}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className="min-w-0 p-card">
          <CardHeading title="Dernières impressions" />
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
            </div>
          ) : stats?.recentPrints?.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucune impression récente</p>
          ) : (
            <ul className="-mt-2 divide-y">
              {stats?.recentPrints?.map((print) => (
                <li key={print.id}>
                  <Link to={`/admin/events/${print.event_id}`}
                    className="-mx-3 flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <IconCircle size="sm" tone="lilac"><Printer /></IconCircle>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{print.events?.name ?? '—'}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {print.machine_id ? `${print.machine_id} · ` : ''}{timeAgo(print.printed_at)}
                      </span>
                    </span>
                    <Badge variant="secondary" className="shrink-0 tabular-nums" title="Exemplaires">{print.copies}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
