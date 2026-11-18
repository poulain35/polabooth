import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { isChunkLoadError, reloadOnceForNewVersion } from '../lib/chunkReload';
import { usePfFonts } from './public/clientEditorStyles';

/**
 * Écran d'erreur des routes (remplace l'écran « Unexpected Application Error » de React Router).
 * Page de l'ancienne version introuvable après une mise en ligne : rechargement automatique, une fois.
 */
export default function RouteError() {
  usePfFonts();
  const error = useRouteError();
  const newVersion = isChunkLoadError(error);
  // Rendu pur : le rechargement part de l'effet, une seule fois par minute (lib/chunkReload).
  useEffect(() => {
    if (newVersion) reloadOnceForNewVersion();
    else console.error(error);
  }, [newVersion, error]);

  return (
    <div className="pola-client pola-pf-page min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="pola-pf-title text-[26px]">
          {newVersion ? 'Une nouvelle version est disponible' : 'Cette page n’a pas pu s’afficher'}
        </h1>
        <p className="mt-2 text-[15px] text-pf-muted">
          {newVersion
            ? 'L’application a été mise à jour pendant que la page était ouverte. Rechargez la page pour continuer.'
            : 'Une erreur inattendue s’est produite. Rechargez la page ; si le problème continue, revenez à l’accueil.'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="pola-pf-btn-primary px-5 py-2.5 text-sm"
          >
            Recharger la page
          </button>
          <a href="/" className="pola-pf-btn-secondary px-5 py-2.5 text-sm">
            Retour à l’accueil
          </a>
        </div>
      </div>
    </div>
  );
}
