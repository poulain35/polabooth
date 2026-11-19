// Encart « Nouvelle version » du menu de l'admin, sous Aide : affiché seulement quand une borne du compte
// tourne sur une version plus ancienne que la dernière publiée (pendingKioskUpdate). Mène à l'onglet
// Versions de la page Bornes, où la mise à jour se demande borne par borne.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { PolaboothStripe } from '../PolaboothBrand';
import { fetchKioskReleases, fetchLicenses } from '../../lib/api/kiosks';
import { pendingKioskUpdate } from '../../lib/kioskUpdate';

/** `refreshKey` : relit les bornes quand il change (retour sur la page Bornes après une demande). */
export default function KioskUpdateCard({ orgId, refreshKey, onNavigate }) {
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!orgId) return undefined;
    let cancelled = false;
    Promise.all([fetchLicenses(), fetchKioskReleases()])
      .then(([licenses, releases]) => { if (!cancelled) setPending(pendingKioskUpdate(licenses, releases, orgId)); })
      .catch(() => { /* non bloquant : pas d'encart */ });
    return () => { cancelled = true; };
  }, [orgId, refreshKey]);

  if (!pending) return null;
  return (
    <div role="status" className="relative flex flex-col gap-2.5 overflow-hidden rounded-card bg-primary-soft px-4 pb-4 pt-[18px]">
      <PolaboothStripe className="absolute inset-x-0 top-0" />
      <div className="flex items-center gap-2.5">
        <img src="/polabooth/icon.svg" alt="" className="h-8 w-8 shrink-0" />
        <span className="text-sm font-medium text-foreground">Borne {pending.version}</span>
      </div>
      <p className="text-[13px] leading-snug text-muted-foreground">
        Nouvelle version disponible pour {pending.count} {pending.count > 1 ? 'bornes' : 'borne'}.
      </p>
      <Button asChild variant="strong" size="sm" className="self-start">
        <Link to="/admin/bornes?tab=versions" onClick={onNavigate}>Mettre à jour</Link>
      </Button>
    </div>
  );
}
