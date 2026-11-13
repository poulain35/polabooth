import { createBrowserRouter, RouterProvider, Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { supabase } from './lib/supabase';
import { Toaster } from './components/ui/sonner';
import { useFeatures } from './hooks/useFeatures';
import { useAppAdmin } from './hooks/useAppAdmin';
import { moduleRoutes } from './features/modules';
import { RESET_PASSWORD_PATH } from './lib/passwordRules';

// Points d'entrée légers → chargés immédiatement
import Landing     from './pages/Landing';
import AdminLogin  from './pages/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';

// Routes lourdes (éditeur Fabric.js, admin) → chargées à la demande
const EditorPage         = lazy(() => import('./pages/EditorPage'));
const Assistance         = lazy(() => import('./pages/Assistance'));
const PhotoGallery       = lazy(() => import('./pages/PhotoGallery'));
const Slideshow          = lazy(() => import('./pages/Slideshow'));
const AdminEvents        = lazy(() => import('./pages/admin/AdminEvents'));
const AdminEventDetail   = lazy(() => import('./pages/admin/AdminEventDetail'));
const AdminSettings      = lazy(() => import('./pages/admin/AdminSettings'));
const AdminFeatures      = lazy(() => import('./pages/admin/AdminFeatures'));
const AdminKeys          = lazy(() => import('./pages/admin/AdminKeys'));
const AdminLicenses      = lazy(() => import('./pages/admin/AdminLicenses'));
const AdminPlanning      = lazy(() => import('./pages/admin/AdminPlanning'));
const AdminEmails        = lazy(() => import('./pages/admin/AdminEmails'));
const AdminNewEvent      = lazy(() => import('./pages/admin/AdminNewEvent'));
const AdminTemplates     = lazy(() => import('./pages/admin/AdminTemplates'));
const AdminTemplateEditor = lazy(() => import('./pages/admin/AdminTemplateEditor'));
const AdminPhotoList     = lazy(() => import('./pages/admin/AdminPhotoList'));
const AdminPhotoEvent    = lazy(() => import('./pages/admin/AdminPhotoEvent'));
const AdminDecorations   = lazy(() => import('./pages/admin/AdminDecorations'));
const AdminFonts         = lazy(() => import('./pages/admin/AdminFonts'));
const AdminDashboard     = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminStats         = lazy(() => import('./pages/admin/AdminStats'));
const AdminPair          = lazy(() => import('./pages/AdminPair'));
const AdminResetPassword = lazy(() => import('./pages/AdminResetPassword'));
const EventReport        = lazy(() => import('./pages/EventReport'));

/** Spinner plein écran, utilisé comme fallback de chargement de chunk. */
function PageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
  if (session === undefined) return <PageSpinner />;
  return session ? <AdminLayout /> : <Outlet />;
}

/**
 * Route d'une fonctionnalité activable : message si elle est désactivée (Paramètres → Fonctionnalités).
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
          <Link to="/admin/settings/features" className="text-primary underline underline-offset-2">
            Paramètres → Fonctionnalités
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

const router = createBrowserRouter([
  { path: '/',             element: <Landing /> },
  { path: '/e/:code',      element: L(<EditorPage />) },
  { path: '/photos/:code', element: L(<PhotoGallery />) },
  { path: '/slideshow/:code', element: L(<Slideshow />) },
  { path: '/aide',         element: L(<Assistance />) },
  { path: '/aide/:code',   element: L(<Assistance />) },
  { path: '/rapport/:token', element: P(<EventReport />) },
  // Pages des modules : galerie audio, récap de réservation à jeton, CGL, désinscription…
  ...publicModuleRoutes,
  ...clientModuleRoutes,
  { path: '/admin/login',  element: <AdminLogin /> },
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
        element: <RequireAuth><AdminLayout /></RequireAuth>,
        children: [
          { index: true,                    element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard',              element: L(<AdminDashboard />) },
          { path: 'stats',                  element: F('guest_form', <AdminStats />) },
          { path: 'events',                 element: L(<AdminEvents />) },
          { path: 'emails',                 element: L(<AdminEmails />) },
          { path: 'events/new',             element: L(<AdminNewEvent />) },
          { path: 'events/:id',             element: L(<AdminEventDetail />) },
          { path: 'templates',              element: A(<AdminTemplates />) },
          { path: 'templates/new',          element: A(<AdminTemplateEditor />) },
          { path: 'templates/:id/edit',     element: A(<AdminTemplateEditor />) },
          { path: 'photos',                 element: F('gallery', <AdminPhotoList />) },
          { path: 'photos/:id',             element: F('gallery', <AdminPhotoEvent />) },
          { path: 'decorations',            element: A(<AdminDecorations />) },
          { path: 'fonts',                  element: A(<AdminFonts />) },
          { path: 'settings',               element: L(<AdminSettings />) },
          { path: 'settings/features',      element: L(<AdminFeatures />) },
          { path: 'settings/keys',          element: L(<AdminKeys />) },
          { path: 'licenses',               element: L(<AdminLicenses />) },
          { path: 'planning',               element: F('planning', <AdminPlanning />) },
          ...adminModuleRoutes,
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
