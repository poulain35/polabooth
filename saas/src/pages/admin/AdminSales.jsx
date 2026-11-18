// Demandes et devis (/admin/ventes?tab=demandes|devis|prospects, LAB-335) : coquille à onglets
// remplie par les modules (emplacement sales.tabs). Sans onglet, la page renvoie à Aujourd'hui.
import { Suspense, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import PageTabs from '../../components/admin/PageTabs';
import { useSalesTabs, countSalesTodo } from '../../hooks/useSalesTabs';
import { useFeatures } from '../../hooks/useFeatures';
import { ADMIN_HOME, pickTab } from '../../features/adminRoutes';
import { Spinner } from '../../components/ui/spinner';

const spinner = (
  <div className="flex justify-center py-24">
    <Spinner />
  </div>
);

export default function AdminSales() {
  const [searchParams] = useSearchParams();
  const { loading } = useFeatures();
  const tabs = useSalesTabs();
  const active = pickTab(searchParams.get('tab'), tabs.map((tab) => tab.id));
  const [counts, setCounts] = useState({});

  const tabKey = tabs.map((tab) => tab.id).join(',');
  useEffect(() => {
    let alive = true;
    countSalesTodo(tabs).then((next) => { if (alive) setCounts(next); });
    return () => { alive = false; };
    // Recompté à chaque changement d'onglet (une demande acceptée passe dans les devis).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, active]);

  if (!tabs.length) return loading ? spinner : <Navigate to={ADMIN_HOME} replace />;

  const current = tabs.find((tab) => tab.id === active);
  const { Component } = current;

  return (
    <PageContainer>
      <PageHeader title="Demandes et devis" description={current.description} />
      <PageTabs
        label="Demandes et devis"
        active={active}
        tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label, to: `?tab=${tab.id}`, count: counts[tab.id] }))}
      />
      <Suspense fallback={spinner}>
        <Component key={current.id} {...(current.props ?? {})} />
      </Suspense>
    </PageContainer>
  );
}
