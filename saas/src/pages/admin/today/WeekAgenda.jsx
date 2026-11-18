// « Cette semaine » de la page Aujourd'hui (LAB-336) : événements, retraits et retours sur 7 jours.
// Une ligne = pavé de date pastel + qui + quand (jour, heure, contexte) + étiquette de la sorte de ligne.
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { Card, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../lib/utils';

const DAY_NUMBER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'Europe/Paris' });
const MONTH_SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'Europe/Paris' });

// Pastel du pavé de date par sorte de ligne ; une sorte inconnue (autre module) : lilas.
const DATE_TONE = {
  event: 'bg-pastel-sky text-pastel-sky-ink',
  retrait: 'bg-pastel-mint text-pastel-mint-ink',
  retour: 'bg-pastel-peach text-pastel-peach-ink',
};
const DEFAULT_TONE = 'bg-pastel-lilac text-pastel-lilac-ink';

function DateTile({ entry }) {
  const date = new Date(entry.date);
  return (
    <span aria-hidden="true"
      className={cn('flex h-[50px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[14px] leading-tight', DATE_TONE[entry.kind] ?? DEFAULT_TONE)}>
      <span className="text-[17px] font-medium">{DAY_NUMBER.format(date)}</span>
      <span className="text-[10px]">{MONTH_SHORT.format(date)}</span>
    </span>
  );
}

function WeekRow({ day, entry }) {
  const when = [day.title, entry.time, entry.context].filter(Boolean).join(' · ');
  return (
    <li>
      <Link to={entry.href}
        className="-mx-3 flex items-center gap-3.5 rounded-xl px-3 py-3 transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <DateTile entry={entry} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{entry.title}</span>
          <span className="block truncate text-[13px] text-muted-foreground" title={when}>{when}</span>
        </span>
        {entry.label && <Badge variant="secondary" className="shrink-0">{entry.label}</Badge>}
      </Link>
    </li>
  );
}

export default function WeekAgenda({ days, loading, className }) {
  return (
    <section aria-labelledby="today-week" className={cn('flex', className)}>
      <Card className="w-full p-card">
        <CardTitle as="h2" id="today-week" className="mb-1.5">Cette semaine</CardTitle>
        {loading && days.length === 0 ? (
          <div className="space-y-3 pt-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-[50px] rounded-xl" />)}
          </div>
        ) : days.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <IconCircle tone="sky"><CalendarDays /></IconCircle>
            <p className="text-sm text-muted-foreground">Rien de prévu dans les 7 prochains jours</p>
          </div>
        ) : (
          <ul className="divide-y">
            {days.flatMap((day) => day.entries.map((entry) => <WeekRow key={entry.id} day={day} entry={entry} />))}
          </ul>
        )}
      </Card>
    </section>
  );
}
