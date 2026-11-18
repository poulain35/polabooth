// Bibliothèque (administrateur de l'application, LAB-335) : barre d'onglets commune aux cadres photo,
// décorations et polices. Les éditeurs (/admin/templates/new, /admin/templates/:id/edit) restent à part.
import { Outlet, useLocation } from 'react-router-dom';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import PageTabs from '../../components/admin/PageTabs';

const TABS = [
  { id: 'templates', label: 'Cadres photo', to: '/admin/templates' },
  { id: 'decorations', label: 'Décorations', to: '/admin/decorations' },
  { id: 'fonts', label: 'Polices', to: '/admin/fonts' },
];

export default function AdminLibrary() {
  const { pathname } = useLocation();
  const active = TABS.find((tab) => pathname.startsWith(tab.to))?.id ?? 'templates';
  return (
    <PageContainer>
      <PageHeader title="Bibliothèque" />
      <PageTabs label="Bibliothèque" active={active} tabs={TABS} />
      {/* min-w-0 : l'onglet ne peut pas élargir la page (colonne flex). */}
      <div className="min-w-0">
        <Outlet />
      </div>
    </PageContainer>
  );
}
