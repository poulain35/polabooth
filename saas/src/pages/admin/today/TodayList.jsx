// Liste « À faire » de la page Aujourd'hui (LAB-336) : une carte, trois groupes (Urgent, Cette semaine,
// Plus tard). Une ligne = rond d'icône + qui (titre) + pourquoi et quand + bouton d'action + menu « ⋯ »
// pour reporter ou masquer l'action. Les actions masquées se retrouvent en bas de la carte.
import { createElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CalendarClock, Camera, CheckCircle2, ChevronDown, Clock, Download, Euro, EyeOff, FileText, Image, Inbox,
  ListChecks, ListTodo, MonitorSmartphone, MoreHorizontal, Package, PartyPopper, Phone, Receipt, RotateCcw, TriangleAlert, Truck,
} from 'lucide-react';
import { Card, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusPill } from '../../../components/ui/status-pill';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { cn } from '../../../lib/utils';
import { groupTodayItems, snoozeUntil, todayWhen, whenLabel } from '../../../lib/todayItems';
import { countLabel } from '../../../lib/format';
import { Notice } from '../../../components/admin/CardParts';

// Icône par sorte d'élément (`kind:reason` d'abord) ; une sorte inconnue (autre module) : ListTodo.
const ICONS = {
  alert: TriangleAlert,
  no_borne: Camera,
  design: Image,
  home_design: MonitorSmartphone,
  guest_export: Download,
  request: Inbox,
  quote: FileText,
  'quote:call': Phone,
  new_client: PartyPopper,
  deposit: Euro,
  balance: Receipt,
  logistics: Truck,
  setup: ListChecks,
  equipment: Package,
};
const iconOf = (item) => ICONS[`${item.kind}:${item.reason}`] ?? ICONS[item.kind] ?? ListTodo;

// Pastel du rond d'icône par sorte d'élément ; une sorte inconnue (autre module) : gris.
const ICON_TONES = {
  alert: 'rose',
  no_borne: 'peach',
  design: 'lemon',
  home_design: 'sand',
  guest_export: 'mint',
  request: 'navy',
  quote: 'navy',
  new_client: 'mint',
  deposit: 'peach',
  balance: 'peach',
  logistics: 'sand',
  setup: 'sand',
  equipment: 'rose',
};
const toneOf = (item) => ICON_TONES[item.kind] ?? 'muted';

// Pastille du titre de groupe : l'urgence se lit dans son libellé, pas dans sa seule couleur.
const GROUP_TONE = { urgent: 'red', week: 'amber', later: 'gray' };

const SNOOZES = [
  { days: 3, label: 'Me le rappeler dans 3 jours', Icon: Clock },
  { days: 7, label: 'Me le rappeler dans 1 semaine', Icon: CalendarClock },
];

function ItemIcon({ item, tone }) {
  return (
    <IconCircle tone={tone ?? toneOf(item)} title={item.label || undefined}>
      {createElement(iconOf(item))}
    </IconCircle>
  );
}

function TodayRow({ item, group, onAck, onDismiss }) {
  const why = [item.context, todayWhen(item)].filter(Boolean).join(' · ');
  const handleClick = item.notificationId ? () => onAck?.(item.notificationId) : undefined;
  const variant = group === 'urgent' ? 'default' : 'outline';
  return (
    <li className="flex items-start gap-3.5 py-3.5 sm:items-center">
      <ItemIcon item={item} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-foreground">
          {item.label && <span className="sr-only">{item.label} : </span>}
          {item.title}
        </p>
        {why && <p className="mt-0.5 break-words text-[13px] text-muted-foreground sm:truncate" title={why}>{why}</p>}
        <Button asChild size="sm" variant={variant} className="mt-2.5 sm:hidden">
          <Link to={item.href} onClick={handleClick}>{item.actionLabel}</Link>
        </Button>
      </div>
      <Button asChild size="sm" variant={variant} className="hidden shrink-0 sm:inline-flex">
        <Link to={item.href} onClick={handleClick}>{item.actionLabel}</Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={`Plus d’options pour « ${item.title} »`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {SNOOZES.map(({ days, label, Icon }) => (
            <DropdownMenuItem key={days} onSelect={() => onDismiss(item, snoozeUntil(days))}>
              <Icon className="size-4" />{label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDismiss(item, null)}>
            <EyeOff className="size-4" />Ne plus afficher
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function HiddenList({ items, onRestore }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="w-full">
      <Button variant="link" size="sm" className="px-0 text-muted-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {countLabel(items.length, 'action masquée', 'actions masquées')} · {open ? 'Cacher' : 'Afficher'}
        <ChevronDown className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </Button>
      {open && (
        <ul className="mt-1 divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3.5 py-3.5">
              <ItemIcon item={item} tone="muted" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-muted-foreground">{item.title}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {item.dismissedUntil ? `Reportée, revient ${whenLabel(item.dismissedUntil)}` : 'Masquée'}
                </p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onRestore(item)}>
                <RotateCcw />Remettre
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `footer` : ligne en bas de la carte (lien « Mise en route masquée »), sous les actions masquées. */
export default function TodayList({ items, hiddenItems = [], loading, error, onAck, onDismiss, onRestore, footer, className }) {
  const groups = groupTodayItems(items);

  const restore = async (item, { quiet = false } = {}) => {
    try {
      await onRestore?.(item);
      if (!quiet) toast.success('Action remise dans la liste');
    } catch {
      toast.error('Impossible de remettre cette action. Réessayez.');
    }
  };

  const dismiss = async (item, until) => {
    try {
      await onDismiss?.(item, until);
      toast.success(until ? `Reportée, elle reviendra ${whenLabel(until)}` : 'Action masquée', {
        description: item.title,
        action: { label: 'Annuler', onClick: () => restore(item, { quiet: true }) },
      });
    } catch {
      toast.error('Impossible de masquer cette action. Réessayez.');
    }
  };

  const showHidden = !loading && hiddenItems.length > 0;
  return (
    <section aria-labelledby="today-todo" className={cn('flex', className)}>
      <Card className="w-full p-card">
        <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
          <CardTitle as="h2" id="today-todo">À faire</CardTitle>
          {!loading && items.length > 0 && (
            <Badge variant="secondary">{countLabel(items.length, 'action', 'actions')}</Badge>
          )}
        </div>
        {error && <Notice tone="red" role="alert" className="my-2">{error}</Notice>}
        {loading && items.length === 0 ? (
          <div className="space-y-3 pt-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[42px] rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <IconCircle tone="mint"><CheckCircle2 /></IconCircle>
            <p className="text-sm font-medium text-foreground">Rien à faire, tout est à jour</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.key} role="group" aria-labelledby={`today-group-${group.key}`}>
                <h3 id={`today-group-${group.key}`} className="pt-2.5">
                  <StatusPill tone={GROUP_TONE[group.key] ?? 'gray'}>{group.title} · {group.items.length}</StatusPill>
                </h3>
                <ul className="divide-y">
                  {group.items.map((item) => (
                    <TodayRow key={item.id} item={item} group={group.key} onAck={onAck} onDismiss={dismiss} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {(showHidden || footer) && (
          <div className="mt-2 flex flex-col items-start gap-1 border-t pt-3">
            {showHidden && <HiddenList items={hiddenItems} onRestore={(item) => restore(item)} />}
            {footer}
          </div>
        )}
      </Card>
    </section>
  );
}
