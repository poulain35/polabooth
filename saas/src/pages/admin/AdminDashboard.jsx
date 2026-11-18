// Page « Aujourd'hui » de l'admin (/admin/aujourdhui, LAB-336, spec refonte-navigation-admin L2).
// La liste « À faire » est triée par urgence (chargée par le layout, TodayContext, pour que le badge du
// menu compte les mêmes lignes) ; sa première action est reprise en haut, à côté de « Cette semaine ».
// Puis trois chiffres, la liste et l'état des bornes, et les graphiques de l'ancien tableau de bord
// repliés en bas. Tout en haut, la carte « Mise en route » (LAB-344) tant qu'elle n'est pas masquée.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { supabase, getDashboardStats } from '../../lib/supabase';
import { groupTodayItems, todayFigures, weekAgenda, weekEventEntries } from '../../lib/todayItems';
import { useFeatures } from '../../hooks/useFeatures';
import { moduleHook } from '../../features/modules';
import { useToday } from './today/useTodayItems';
import TodayHero from './today/TodayHero';
import TodayList from './today/TodayList';
import BornesCard from './today/BornesCard';
import SetupCard from './today/SetupCard';
import WeekAgenda from './today/WeekAgenda';
import TodayFigures from './today/TodayFigures';
import ActivitySection from './today/ActivitySection';
import { CardTitle } from '../../components/ui/card';
import { Notice } from '../../components/admin/CardParts';

const ACTIVITY_OPEN_KEY = 'admin.today.activityOpen';

function computeStatus(ev, now) {
  if (ev.status === 'archived') return 'archived';
  const start = ev.start_date ? new Date(ev.start_date).getTime() : null;
  const end = ev.end_date ? new Date(ev.end_date).getTime() : null;
  if (!start) return 'unplanned';
  if (start > now) return 'upcoming';
  if (end && end < now) return 'finished';
  return 'ongoing';
}

function readActivityOpen() {
  try { return localStorage.getItem(ACTIVITY_OPEN_KEY) === '1'; } catch { return false; }
}

/** Contribution d'un module chargée si sa fonctionnalité est disponible (crochet `name`), sinon []. */
async function runModuleList(name, isAvailable) {
  const hook = moduleHook(name);
  if (!hook || !isAvailable(hook.feature)) return [];
  try { return (await hook.run()) ?? []; } catch { return []; }
}

export default function AdminDashboard() {
  const today = useToday();
  const { refreshIfStale } = today;
  const { isAvailable } = useFeatures();
  const [stats, setStats] = useState(null);
  const [statusCounts, setStatusCounts] = useState(null);
  const [moduleWeek, setModuleWeek] = useState([]);
  const [moduleFigures, setModuleFigures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activityOpen, setActivityOpen] = useState(readActivityOpen);

  // Liste « À faire » relue à l'ouverture de la page (sauf si elle vient d'être lue).
  useEffect(() => { refreshIfStale(5_000); }, [refreshIfStale]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [s, allEventsRes] = await Promise.all([
          getDashboardStats(),
          supabase.from('events').select('start_date, end_date, status'),
        ]);
        if (!alive) return;
        const now = Date.now();
        const counts = { unplanned: 0, upcoming: 0, ongoing: 0, finished: 0, archived: 0 };
        for (const ev of allEventsRes.data ?? []) counts[computeStatus(ev, now)]++;
        setStats(s);
        setStatusCounts(counts);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

  // Retraits et retours (logistique) et « Signé ce mois » : fournis par le module de réservation.
  const bookingReady = isAvailable('booking');
  useEffect(() => {
    let alive = true;
    Promise.all([runModuleList('dashboard.week', isAvailable), runModuleList('dashboard.figures', isAvailable)])
      .then(([week, figures]) => {
        if (!alive) return;
        setModuleWeek(week);
        setModuleFigures(figures);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingReady]);

  const week = useMemo(() => {
    const licenses = today.licenses ?? [];
    const borneLabel = (id) => {
      const pb = id ? licenses.find((l) => l.id === id) : null;
      return pb ? (pb.label ?? pb.machine_id) : null;
    };
    const events = [...(stats?.activeEvents ?? []), ...(stats?.upcomingEvents ?? [])];
    const unique = [...new Map(events.map((e) => [e.id, e])).values()];
    return weekAgenda([...weekEventEntries(unique, borneLabel), ...moduleWeek]);
  }, [stats, moduleWeek, today.licenses]);

  const now = new Date();
  const figures = todayFigures({
    moduleFigures,
    upcomingEvents: statusCounts?.upcoming ?? 0,
    printsThisMonth: stats?.printsThisMonth ?? 0,
    photosThisMonth: stats?.photosThisMonth ?? 0,
    month: now.toLocaleDateString('fr-FR', { month: 'long' }),
  });

  async function showSetup() {
    try {
      await today.showSetup();
    } catch {
      toast.error('Impossible de réafficher la mise en route. Réessayez.');
    }
  }

  function toggleActivity() {
    setActivityOpen((open) => {
      try { localStorage.setItem(ACTIVITY_OPEN_KEY, open ? '0' : '1'); } catch { /* préférence locale */ }
      return !open;
    });
  }

  // Première ligne affichée de la liste « À faire » (premier groupe non vide).
  const firstItem = groupTodayItems(today.items)[0]?.items[0];

  const setupLink = today.setupHidden && today.setup && !today.setup.complete && (
    <Button variant="link" size="sm" className="px-0 text-muted-foreground" onClick={showSetup}>
      Mise en route masquée ({today.setup.done}/{today.setup.total}) · Afficher
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title="Aujourd’hui"
        description={now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />

      {error && <Notice tone="red" role="alert">{error}</Notice>}

      {!today.setupHidden && <SetupCard setup={today.setup} onHide={today.hideSetup} onShow={today.showSetup} />}

      <div className="flex flex-wrap gap-5">
        <TodayHero item={firstItem} onAck={today.ack} className="min-w-0 flex-[1.55_1_480px]" />
        <WeekAgenda days={week} loading={loading} className="min-w-0 flex-[1_1_320px]" />
      </div>

      <TodayFigures figures={figures} loading={loading} />

      <div className="flex flex-wrap gap-5">
        <TodayList items={today.items} hiddenItems={today.hiddenItems} loading={today.loading} error={today.error}
          onAck={today.ack} onDismiss={today.dismiss} onRestore={today.restore} footer={setupLink || null}
          className="min-w-0 flex-[1.55_1_480px]" />
        <BornesCard initialLicenses={today.licenses} className="min-w-0 flex-[1_1_320px]" />
      </div>

      <section aria-labelledby="today-activity">
        <button type="button" onClick={toggleActivity} aria-expanded={activityOpen} aria-controls="today-activity-panel"
          className="flex w-full items-center justify-between gap-3 rounded-card bg-card px-card py-4 text-left shadow-card transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <CardTitle as="span" id="today-activity">Activité et graphiques</CardTitle>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${activityOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {activityOpen && (
          <div id="today-activity-panel" className="mt-5">
            <ActivitySection stats={stats} statusCounts={statusCounts} salesData={today.sales} salesLoading={today.loading} loading={loading} />
          </div>
        )}
      </section>
    </PageContainer>
  );
}
