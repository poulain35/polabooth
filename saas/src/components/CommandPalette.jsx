// Recherche Ctrl+K / Cmd+K de l'admin (LAB-339), ouverte par le raccourci ou le bouton de l'en-tête
// (AdminLayout). Cherche les événements (nom, client, code d'accès), les clients, les bornes, les pages
// et actions, et ce que fournissent les modules (emplacement `command.search` : devis, prospects…).
// Classement et regroupement : lib/commandSearch.js. Clavier : flèches, Entrée, Échap (rôles ARIA
// combobox / listbox, aria-activedescendant) ; à la fermeture, le focus revient où il était.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, CornerDownLeft, FileText, Loader2, Monitor, Plus, Search, User, Users,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { useFeatures } from '../hooks/useFeatures';
import { useAppAdmin } from '../hooks/useAppAdmin';
import { useSalesTabs } from '../hooks/useSalesTabs';
import { moduleSlot } from '../features/modules';
import { EVENT_TABS } from '../features/adminRoutes';
import { hasOfferSettings, galleryCardFlags } from '../pages/admin/reglages/sectionFlags';
import {
  MIN_REMOTE_LENGTH, SEARCH_DELAY_MS, accessCodeOf, buildPageCommands, clientCommands, eventCommand,
  flattenGroups, ilikeAny, licenseCommand, mergeResults, moveActive, rankCommands,
} from '../lib/commandSearch';
import { findEventByAccessCode, searchEventClients, searchEvents, searchLicenses } from '../lib/supabase';
import { cn } from '../lib/utils';

const GROUP_ICONS = {
  events: CalendarDays,
  clients: User,
  sales: FileText,
  prospects: Users,
  bornes: Monitor,
  actions: Plus,
  pages: ArrowRight,
};

const EVENT_PAGE = /^\/admin\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const quiet = (promise) => Promise.resolve(promise).catch(() => []);

/** Requêtes d'une recherche : code ouvert, puis modules disponibles. Une requête en échec ne compte pas. */
async function searchRemote(term, searchers) {
  const code = accessCodeOf(term);
  const clientFilter = ilikeAny(['client_name', 'client_email'], term);
  const licenseFilter = ilikeAny(['label', 'machine_id', 'machine_name'], term);
  const [events, byCode, clientEvents, licenses, ...fromModules] = await Promise.all([
    quiet(searchEvents(term, 6)),
    code ? findEventByAccessCode(code).catch(() => null) : null,
    clientFilter ? quiet(searchEventClients(clientFilter)) : [],
    licenseFilter ? quiet(searchLicenses(licenseFilter)) : [],
    ...searchers.map((s) => quiet(s.search(term, { limit: 5 }))
      .then((items) => (items ?? []).map((item) => ({ group: s.group, groupLabel: s.groupLabel, ...item, remote: true })))),
  ]);
  return mergeResults([
    ...(byCode ? [eventCommand(byCode)] : []),
    ...events.map(eventCommand),
    ...clientCommands([...events, ...clientEvents], term),
    ...licenses.map(licenseCommand),
    ...fromModules.flat(),
  ]);
}

function platformName() {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgentData?.platform || navigator.platform || '';
}

/**
 * Fenêtre de recherche. `createActions` : créations des modules disponibles ({ id, label }) ;
 * `onCreate(id)` les ouvre (après la fermeture de la fenêtre).
 */
export default function CommandPalette({ open, onOpenChange, createActions = [], onCreate }) {
  const returnFocus = useRef(null);
  const close = useCallback((restoreFocus) => {
    if (!restoreFocus) returnFocus.current = null;
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        // Appelé avant que le focus n'entre dans la fenêtre (il va ensuite au champ, premier élément).
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement; }}
        onCloseAutoFocus={(e) => {
          // Sans déclencheur Radix, le focus serait perdu : il revient à l'élément d'avant l'ouverture.
          e.preventDefault();
          const el = returnFocus.current;
          returnFocus.current = null;
          if (el?.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
        }}
        className="top-2 sm:top-[12vh] translate-y-0 w-[calc(100%-1rem)] max-w-xl gap-0 overflow-hidden rounded-dialog p-0 sm:rounded-dialog"
      >
        <DialogTitle className="sr-only">Rechercher dans l’administration</DialogTitle>
        <PaletteBody createActions={createActions} onClose={close} onCreate={onCreate} />
      </DialogContent>
    </Dialog>
  );
}

