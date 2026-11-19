// Bornes (/admin/bornes?tab=etat|ecrans|alertes|code|versions, LAB-335 puis LAB-338) : état des
// bornes, écrans de la borne, alertes et journaux des bornes (« Journaux » seuls sans la fonctionnalité
// kiosk_alerts), écran de saisie du code (admin de la plateforme seulement) et versions. Une alerte
// précise : ?tab=alertes&alerte=<id> ; journaux d'un événement : ?tab=alertes&event=<id> (?event= seul,
// lien des emails d'alerte déjà envoyés, mène aussi à cet onglet).
// Les modules ajoutent leurs onglets après État (`bornes.tabs`) : Matériel (stock, LAB-358) du module
// privé « planning » (LAB-421).
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageTabs from '../../components/admin/PageTabs';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { BORNES_TABS, pickTab } from '../../features/adminRoutes';
import { moduleSlot } from '../../features/modules';
import { useFeatures } from '../../hooks/useFeatures';
import { useAppAdmin } from '../../hooks/useAppAdmin';
import { Spinner } from '../../components/ui/spinner';

const AdminLicenses = lazy(() => import('./AdminLicenses'));
const ScreenCards = lazy(() => import('./AdminKioskScreens').then((m) => ({ default: m.ScreenCards })));
const AlertsTab = lazy(() => import('./bornes/AlertsTab'));
const CodeScreenTab = lazy(() => import('./bornes/CodeScreenTab'));
const VersionsTab = lazy(() => import('./bornes/VersionsTab'));

// Onglets des modules : chacun porte sa fonctionnalité (feature), filtrée comme celle des alertes.
const MODULE_TABS = moduleSlot('bornes.tabs');

const TABS = [
  { id: 'etat', label: 'État', Component: AdminLicenses },
  ...MODULE_TABS,
  { id: 'ecrans', label: 'Écrans', Component: ScreenCards },
  { id: 'alertes', label: 'Alertes', Component: AlertsTab },
  { id: 'code', label: 'Code', Component: CodeScreenTab, appAdminOnly: true },
  { id: 'versions', label: 'Versions', Component: VersionsTab },
].filter((tab) => BORNES_TABS.includes(tab.id) || MODULE_TABS.includes(tab));

const spinner = (
  <div className="flex justify-center py-24">
    <Spinner />
  </div>
);

export default function AdminBornes() {
  const [searchParams] = useSearchParams();
  const { isAvailable, loading: featuresLoading } = useFeatures();
  const { isAdmin, loading: adminLoading } = useAppAdmin();
  const requested = searchParams.get('tab') ?? (searchParams.has('event') ? 'alertes' : null);
  const alertsEnabled = isAvailable('kiosk_alerts');

  const tabs = TABS.filter((tab) => (!tab.feature || isAvailable(tab.feature)) && (!tab.appAdminOnly || isAdmin));
  // Onglet réservé demandé : on attend de savoir s'il est permis avant de retomber sur État.
  const pending = (featuresLoading || adminLoading) && requested && !tabs.some((tab) => tab.id === requested)
    && TABS.some((tab) => tab.id === requested);
  const active = pickTab(requested, tabs.map((tab) => tab.id));
  const { Component } = tabs.find((tab) => tab.id === active);
  // Onglet Alertes : on attend les fonctionnalités pour savoir s'il montre aussi les alertes.
  const waiting = pending || (active === 'alertes' && featuresLoading);
  const labelOf = (tab) => (tab.id === 'alertes' && !featuresLoading && !alertsEnabled ? 'Journaux' : tab.label);

  return (
    <PageContainer>
      <PageHeader title="Mes bornes" />
      <PageTabs
        label="Bornes"
        active={active}
        tabs={tabs.map((tab) => ({ id: tab.id, label: labelOf(tab), to: `?tab=${tab.id}` }))}
      />
      {waiting ? spinner : (
        <Suspense fallback={spinner}>
          <Component key={active} {...(active === 'alertes' ? { alertsEnabled } : {})} />
        </Suspense>
      )}
    </PageContainer>
  );
}
