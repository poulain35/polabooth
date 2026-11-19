// Trois chiffres de la page Aujourd'hui (LAB-336) : signé ce mois (module), événements à venir, impressions.
// Une tuile = rond d'icône pastel + libellé + grand chiffre ; une tuile avec `to` est un lien.
import { createElement } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Camera, ChartNoAxesColumn, Euro, Printer } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Skeleton } from '../../../components/ui/skeleton';

// Icône et pastel par chiffre ; un chiffre inconnu (autre module) : graphique, lilas.
const TILES = {
  signed: { icon: Euro, tone: 'peach' },
  upcoming: { icon: CalendarDays, tone: 'sand' },
  prints: { icon: Printer, tone: 'mint' },
  photos: { icon: Camera, tone: 'navy' },
};
const DEFAULT_TILE = { icon: ChartNoAxesColumn, tone: 'navy' };

function Figure({ figure, loading }) {
  const tile = TILES[figure.id] ?? DEFAULT_TILE;
  const body = (
    <Card className={`h-full p-card ${figure.to ? 'transition-colors group-hover:bg-soft' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <IconCircle tone={tile.tone}>{createElement(tile.icon)}</IconCircle>
        {figure.to && <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="mt-4 text-[13px] text-muted-foreground">{figure.label}</p>
      {loading
        ? <Skeleton className="mt-1.5 h-9 w-24" />
        : <p className="mt-1 break-words text-figure tabular-nums text-foreground">{figure.value}</p>}
      {figure.sub && <p className="mt-1 text-[13px] text-muted-foreground">{figure.sub}</p>}
    </Card>
  );
  if (!figure.to) return body;
  return (
    <Link to={figure.to}
      className="group block h-full rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      {body}
    </Link>
  );
}

export default function TodayFigures({ figures, loading }) {
  return (
    <section aria-label="Chiffres" className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-5">
      {figures.map((figure) => <Figure key={figure.id} figure={figure} loading={loading} />)}
    </section>
  );
}
