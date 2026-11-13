import { createContext, useContext, useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import NotificationsBell from '../../components/NotificationsBell';
import EventSearch from '../../components/EventSearch';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import { Settings as SettingsIcon } from 'lucide-react';
import { useFeatures } from '../../hooks/useFeatures';
import { useAppAdmin } from '../../hooks/useAppAdmin';
import { filterNav } from '../../features/featureGate';
import BrandLogo from '../../components/BrandLogo';

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

// Vrai quand la page est rendue dans ce layout (pages accessibles aussi hors session, ex. /admin/demandes/:id).
const InAdminLayoutContext = createContext(false);
export const useInAdminLayout = () => useContext(InAdminLayoutContext);

// Icônes réutilisables (un seul rendu, partagé header de groupe / item)
const ICON = {
  dashboard: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z',
  calendar:  'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  template:  'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z',
  sparkles:  'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
  font:      'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129',
  photo:     'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  audio:     'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
  kiosk:     'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  settings:  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  stats:     'M9 19v-6a1 1 0 00-1-1H5a1 1 0 00-1 1v6a1 1 0 001 1h3a1 1 0 001-1zm0 0V9a1 1 0 011-1h4a1 1 0 011 1v10m-6 0a1 1 0 001 1h4a1 1 0 001-1m0 0V5a1 1 0 011-1h3a1 1 0 011 1v14a1 1 0 01-1 1h-3a1 1 0 01-1-1z',
  leads:     'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  prospects: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z',
  mail:      'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  toggles:   'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
  key:       'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
  help:      'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

function Icon({ path, path2 }) {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      {path2 && <path strokeLinecap="round" strokeLinejoin="round" d={path2} />}
    </svg>
  );
}

// Menu organisé par domaine fonctionnel. Le premier groupe (vue d'ensemble) n'a pas d'en-tête.
// Fonctionnalité de chaque entrée : NAV_FEATURES (features/featureGate.js) ; toute nouvelle entrée y est ajoutée.
const CREATION_MODULE_ID = 'creation';
const MODULES = [
  {
    id: 'overview',
    noHeader: true,
    items: [
      { to: 'dashboard', label: 'Dashboard',     icon: <Icon path={ICON.dashboard} /> },
      { to: 'stats',     label: 'Statistiques',  icon: <Icon path={ICON.stats} /> },
    ],
  },
  {
    id: 'prestations',
    label: 'Prestations',
    icon: <Icon path={ICON.calendar} />,
    items: [
      { to: 'events',   label: 'Événements', icon: <Icon path={ICON.calendar} /> },
      { to: 'leads',    label: 'Devis',      icon: <Icon path={ICON.leads} />, alsoActive: '/admin/demandes/' },
      { to: 'prospects', label: 'Prospects', icon: <Icon path={ICON.prospects} /> },
      { to: 'planning', label: 'Planning',   icon: <Icon path={ICON.calendar} path2="M3 15h18M3 19h18" /> },
      { to: 'emails',   label: 'Emails',     icon: <Icon path={ICON.mail} /> },
    ],
  },
  {
    id: CREATION_MODULE_ID,
    label: 'Création',
    icon: <Icon path={ICON.sparkles} />,
    items: [
      { to: 'templates',   label: 'Modèles',     icon: <Icon path={ICON.template} /> },
      { to: 'decorations', label: 'Décorations', icon: <Icon path={ICON.sparkles} /> },
      { to: 'fonts',       label: 'Polices',     icon: <Icon path={ICON.font} /> },
    ],
  },
  {
    id: 'livrables',
    label: 'Livrables',
    icon: <Icon path={ICON.photo} />,
    items: [
      { to: 'photos', label: 'Photos',     icon: <Icon path={ICON.photo} /> },
      { to: 'audio',  label: 'Livre d\'or', icon: <Icon path={ICON.audio} /> },
    ],
  },
  {
    id: 'materiel',
    label: 'Matériel',
    icon: <Icon path={ICON.kiosk} />,
    items: [
      { to: 'licenses', label: 'Parc kiosk', icon: <Icon path={ICON.kiosk} /> },
    ],
  },
  {
    id: 'reglages',
    label: 'Réglages',
    icon: <Icon path={ICON.settings} />,
    items: [
      { to: 'settings', label: 'Paramètres', icon: <Icon path={ICON.settings} path2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />, end: true },
      { to: 'settings/features', label: 'Fonctionnalités', icon: <Icon path={ICON.toggles} /> },
      { to: 'settings/keys', label: 'Clés', icon: <Icon path={ICON.key} /> },
      { to: 'assistant', label: 'Assistant', icon: <Icon path={ICON.help} />, external: true, href: '/aide' },
    ],
  },
];

function navClass({ isActive }) {
  return `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-[#f3f3f3] text-black'
      : 'text-[#5b6472] hover:bg-[#f3f3f3] hover:text-black'
  }`;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingDesigns, setPendingDesigns] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [org, setOrg] = useState({ name: '', contact_company: '', contact_phone: '', contact_email: '' });
  const [navOpen, setNavOpen] = useState(false);
  const { isAvailable } = useFeatures();
  const { isAdmin: isAppAdmin } = useAppAdmin();
  // « Création » (modèles, décorations, polices) : catalogues de l'application, réservés à son
  // administrateur (LAB-276). Masqué pendant la lecture du statut.
  const modules = filterNav(MODULES, isAvailable).filter((m) => m.id !== CREATION_MODULE_ID || isAppAdmin);

  // Éditeur de template : plein écran immersif (a déjà son propre header) → pas de barre mobile.
  const isImmersive = /\/templates\/(new|[^/]+\/edit)/.test(location.pathname);

  useEffect(() => {
    async function fetchPending() {
      const { count } = await supabase
        .from('client_designs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted');
      setPendingDesigns(count ?? 0);
    }

    async function fetchAlerts() {
      const { count } = await supabase
        .from('kiosk_alerts')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null);
      setOpenAlerts(count ?? 0);
    }

    fetchPending();
    fetchAlerts();

    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: orgData } = await supabase
        .from('organizations')
        .select('name, contact_company, contact_phone, contact_email')
        .eq('owner_id', data.session.user.id)
        .maybeSingle();
      if (orgData) setOrg(orgData);
    });

    const channel = supabase
      .channel('sidebar-badges-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_designs' }, fetchPending)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_alerts' }, fetchAlerts)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
            <AvatarFallback className="bg-primary/10 text-primary text-[11px]">{initialsOf(companyName)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium text-foreground truncate">{companyName}</p>
          {org.contact_email && <p className="text-xs text-muted-foreground truncate">{org.contact_email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { navigate('/admin/settings'); setNavOpen(false); }}>
          <SettingsIcon className="w-4 h-4" />Paramètres
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4" />Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <OrgContext.Provider value={org}>
    <div className="flex h-screen bg-background">

      {/* Barre supérieure mobile (masquée dans l'éditeur immersif) */}
      {!isImmersive && (
        <header className="md:hidden fixed top-0 inset-x-0 z-30 h-14 bg-background border-b border-border flex items-center gap-2 px-3">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Ouvrir le menu"
            className="p-2 -ml-1 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="flex-1 truncate text-sm font-semibold text-foreground" title={companyName}>
            {companyName}
          </span>
          <NotificationsBell />
          {accountMenu}
        </header>
      )}

      {/* Overlay du tiroir (mobile) */}
      {navOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Sidebar (statique ≥ md, tiroir < md) */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200
        md:static md:z-auto md:w-60 md:translate-x-0
        ${navOpen ? 'translate-x-0' : '-translate-x-full'}
        bg-[#FAFAFA] border-r border-border flex flex-col shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-border shrink-0">
          <BrandLogo variant="square" alt={companyName} className="w-8 h-8 rounded-lg object-contain" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight truncate" title={companyName}>{companyName}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-tight">Administration</p>
          </div>
        </div>

        {/* Modules */}
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {modules.map((module) => (
            <div key={module.id}>
              {/* En-tête de groupe (sauf vue d'ensemble) */}
              {!module.noHeader && (
                <p className="px-3 mb-1 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">{module.label}</p>
              )}

              {/* Items du groupe */}
              <div className="space-y-0.5">
                {module.items.map((item) => (
                  item.external ? (
                    <a key={item.to} href={item.href} target="_blank" rel="noopener noreferrer"
                      className={navClass({ isActive: false })} onClick={() => setNavOpen(false)}>
                      {item.icon}
                      <span className="flex-1">{item.label}</span>
                    </a>
                  ) : (
                  <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setNavOpen(false)}
                    className={({ isActive }) => navClass({ isActive: isActive || (!!item.alsoActive && location.pathname.startsWith(item.alsoActive)) })}>
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.to === 'events' && pendingDesigns > 0 && isAvailable('client_design') && (
                      <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1
                        rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                        {pendingDesigns > 99 ? '99+' : pendingDesigns}
                      </span>
                    )}
                    {item.to === 'licenses' && openAlerts > 0 && isAvailable('kiosk_alerts') && (
                      <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1
                        rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-none">
                        {openAlerts > 99 ? '99+' : openAlerts}
                      </span>
                    )}
                  </NavLink>
                  )
                ))}
              </div>
            </div>
          ))}
        </nav>

      </aside>

      {/* Zone principale : topbar desktop + contenu */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isImmersive ? '' : 'pt-14 md:pt-0'}`}>
        {!isImmersive && (
          <header className="hidden md:flex h-14 items-center gap-3 border-b border-border bg-background px-6 shrink-0">
            <EventSearch />

            <div className="ml-auto flex items-center gap-1.5">
              <NotificationsBell />
              {accountMenu}
            </div>
          </header>
        )}
        <main className="flex-1 overflow-auto">
          <InAdminLayoutContext.Provider value={true}>
            <Outlet />
          </InAdminLayoutContext.Provider>
        </main>
      </div>
    </div>
    </OrgContext.Provider>
  );
}
