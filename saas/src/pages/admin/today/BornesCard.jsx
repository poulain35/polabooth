// Carte « Bornes » de la page Aujourd'hui (LAB-364) : état en direct du parc (en ligne, imprimante,
// appareil photo), d'après le dernier signal de chaque borne. Amorcée par les licences déjà lues par
// la page, puis relue à chaque signal ou changement de licence. Sans borne active : rien.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { supabase, fetchLicenses } from '../../../lib/supabase';
import { Card, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Meter } from '../../../components/ui/meter';
import { StatusPill } from '../../../components/ui/status-pill';
import { cn } from '../../../lib/utils';
import { timeAgo } from '../../../lib/todayItems';

const PRINTER_BAD = ['paper_out', 'paper_jam', 'error', 'offline', 'not_found'];
const PRINTER_LABEL = {
  ready: 'Imprimante prête', offline: 'Impr. hors ligne', paper_out: 'Plus de papier',
  paper_jam: 'Bourrage', error: 'Erreur impr.', not_found: 'Impr. introuvable', unknown: 'Impr. inconnue',
};
const ONLINE_WINDOW_MS = 5 * 60_000;

const isOnline = (lastSeenAt) => !!lastSeenAt && (Date.now() - new Date(lastSeenAt).getTime()) < ONLINE_WINDOW_MS;
const hasIssue = (l) => !isOnline(l.last_seen_at) || PRINTER_BAD.includes(l.printer_status) || l.camera_status === 'disconnected';
const printerTone = (status) => (PRINTER_BAD.includes(status) ? 'red' : status === 'ready' ? 'green' : 'gray');

function BorneRow({ license }) {
  const online = isOnline(license.last_seen_at);
  return (
    <li>
      <Link to="/admin/bornes"
        className="-mx-3 flex items-start gap-3.5 rounded-xl px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <IconCircle tone="sand"><Camera /></IconCircle>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="min-w-0 max-w-full truncate text-sm font-medium text-foreground">{license.label ?? license.machine_id}</span>
            <StatusPill tone={online ? 'green' : 'gray'}>{online ? 'En ligne' : 'Hors ligne'}</StatusPill>
          </span>
          {!online && (
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              {license.last_seen_at ? `Vue ${timeAgo(license.last_seen_at)}` : 'Jamais vue'}
            </span>
          )}
          {(license.printer_status || license.camera_status === 'disconnected') && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {license.printer_status && (
                <StatusPill tone={printerTone(license.printer_status)}>
                  {PRINTER_LABEL[license.printer_status] ?? license.printer_status}
                </StatusPill>
              )}
              {license.camera_status === 'disconnected' && <StatusPill tone="red">Appareil débranché</StatusPill>}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** `initialLicenses` : licences déjà lues par la page (retirées comprises), affichées en attendant la relecture. */
export default function BornesCard({ initialLicenses, className }) {
  const [fresh, setFresh] = useState(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try { const l = await fetchLicenses({ includeRetired: true }); if (alive) setFresh(l); } catch { /* non bloquant */ }
    }
    refresh();
    const channel = supabase
      .channel('today-licenses-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_licenses' }, refresh)
      .subscribe();
    // Filet : garde « en ligne » et « vue il y a… » à jour même sans événement.
    const timer = setInterval(refresh, 30_000);
    return () => { alive = false; supabase.removeChannel(channel); clearInterval(timer); };
  }, []);

  const fleet = (fresh ?? initialLicenses ?? []).filter((l) => l.is_active && !l.retired_at);
  if (fleet.length === 0) return null;

  const onlineCount = fleet.filter((l) => isOnline(l.last_seen_at)).length;
  const issueCount = fleet.filter(hasIssue).length;
  const sorted = [...fleet].sort((a, b) => (hasIssue(b) ? 1 : 0) - (hasIssue(a) ? 1 : 0));

  return (
    <section aria-labelledby="today-bornes" className={cn('flex', className)}>
      <Card className="w-full p-card">
        <div className="flex items-center justify-between gap-3">
          <CardTitle as="h2" id="today-bornes">Bornes</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/bornes" aria-label="Gérer les bornes">Gérer</Link>
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-foreground">{onlineCount} sur {fleet.length} en ligne</p>
          {issueCount > 0 && <StatusPill tone="red">{issueCount} à surveiller</StatusPill>}
        </div>
        <Meter tone="brand" value={onlineCount} max={fleet.length} aria-label="Bornes en ligne" className="mt-2" />
        <ul className="mt-2 divide-y">
          {sorted.map((license) => <BorneRow key={license.id} license={license} />)}
        </ul>
      </Card>
    </section>
  );
}
