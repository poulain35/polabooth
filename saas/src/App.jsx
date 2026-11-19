import { createBrowserRouter, RouterProvider, Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useState, lazy, Suspense } from 'react';
import { supabase } from './lib/supabase';
import { Toaster } from './components/ui/sonner';
import { useFeatures } from './hooks/useFeatures';
import { useAppAdmin } from './hooks/useAppAdmin';
import { moduleRoutes } from './features/modules';
import { RESET_PASSWORD_PATH } from './lib/passwordRules';
import { ADMIN_HOME } from './features/adminRoutes';
import { releaseStaleAdminTheme } from './hooks/useAdminTheme';
import { isProductScreenPath } from './lib/theme';
import { PolaboothLoader } from './components/PolaboothBrand';
import { useInAdminLayout } from './pages/admin/adminLayoutContext';
import RouteError from './components/RouteError';
import { KIOSK_INSTALLER_PATH } from './lib/kioskUpdate';

// Seul point d'entrée chargé immédiatement : l'accueil public, léger.
import Landing     from './pages/Landing';
import { Spinner } from './components/ui/spinner';

// Tout le reste est chargé à la demande. Le menu de l'admin (AdminLayout : liste « À faire », recherche
// Ctrl+K, pastilles) et la connexion ne sont jamais téléchargés par les pages client (LAB-349).
const loadAdminLayout    = () => import('./pages/admin/AdminLayout');
const AdminLayout        = lazy(loadAdminLayout);
const AdminLogin         = lazy(() => import('./pages/AdminLogin'));
const EditorPage         = lazy(() => import('./pages/EditorPage'));
const Assistance         = lazy(() => import('./pages/Assistance'));
const PhotoGallery       = lazy(() => import('./pages/PhotoGallery'));
const Slideshow          = lazy(() => import('./pages/Slideshow'));
const AdminEvents        = lazy(() => import('./pages/admin/AdminEvents'));
const AdminEventDetail   = lazy(() => import('./pages/admin/AdminEventDetail'));
const AdminSales         = lazy(() => import('./pages/admin/AdminSales'));
const AdminBornes        = lazy(() => import('./pages/admin/AdminBornes'));
const AdminReglages      = lazy(() => import('./pages/admin/AdminReglages'));
const AdminLibrary       = lazy(() => import('./pages/admin/AdminLibrary'));
const AdminKioskScreens  = lazy(() => import('./pages/admin/AdminKioskScreens'));
const AdminNewEvent      = lazy(() => import('./pages/admin/AdminNewEvent'));
const AdminTemplates     = lazy(() => import('./pages/admin/AdminTemplates'));
const AdminTemplateEditor = lazy(() => import('./pages/admin/AdminTemplateEditor'));
const AdminDecorations   = lazy(() => import('./pages/admin/AdminDecorations'));
const AdminFonts         = lazy(() => import('./pages/admin/AdminFonts'));
const AdminDashboard     = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminPair          = lazy(() => import('./pages/AdminPair'));
const AdminResetPassword = lazy(() => import('./pages/AdminResetPassword'));
const EventReport        = lazy(() => import('./pages/EventReport'));
const KioskInstaller     = lazy(() => import('./pages/KioskInstaller'));

/**
 * Chargement plein écran (session, fonctionnalités, téléchargement d'une page). Écrans du logiciel :
 * chargement animé Polabooth, réduit dans le menu de l'admin ; aide et pages client : spinner neutre.
 */
function PageSpinner() {
  const inLayout = useInAdminLayout();
  const { pathname } = useLocation();
  if (inLayout) return <PolaboothLoader compact />;
  if (isProductScreenPath(pathname)) return <PolaboothLoader />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

/** Enveloppe un élément de route dans une frontière Suspense. */
function L(element) {
  return <Suspense fallback={<PageSpinner />}>{element}</Suspense>;
}

/** Idem pour les pages client publiques : fond crème du site, sans spinner admin. */
function P(element) {
  return <Suspense fallback={<div className="min-h-screen bg-pola-bg" />}>{element}</Suspense>;
}

/** Session Supabase courante : undefined pendant la lecture, puis la session ou null. */
function useAdminSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  return session;
}

/**
 * Protège les routes admin — redirige vers /admin/login si non connecté.
 * withNext : la page de connexion ramène ensuite à l'adresse demandée (ex. /associer?code=…).
 */
function RequireAuth({ children, withNext = false }) {
  const session = useAdminSession();
  const location = useLocation();
  if (session === undefined) return <PageSpinner />;
  if (session) return children;
  const login = withNext
    ? `/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`
    : '/admin/login';
  return <Navigate to={login} replace />;
}

/** Layout admin si une session existe, page seule sinon (lien signé ouvert sans être connecté). */
function MaybeAdminLayout() {
  const session = useAdminSession();
  const { pathname } = useLocation();
  // Sans session, la page s'affiche seule, en clair : retire le thème posé par index.html (session
  // enregistrée mais expirée).
  useLayoutEffect(() => { if (session === null) releaseStaleAdminTheme(pathname); }, [session, pathname]);
  if (session === undefined) return <PageSpinner />;
  return session ? L(<AdminLayout />) : <Outlet />;
}

/**
 * Route d'une fonctionnalité activable : message si elle est désactivée (Réglages → Fonctionnalités).
 * Pendant la lecture des fonctionnalités : spinner, jamais le message.
 */
function RequireFeature({ id, children }) {
  const { isAvailable, loading } = useFeatures();
  if (loading) return <PageSpinner />;
  if (isAvailable(id)) return children;
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-base font-semibold text-foreground">Cette fonctionnalité est désactivée</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Vous pouvez la réactiver dans{' '}
          <Link to="/admin/reglages#fonctionnalites" className="text-primary-ink underline underline-offset-2">
            Réglages → Fonctionnalités
          </Link>.
        </p>
      </div>
    </div>
  );
}

