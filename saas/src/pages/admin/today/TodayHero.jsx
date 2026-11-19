// « À faire en premier » de la page Aujourd'hui (LAB-364) : la première action de la liste « À faire »
// (la plus urgente), mise en avant dans une carte jaune (couleur du logo). Même lien et même accusé de réception que sa
// ligne dans la liste, où elle reste affichée (report et masquage se font là).
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { StatusPill } from '../../../components/ui/status-pill';
import { cn } from '../../../lib/utils';
import { todayWhen } from '../../../lib/todayItems';

export default function TodayHero({ item, onAck, className }) {
  if (!item) return null;
  const why = [item.context, todayWhen(item)].filter(Boolean).join(' · ');
  const handleClick = item.notificationId ? () => onAck?.(item.notificationId) : undefined;
  return (
    <section aria-labelledby="today-first" className={cn('flex', className)}>
      <Card tone="brand" className="flex w-full flex-col items-start justify-center p-card sm:p-7">
        <StatusPill tone="white" dot={false}><Clock aria-hidden="true" />À faire en premier</StatusPill>
        <h2 id="today-first" className="mt-3.5 max-w-[520px] break-words text-[22px] leading-tight tracking-[-0.02em] sm:text-[26px]">
          {item.label && <span className="sr-only">{item.label} : </span>}
          {item.title}
        </h2>
        {why && <p className="mt-2 max-w-[460px] break-words text-sm text-ink">{why}</p>}
        <Button asChild variant="strong" className="mt-[18px] max-w-full">
          <Link to={item.href} onClick={handleClick}>{item.actionLabel}</Link>
        </Button>
      </Card>
    </section>
  );
}
