// Bornes (/admin/bornes?tab=etat|materiel|ecrans|alertes|code|versions, LAB-335 puis LAB-338) : état des
// bornes, stock de matériel (LAB-358), écrans de la borne, alertes (fonctionnalité kiosk_alerts), écran de saisie du code (admin
// de la plateforme seulement) et versions. Une alerte précise : ?tab=alertes&alerte=<id>.
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageTabs from '../../components/admin/PageTabs';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { BORNES_TABS, pickTab } from '../../features/adminRoutes';
import { useFeatures } from '../../hooks/useFeatures';
import { useAppAdmin } from '../../hooks/useAppAdmin';
import { Spinner } from '../../components/ui/spinner';

const AdminLicenses = lazy(() => import('./AdminLicenses'));
const EquipmentTab = lazy(() => import('./bornes/EquipmentTab'));
const ScreenCards = lazy(() => import('./AdminKioskScreens').then((m) => ({ default: m.ScreenCards })));
const AlertsTab = lazy(() => import('./bornes/AlertsTab'));
const CodeScreenTab = lazy(() => import('./bornes/CodeScreenTab'));
const VersionsTab = lazy(() => import('./bornes/VersionsTab'));

const TABS = [
  { id: 'etat', label: 'État', Component: AdminLicenses },
  { id: 'materiel', label: 'Matériel', Component: EquipmentTab },
  { id: 'ecrans', label: 'Écrans', Component: ScreenCards },
  { id: 'alertes', label: 'Alertes', Component: AlertsTab, feature: 'kiosk_alerts' },
  { id: 'code', label: 'Code', Component: CodeScreenTab, appAdminOnly: true },
  { id: 'versions', label: 'Versions', Component: VersionsTab },
].filter((tab) => BORNES_TABS.includes(tab.id));

const spinner = (
  <div className="flex justify-center py-24">
    <Spinner />
  </div>
);

export default function AdminBornes() {
  const [searchParams] = useSearchParams();
  const { isAvailable, loading: featuresLoading } = useFeatures();
  const { isAdmin, loading: adminLoading } = useAppAdmin();
  const requested = searchParams.get('tab');

  const tabs = TABS.filter((tab) => (!tab.feature || isAvailable(tab.feature)) && (!tab.appAdminOnly || isAdmin));
  // Onglet réservé demandé : on attend de savoir s'il est permis avant de retomber sur État.
  const pending = (featuresLoading || adminLoading) && requested && !tabs.some((tab) => tab.id === requested)
    && TABS.some((tab) => tab.id === requested);
  const active = pickTab(requested, tabs.map((tab) => tab.id));
  const { Component } = tabs.find((tab) => tab.id === active);

  return (
    <PageContainer>
      <PageHeader title="Mes bornes" />
      <PageTabs
        label="Bornes"
        active={active}
        tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label, to: `?tab=${tab.id}` }))}
      />
      {pending ? spinner : (
        <Suspense fallback={spinner}>
          <Component key={active} />
        </Suspense>
      )}
    </PageContainer>
  );
}