/**
 * Route réservée à l'administrateur de l'application (modèles, décorations, polices, LAB-276) :
 * les autres comptes reviennent à /admin. La base refuse de toute façon leurs écritures (RLS).
 */
function RequireAppAdmin({ children }) {
  const { isAdmin, loading } = useAppAdmin();
  if (loading) return <PageSpinner />;
  if (isAdmin) return children;
  return <Navigate to="/admin" replace />;
}

/** Raccourci : route du catalogue de l'application, chargée à la demande, administrateur seul. */
function A(element) {
  return <RequireAppAdmin>{L(element)}</RequireAppAdmin>;
}

/** Raccourci : route admin chargée à la demande et rattachée à une fonctionnalité. */
function F(id, element) {
  return <RequireFeature id={id}>{L(element)}</RequireFeature>;
}

/**
 * Routes des modules privés installés (src/modules/, open core L2b), par emplacement.
 * Sans module (construction ouverte), ces adresses tombent sur la route « * ».
 */
const routesOf = (place, wrap) => moduleRoutes(place).map(({ path, Component, feature }) =>
  ({ path, element: wrap(<Component />, feature) }));
const publicModuleRoutes = routesOf('public', (el) => L(el));
const clientModuleRoutes = routesOf('client', (el) => P(el));
const adminMaybeModuleRoutes = routesOf('adminMaybe', (el, feature) => F(feature, el));
const adminStandaloneModuleRoutes = routesOf('adminStandalone', (el, feature) => <RequireAuth>{F(feature, el)}</RequireAuth>);
const adminModuleRoutes = routesOf('admin', (el, feature) => F(feature, el));

const routes = [
  { path: '/',             element: <Landing /> },
  { path: '/e/:code',      element: L(<EditorPage />) },
  { path: '/photos/:code', element: L(<PhotoGallery />) },
  { path: '/slideshow/:code', element: L(<Slideshow />) },
  { path: '/aide',         element: L(<Assistance />) },
  { path: '/aide/:code',   element: L(<Assistance />) },
  { path: '/rapport/:token', element: P(<EventReport />) },
  // Adresse courte et publique : télécharge la dernière version de la borne (PC neuf, sans connexion).
  { path: KIOSK_INSTALLER_PATH, element: L(<KioskInstaller />) },
  // Pages des modules : galerie audio, récap de réservation à jeton, CGL, désinscription…
  ...publicModuleRoutes,
  ...clientModuleRoutes,
  { path: '/admin/login',  element: L(<AdminLogin />) },
  // Lien de l'email « Mot de passe oublié » : publique, la session de récupération vient du lien.
  { path: RESET_PASSWORD_PATH, element: L(<AdminResetPassword />) },
  // Association d'une borne (QR code affiché par le kiosk) : page seule, pensée pour le téléphone.
  { path: '/associer',     element: <RequireAuth withNext>{L(<AdminPair />)}</RequireAuth> },
  {
    path: '/admin',
    children: [
      // Pages de module ouvertes par lien signé OU session (hors RequireAuth), ex. décision sur une
      // demande de réservation. Layout sans path : les liens relatifs du menu restent résolus depuis /admin.
      { element: <MaybeAdminLayout />, children: adminMaybeModuleRoutes },
      // Pages de module seules, sans le menu (ex. preuve d'acceptation imprimable).
      ...adminStandaloneModuleRoutes,
      {
        element: <RequireAuth>{L(<AdminLayout />)}</RequireAuth>,
        children: [
          { index: true,                    element: <Navigate to={ADMIN_HOME} replace /> },
          { path: 'aujourdhui',             element: L(<AdminDashboard />) },
          { path: 'ventes',                 element: L(<AdminSales />) },
          { path: 'events',                 element: L(<AdminEvents />) },
          { path: 'events/new',             element: L(<AdminNewEvent />) },
          { path: 'events/:id',             element: L(<AdminEventDetail />) },
          { path: 'bornes',                 element: L(<AdminBornes />) },
          { path: 'ecrans-borne/:kind',     element: L(<AdminKioskScreens />) },
          { path: 'reglages',               element: L(<AdminReglages />) },
          // Bibliothèque : modèles, décorations et polices sous une barre d'onglets commune.
          {
            element: A(<AdminLibrary />),
            children: [
              { path: 'templates',          element: L(<AdminTemplates />) },
              { path: 'decorations',        element: L(<AdminDecorations />) },
              { path: 'fonts',              element: L(<AdminFonts />) },
            ],
          },
          { path: 'templates/new',          element: A(<AdminTemplateEditor />) },
          { path: 'templates/:id/edit',     element: A(<AdminTemplateEditor />) },
          ...adminModuleRoutes,
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

// Écran d'erreur sur chaque route de premier niveau (les routes enfants y remontent) : page de
// l'ancienne version introuvable après une mise en ligne → rechargement automatique (RouteError).
const router = createBrowserRouter(routes.map((route) => ({ errorElement: <RouteError />, ...route })));

/**
 * Adresse de l'admin (connexion comprise) : le menu se télécharge tout de suite, pendant la lecture de
 * la session, plutôt qu'après (pas d'attente en plus à l'ouverture de l'admin ni après la connexion).
 */
function preloadAdminLayout(pathname) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) loadAdminLayout().catch(() => {});
}
preloadAdminLayout(window.location.pathname);

router.subscribe(({ location }) => {
  // Mode sombre (LAB-340) : la classe posée par index.html est retirée si la page n'est pas sous le menu.
  releaseStaleAdminTheme(location.pathname);
  preloadAdminLayout(location.pathname);
});

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
