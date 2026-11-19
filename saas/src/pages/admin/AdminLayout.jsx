import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { CalendarDays, FileText, LayoutDashboard, LogOut, Menu, Monitor, Moon, Search, Sun, SunMoon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import NotificationsBell from '../../components/NotificationsBell';
import CommandPalette from '../../components/CommandPalette';
import MobileTabBar from '../../components/admin/MobileTabBar';
import KioskUpdateCard from '../../components/admin/KioskUpdateCard';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '../../components/ui/dropdown-menu';
import { Settings as SettingsIcon } from 'lucide-react';
import { useFeatures } from '../../hooks/useFeatures';
import { useAppAdmin } from '../../hooks/useAppAdmin';
import { filterNav } from '../../features/featureGate';
import { moduleSlot } from '../../features/modules';
import { isPaletteShortcut, shortcutLabel } from '../../lib/commandSearch';
import { useSalesTabs, countSalesTodo } from '../../hooks/useSalesTabs';
import ProductLogo from '../../components/ProductLogo';
import useProductFavicon from '../../hooks/useProductFavicon';
import { PolaboothStripe } from '../../components/PolaboothBrand';
import { InAdminLayoutContext, useInAdminLayout } from './adminLayoutContext';
import { TodayContext, useTodayItems } from './today/useTodayItems';
import { useAdminTheme } from '../../hooks/useAdminTheme';
import { THEME_CHOICES, THEME_LABELS } from '../../lib/theme';

function initialsOf(name) {
  return (name || 'A')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export const OrgContext = createContext({ name: '', contact_company: '', contact_phone: '', contact_email: '' });
export const useOrg = () => useContext(OrgContext);

// Vrai quand la page est rendue dans ce layout : contexte dans adminLayoutContext.js (lu aussi par App.jsx).
export { useInAdminLayout };

// Icônes réutilisables (un seul rendu, partagé header de groupe / item)
const ICON = {
  dashboard: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z',
  calendar:  'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  template:  'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z',
  kiosk:     'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  settings:  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  leads:     'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  help:      'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

function Icon({ path, path2 }) {
  return (
    <svg className="h-[18px] w-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      {path2 && <path strokeLinecap="round" strokeLinejoin="round" d={path2} />}
    </svg>
  );
}

// Menu (spec refonte-navigation-admin, LAB-335) : sept entrées au plus. Le premier groupe porte le
// travail courant, le second (sous un séparateur) les réglages, la bibliothèque et l'aide.
// Fonctionnalité de chaque entrée : NAV_FEATURES (features/featureGate.js) ; toute nouvelle entrée y est ajoutée.
const LIBRARY_ITEM = 'templates';
const MODULES = [
  {
    id: 'travail',
    items: [
      { to: 'aujourdhui', label: 'Aujourd’hui',       icon: <Icon path={ICON.dashboard} /> },
      { to: 'ventes',     label: 'Demandes et devis', icon: <Icon path={ICON.leads} />, alsoActive: ['/admin/demandes/', '/admin/prospects/'] },
      { to: 'events',     label: 'Événements',        icon: <Icon path={ICON.calendar} /> },
      { to: 'bornes',     label: 'Bornes',            icon: <Icon path={ICON.kiosk} />, alsoActive: ['/admin/ecrans-borne/'] },
    ],
  },
  {
    id: 'outils',
    separator: true,
    items: [
      { to: 'reglages',   label: 'Réglages',          icon: <Icon path={ICON.settings} path2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /> },
      // Bibliothèque : catalogues de l'application (modèles, décorations, polices), administrateur seul (LAB-276).
      { to: 'templates',  label: 'Bibliothèque',      icon: <Icon path={ICON.template} />, alsoActive: ['/admin/decorations', '/admin/fonts'] },
      { to: 'aide',       label: 'Aide',              icon: <Icon path={ICON.help} />, external: true, href: '/aide' },
    ],
  },
];

/** Compteur du menu (tone : primary ou destructive) ; `active` : entrée courante du menu. */
function NavBadge({ count, tone = 'primary', active = false }) {
  if (!count) return null;
  const cls = tone === 'destructive'
    ? 'bg-state-red text-state-red-fg'
    : active ? 'bg-primary-ink text-primary-soft' : 'bg-muted text-muted-foreground';
  return (
    <span className={`ml-auto flex h-[22px] min-w-6 items-center justify-center rounded-full px-[7px] text-xs font-medium leading-none ${cls}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

// Barre du bas sur téléphone (LAB-339) : libellés courts, icônes lucide.
const MOBILE_TABS = {
  aujourdhui: { label: 'Aujourd’hui', Icon: LayoutDashboard },
  ventes: { label: 'Devis', Icon: FileText },
  events: { label: 'Événements', Icon: CalendarDays },
  bornes: { label: 'Bornes', Icon: Monitor },
};

// Choix du thème dans le menu du compte (LAB-340).
const THEME_ICONS = { light: Sun, dark: Moon, system: SunMoon };
// Version installée (« 1.2.0 (abc1234) », vite.config.js), en bas du menu du compte (LAB-431).
const APP_VERSION = import.meta.env.VITE_APP_VERSION;

const SHORTCUT = shortcutLabel(typeof navigator === 'undefined' ? '' : navigator.userAgentData?.platform || navigator.platform);

function navClass({ isActive }) {
  return `flex min-h-[42px] items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    isActive
      ? 'pb-nav-active bg-primary-soft font-medium text-primary-ink'
      : 'font-normal text-muted-foreground hover:bg-soft hover:text-foreground'
  }`;
}

export default function AdminLayout() {
  useProductFavicon();
  const navigate = useNavigate();
  const location = useLocation();
  const [org, setOrg] = useState({ name: '', contact_company: '', contact_phone: '', contact_email: '' });
  const [navOpen, setNavOpen] = useState(false);
  const { isAvailable } = useFeatures();
  const { isAdmin: isAppAdmin } = useAppAdmin();
  // Mode clair / sombre : classe `dark` sur <html> tant que ce layout est monté.
  const theme = useAdminTheme(location.pathname);
  const salesTabs = useSalesTabs();
  // Liste « À faire » d'Aujourd'hui (LAB-336) : chargée ici, partagée avec la page par TodayContext.
  const today = useTodayItems();
  const { refreshIfStale } = today;
  const [salesTodo, setSalesTodo] = useState(0);
  // Recherche Ctrl+K et créations des modules (« Nouveau devis »…, emplacement admin.create).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creating, setCreating] = useState(null);
  const createSlots = useMemo(
    () => moduleSlot('admin.create').filter((item) => isAvailable(item.feature)),
    [isAvailable],
  );
  const createActions = useMemo(() => createSlots.map(({ id, label }) => ({ id, label })), [createSlots]);
  const CreateComponent = createSlots.find((item) => item.id === creating)?.Component;
  // Une création avec `href` est un écran séparé (« Nouveau prospect ») ; sinon sa fenêtre s'ouvre.
  const startCreate = useCallback((id) => {
    const href = createSlots.find((item) => item.id === id)?.href;
    if (href) navigate(href);
    else setCreating(id);
  }, [createSlots, navigate]);
  // Bibliothèque masquée hors administrateur de l'application (et pendant la lecture du statut) ;
  // « Demandes et devis » masquée sans onglet fourni par un module (construction ouverte).
  const modules = filterNav(MODULES, isAvailable)
    .map((m) => ({
      ...m,
      items: m.items.filter((item) => (item.to !== LIBRARY_ITEM || isAppAdmin) && (item.to !== 'ventes' || salesTabs.length > 0)),
    }))
    .filter((m) => m.items.length > 0);

  // Pastilles : seulement ce qui est à faire (spec D1). Aujourd'hui = lignes de la liste « À faire »
  // (même fonction que la page), Bornes = alertes ouvertes de cette liste.
  const badges = {
    aujourdhui: { count: today.items.length },
    ventes: { count: salesTodo },
    bornes: { count: today.alertCount, tone: 'destructive' },
  };

  // Barre du bas : mêmes entrées et pastilles que le menu.
  const navItems = modules.flatMap((m) => m.items);
  const mobileTab = (to) => {
    const item = navItems.find((i) => i.to === to);
    return item && { to: `/admin/${to}`, ...MOBILE_TABS[to], badge: badges[to], alsoActive: item.alsoActive };
  };
  const mobileLeft = ['aujourdhui', 'ventes'].map(mobileTab).filter(Boolean);
  const mobileRight = ['events', 'bornes'].map(mobileTab).filter(Boolean);

  // Ctrl+K / Cmd+K : ouvre ou ferme la recherche, partout dans l'admin.
  useEffect(() => {
    function onKeyDown(e) {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Échap ferme le tiroir du menu sur téléphone.
  useEffect(() => {
    if (!navOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  // Zone sûre iOS de la barre du bas : env(safe-area-inset-*) ne vaut quelque chose qu'avec
  // viewport-fit=cover. Ajouté le temps de l'admin seulement, les pages des clients gardent le leur.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const previous = meta.getAttribute('content') ?? '';
    if (!previous.includes('viewport-fit')) meta.setAttribute('content', `${previous}, viewport-fit=cover`);
    return () => meta.setAttribute('content', previous);
  }, []);

  // Liste « À faire » relue au changement de page (au plus une fois par minute).
  useEffect(() => { refreshIfStale(); }, [location.pathname, refreshIfStale]);

  // Demandes à traiter : compteurs des modules, relus à chaque changement de page.
  const salesKey = salesTabs.map((tab) => tab.id).join(',');
  useEffect(() => {
    let alive = true;
    countSalesTodo(salesTabs).then((counts) => {
      if (alive) setSalesTodo(Object.values(counts).reduce((sum, n) => sum + n, 0));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesKey, location.pathname]);

  // Éditeurs (modèles, écrans de la borne) : plein écran immersif (ont déjà leur header) → pas de barre mobile.
  const isImmersive = /\/templates\/(new|[^/]+\/edit)|\/ecrans-borne\/[^/]+/.test(location.pathname);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: orgData } = await supabase
        .from('organizations')
        .select('id, name, contact_company, contact_phone, contact_email, logo_url, business_profile')
        .eq('owner_id', data.session.user.id)
        .maybeSingle();
      if (orgData) setOrg(orgData);
    });
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/admin/login');
  }

  const companyName = org.contact_company || org.name || 'Administration';

  // Menu compte (avatar) — déconnexion + accès rapide
  const accountMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Menu du compte">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary-ink text-primary-soft">{initialsOf(companyName)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium text-foreground truncate">{companyName}</p>
          {org.contact_email && <p className="text-xs text-muted-foreground truncate">{org.contact_email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { navigate('/admin/reglages'); setNavOpen(false); }}>
          <SettingsIcon className="w-4 h-4" />Réglages
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Apparence</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme.choice} onValueChange={theme.setChoice} aria-label="Apparence">
          {THEME_CHOICES.map((choice) => {
            const ThemeIcon = THEME_ICONS[choice];
            return (
              <DropdownMenuRadioItem key={choice} value={choice} onSelect={(e) => e.preventDefault()}>
                <ThemeIcon className="text-muted-foreground" aria-hidden="true" />{THEME_LABELS[choice]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4" />Déconnexion
        </DropdownMenuItem>
        {APP_VERSION && (
          <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground select-text" title="Version installée (CHANGELOG.md du dépôt)">
            Polabooth {APP_VERSION}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <OrgContext.Provider value={org}>
    <div className="relative flex h-dvh bg-background">
      {/* Filet de la marque Polabooth en haut de l'admin, au-dessus du menu et de l'en-tête (pas dans les
          éditeurs plein écran, qui gardent tout leur bord haut). */}
      {!isImmersive && <PolaboothStripe className="pointer-events-none absolute inset-x-0 top-0 z-[60]" />}

      {/* Barre supérieure mobile (masquée dans l'éditeur immersif) */}
      {!isImmersive && (
        <header className="md:hidden fixed top-0 inset-x-0 z-30 h-14 bg-card border-b border-border flex items-center gap-2 px-3">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Ouvrir le menu"
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:bg-soft hover:text-foreground transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="flex-1 truncate text-sm font-medium text-foreground" title={companyName}>
            {companyName}
          </span>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Rechercher"
            aria-haspopup="dialog"
            className="p-2 rounded-xl text-muted-foreground hover:bg-soft hover:text-foreground transition-colors"
          >
            <Search className="w-5 h-5" />
          </button>
          <NotificationsBell />
          {accountMenu}
        </header>
      )}

      {/* Overlay du tiroir (mobile) */}
      {navOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 dark:bg-black/70"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Sidebar (statique ≥ md, tiroir < md) */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[268px] max-w-[85vw] transform transition-transform duration-200
        md:static md:z-auto md:translate-x-0
        ${navOpen ? 'translate-x-0' : '-translate-x-full'}
        bg-card border-r border-border flex flex-col shrink-0`}>
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center gap-3 px-[22px]">
          <ProductLogo variant="icon" className="h-[38px] w-[38px] shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight text-foreground" title={companyName}>{companyName}</p>
            <p className="text-xs leading-tight text-muted-foreground">Polabooth</p>
          </div>
        </div>

        {/* Modules, puis l'encart de mise à jour des bornes juste sous Aide (défile avec le menu) */}
        <div className="flex-1 overflow-y-auto">
        <nav aria-label="Menu de l’administration" className="space-y-3 px-4 pb-5 pt-2">
          {modules.map((module) => (
            <div key={module.id} className={module.separator ? 'border-t border-border pt-3' : ''}>
              {/* Items du groupe */}
              <div className="space-y-0.5">
                {module.items.map((item) => {
                  if (item.external) {
                    return (
                      <a key={item.to} href={item.href} target="_blank" rel="noopener noreferrer"
                        className={navClass({ isActive: false })} onClick={() => setNavOpen(false)}>
                        {item.icon}
                        <span className="flex-1">{item.label}</span>
                      </a>
                    );
                  }
                  const alsoActive = (item.alsoActive ?? []).some((p) => location.pathname.startsWith(p));
                  return (
                    <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setNavOpen(false)}
                      className={({ isActive }) => navClass({ isActive: isActive || alsoActive })}>
                      {({ isActive }) => (
                        <>
                          {item.icon}
                          <span className="flex-1">{item.label}</span>
                          {badges[item.to] && <NavBadge {...badges[item.to]} active={isActive || alsoActive} />}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-4 pb-4 empty:hidden">
          <KioskUpdateCard orgId={org.id} refreshKey={location.pathname.startsWith('/admin/bornes')} onNavigate={() => setNavOpen(false)} />
        </div>
        </div>
      </aside>

      {/* Zone principale : topbar desktop + contenu. Téléphone : place de la barre du bas réservée
          sous le contenu (hors de <main>, pour que les barres collantes en bas restent visibles). */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isImmersive ? '' : 'pt-14 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0'}`}>
        {!isImmersive && (
          <header className="hidden md:flex h-16 items-center gap-3 border-b border-border bg-card px-8 shrink-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              className="flex h-[42px] w-full min-w-0 max-w-sm items-center gap-2.5 rounded-xl border border-border bg-soft px-3 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate text-left">Rechercher un événement, un client, une page…</span>
              <kbd className="shrink-0 rounded-[7px] border border-border bg-card px-[7px] py-0.5 font-sans text-[11px] text-muted-foreground">{SHORTCUT}</kbd>
            </button>

            <div className="ml-auto flex items-center gap-2">
              <NotificationsBell />
              {accountMenu}
            </div>
          </header>
        )}
        {/* `admin-editor` : l'éditeur plein écran (îlot clair, enfant direct) prend la palette claire de l'admin (index.css). */}
        <main className={`flex-1 overflow-auto${isImmersive ? ' admin-editor' : ''}`}>
          <InAdminLayoutContext.Provider value={true}>
            <TodayContext.Provider value={today}>
              <Outlet />
            </TodayContext.Provider>
          </InAdminLayoutContext.Provider>
        </main>
      </div>

      {!isImmersive && (
        <MobileTabBar left={mobileLeft} right={mobileRight} createActions={createActions} onCreate={startCreate} />
      )}
    </div>

    <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} createActions={createActions} onCreate={startCreate} />
    {CreateComponent && (
      <Suspense fallback={null}>
        <CreateComponent open onOpenChange={(o) => { if (!o) setCreating(null); }} />
      </Suspense>
    )}
    </OrgContext.Provider>
  );
}
