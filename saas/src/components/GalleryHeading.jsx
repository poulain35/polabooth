// En-tête de la galerie des invités : logo, loueur, nom de l'événement, texte d'accueil, nombre de photos.
// Habillage de l'événement (LAB-303) par `look` (galleryLook, src/lib/galleryBranding.js) : sans réglage,
// palette noyer du site. Texte d'accueil en texte simple (échappé par React), retours à la ligne gardés.
import { useState } from 'react';
import BrandLogo from './BrandLogo.jsx';
import { BRAND } from '../lib/instanceBrand.js';

export default function GalleryHeading({ look, companyName, eventName, count }) {
  // Logo de l'événement cassé (fichier supprimé) : logo de l'instance, comme sans réglage.
  const [logoFailed, setLogoFailed] = useState(false);
  const eventLogo = look.logoUrl && !logoFailed ? look.logoUrl : null;
  return (
    <>
      <div className="mb-4">
        {eventLogo
          ? <img src={eventLogo} alt={eventName || companyName || BRAND.name} className="h-16 w-auto max-w-[240px] object-contain" onError={() => setLogoFailed(true)} />
          : <BrandLogo variant="square" alt={companyName || BRAND.name} className="h-10 w-auto" />}
      </div>
      {companyName && <p className="text-xs font-semibold text-pf-noyer uppercase tracking-widest mb-1">{companyName}</p>}
      {eventName && <h1 className={`font-pf-serif font-normal text-[26px] leading-tight ${look.classes.title} text-center`}>{eventName}</h1>}
      <p className="text-xs text-pf-muted mt-1">{count} photo{count !== 1 ? 's' : ''}</p>
      {look.text && <p className="mt-3 max-w-md text-sm text-pf-muted text-center whitespace-pre-line break-words">{look.text}</p>}
    </>
  );
}
