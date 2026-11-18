// Barre d'onglets du bas sur téléphone (< 768 px, LAB-339) : Aujourd'hui, Devis, +, Événements, Bornes.
// Les onglets arrivent filtrés comme le menu (AdminLayout : NAV_FEATURES, onglets de `sales.tabs`) avec
// les mêmes pastilles. Le + propose « Nouvel événement » et les créations des modules (emplacement
// `admin.create`, ex. « Nouveau devis ») ; seul, « Nouvel événement » y mène directement. Le tiroir
// garde Réglages, Bibliothèque, Aide et le compte.
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { cn } from '../../lib/utils';

const NEW_EVENT = { to: '/admin/events/new', label: 'Nouvel événement' };

function TabBadge({ count, tone = 'primary' }) {
  if (!count) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ring-2 ring-card',
        tone === 'destructive' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function Tab({ tab }) {
  const location = useLocation();
  const count = tab.badge?.count ?? 0;
  return (
    <NavLink
      to={tab.to}
      className={({ isActive }) => {
        const on = isActive || (tab.alsoActive ?? []).some((p) => location.pathname.startsWith(p));
        return cn(
          'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
          on ? 'font-medium text-primary-ink' : 'font-normal text-muted-foreground hover:text-foreground',
        );
      }}
    >
      <span className="relative">
        <tab.Icon className="h-5 w-5" aria-hidden="true" />
        <TabBadge {...tab.badge} />
      </span>
      <span className="max-w-full truncate px-1">{tab.label}</span>
      {count > 0 && <span className="sr-only">({count} à traiter)</span>}
    </NavLink>
  );
}

/**
 * left, right : onglets à gauche et à droite du + ([{ to, label, Icon, badge?: { count, tone }, alsoActive? }]),
 * déjà filtrés. createActions : [{ id, label }] ; onCreate(id) ouvre la création.
 */
export default function MobileTabBar({ left = [], right = [], createActions = [], onCreate }) {
  const plusClass = 'flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-card transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';

  return (
    <nav
      aria-label="Navigation principale"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/85"
    >
      <div className="flex h-16 items-stretch">
        {left.map((tab) => <Tab key={tab.to} tab={tab} />)}
        <div className="flex flex-1 items-center justify-center">
          {createActions.length === 0 ? (
            <Link to={NEW_EVENT.to} aria-label={NEW_EVENT.label} className={plusClass}>
              <Plus className="h-6 w-6" aria-hidden="true" />
            </Link>
          ) : (
            // Non modal : la fenêtre de création s'ouvre juste après sans bloquer la page.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Créer" className={plusClass}>
                  <Plus className="h-6 w-6" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" sideOffset={10} className="w-56">
                {createActions.map((action) => (
                  <DropdownMenuItem key={action.id} onSelect={() => setTimeout(() => onCreate?.(action.id), 0)}>
                    {action.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem asChild>
                  <Link to={NEW_EVENT.to}>{NEW_EVENT.label}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {right.map((tab) => <Tab key={tab.to} tab={tab} />)}
      </div>
    </nav>
  );
}
