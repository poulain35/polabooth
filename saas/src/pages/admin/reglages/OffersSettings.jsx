// Section « Offres et réservation » de la page Réglages (/admin/reglages#offres, LAB-338) : sections
// des modules installés (réservation en ligne, retrait, catalogue, LAB-61), par l'emplacement
// `settings.sections`. Construction ouverte : aucun module, la section est cachée (hasOfferSettings).
import ModuleSlot from '../../../components/ModuleSlot';

export default function OffersSettings({ org }) {
  return (
    <div className="flex flex-col gap-5">
      <ModuleSlot name="settings.sections" org={org} />
    </div>
  );
}