// Monté à chaque ouverture : texte et résultats repartent de zéro.
function PaletteBody({ createActions, onClose, onCreate }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAvailable } = useFeatures();
  const { isAdmin: isAppAdmin } = useAppAdmin();
  const salesTabs = useSalesTabs();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState({ term: null, items: [] });
  const [active, setActive] = useState({ key: '', index: 0 });
  const pendingEnter = useRef(null);
  const term = query.trim();
  const wantsRemote = term.length >= MIN_REMOTE_LENGTH;
  const searching = wantsRemote && remote.term !== term;

  const searchers = useMemo(
    () => moduleSlot('command.search').filter((s) => isAvailable(s.feature) && typeof s.search === 'function'),
    [isAvailable],
  );

  // Pages et actions, filtrées comme le menu ; onglets de la fiche ouverte en plus.
  const localItems = useMemo(() => {
    const eventId = location.pathname.match(EVENT_PAGE)?.[1];
    const deliveryFeatures = ['gallery', 'delivery_email', 'event_report', 'guest_form',
      ...moduleSlot('event.delivery').map((item) => item.feature)];
    const eventTabs = EVENT_TABS.filter((tab) => (
      tab === 'creation' ? isAvailable('client_design') || isAvailable('guest_form')
        : tab === 'livraison' ? deliveryFeatures.some((f) => isAvailable(f))
          : true));
    const gallery = galleryCardFlags(isAvailable);
    const fromModules = (name) => moduleSlot(name).filter((item) => isAvailable(item.feature))
      .map(({ id, label, keywords }) => ({ id, label, keywords }));
    return buildPageCommands({
      isAvailable,
      isAppAdmin,
      salesTabs: salesTabs.map((tab) => ({ id: tab.id, label: tab.label })),
      eventViews: fromModules('events.views'),
      bornesTabs: fromModules('bornes.tabs'),
      createActions,
      hiddenSettings: [
        ...(hasOfferSettings(isAvailable) ? [] : ['offres']),
        ...(gallery.showBanner || gallery.showReport ? [] : ['galerie']),
      ],
      event: eventId ? { id: eventId, tabs: eventTabs } : null,
    });
  }, [location.pathname, isAvailable, isAppAdmin, salesTabs, createActions]);

  // Pendant la frappe, les résultats du texte précédent restent affichés s'ils contiennent encore les mots
  // cherchés (sans le passe-droit des résultats de requête), en attendant les nouveaux.
  const groups = useMemo(() => {
    const fresh = remote.term === term;
    const remoteItems = fresh ? remote.items : remote.items.map((item) => ({ ...item, remote: false }));
    return rankCommands(term, mergeResults([...remoteItems, ...localItems]));
  }, [term, remote, localItems]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  const resultsKey = `${term}|${remote.term === term ? 'r' : 'l'}`;
  const activeIndex = flat.length ? Math.min(active.key === resultsKey ? active.index : 0, flat.length - 1) : -1;
  const optionId = (i) => `${listId}-o${i}`;

  const activate = useCallback((item) => {
    if (!item) return;
    if (item.action?.startsWith('create:')) {
      // La fenêtre de création prend le focus : on ne le rend pas à l'élément d'avant.
      onClose(false);
      const id = item.action.slice('create:'.length);
      setTimeout(() => onCreate?.(id), 0);
      return;
    }
    onClose(true);
    if (item.external) window.open(item.href, '_blank', 'noopener,noreferrer');
    else navigate(item.href);
  }, [navigate, onClose, onCreate]);

  // Requêtes, après une courte pause de frappe ; les réponses d'un texte déjà changé sont ignorées.
  useEffect(() => {
    if (!wantsRemote) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      searchRemote(term, searchers).then((items) => {
        if (!alive) return;
        setRemote({ term, items });
        // Entrée pressée avant les réponses (ex. un code d'accès) : ouvre le premier résultat.
        if (pendingEnter.current === term) {
          pendingEnter.current = null;
          const ranked = flattenGroups(rankCommands(term, mergeResults([...items, ...localItems])));
          activate(ranked[0]);
        }
      });
    }, SEARCH_DELAY_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [term, wantsRemote, searchers, localItems, activate]);

  // Option active visible dans la liste.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pendingEnter.current = null;
      setActive({ key: resultsKey, index: moveActive(activeIndex, e.key === 'ArrowDown' ? 1 : -1, flat.length) });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Résultats encore attendus et aucune option choisie au clavier : on ouvre le premier dès leur arrivée.
      if (searching && active.key !== resultsKey) pendingEnter.current = term;
      else activate(flat[activeIndex]);
    }
  }

  const shortcut = /mac|iphone|ipad/i.test(platformName()) ? '⌘K' : 'Ctrl K';

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border pl-4 pr-11">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label="Rechercher un événement, un client, une page…"
          placeholder="Événement, client, code, page…"
          value={query}
          onChange={(e) => { pendingEnter.current = null; setQuery(e.target.value); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-sm"
        />
        {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>

      <div id={listId} role="listbox" aria-label="Résultats" className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain p-2">
        {(() => {
          let index = -1;
          return groups.map((group) => {
            const GroupIcon = GROUP_ICONS[group.id] ?? Search;
            const headerId = `${listId}-g-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={headerId} className="pb-1">
                <div id={headerId} role="presentation" className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  const selected = i === activeIndex;
                  return (
                    <div
                      key={item.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => { if (!selected) setActive({ key: resultsKey, index: i }); }}
                      onClick={() => activate(item)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm',
                        selected ? 'bg-accent text-foreground' : 'text-foreground',
                      )}
                    >
                      <GroupIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                      </span>
                      {item.badge && (
                        <span className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[11px]',
                          item.code ? 'bg-primary-soft font-mono font-semibold tracking-widest text-primary-ink' : 'bg-muted text-muted-foreground',
                        )}>
                          {item.badge}
                        </span>
                      )}
                      {selected && <CornerDownLeft className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
        {term && !searching && flat.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Aucun résultat pour « {term} ».</p>
        )}
        {term && searching && flat.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Recherche…</p>
        )}
      </div>

      <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
        <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> pour choisir</span>
        <span><Kbd>Entrée</Kbd> pour ouvrir</span>
        <span><Kbd>Échap</Kbd> pour fermer</span>
        <span className="ml-auto"><Kbd>{shortcut}</Kbd></span>
      </div>

      <p aria-live="polite" className="sr-only">
        {searching ? 'Recherche…' : `${flat.length} résultat${flat.length > 1 ? 's' : ''}`}
      </p>
    </>
  );
}

function Kbd({ children, className }) {
  return (
    <kbd className={cn('rounded-md border border-border bg-soft px-1.5 py-px font-sans text-[10px] text-muted-foreground', className)}>
      {children}
    </kbd>
  );
}
