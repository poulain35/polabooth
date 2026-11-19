/**
 * Page publique /installer-borne : adresse courte et fixe qui télécharge la dernière version de la
 * borne (RPC get_latest_kiosk_installer, ouverte à anon). Sur un PC neuf, on tape l'adresse dans le
 * navigateur et le téléchargement part tout seul, sans connexion. Bouton « Télécharger » en secours,
 * message si aucune version n'est publiée. noindex : meta robots ici + en-tête X-Robots-Tag (vercel.json).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { getLatestKioskInstaller } from '../lib/supabase';
import { kioskInstallerTarget } from '../lib/kioskUpdate';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import ProductLogo from '../components/ProductLogo';
import useProductFavicon from '../hooks/useProductFavicon';

/** Titre de l'onglet et meta robots noindex, remis comme avant en quittant la page. */
function usePrivateHead(title) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.title = previousTitle;
      meta.remove();
    };
  }, [title]);
}

export default function KioskInstaller() {
  useProductFavicon();
  usePrivateHead('Installer la borne · Polabooth');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading' }); // loading | ready | none | error
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getLatestKioskInstaller()
      .then((data) => {
        if (cancelled) return;
        const target = kioskInstallerTarget(data);
        setState(target ? { status: 'ready', ...target } : { status: 'none' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [attempt]);

  // Téléchargement lancé une seule fois : l'installeur est servi en pièce jointe, la page reste affichée.
  useEffect(() => {
    if (state.status !== 'ready' || started.current) return;
    started.current = true;
    window.location.assign(state.exeUrl);
  }, [state]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 max-w-md w-full mx-auto">
        <ProductLogo className="h-8 w-auto" />
      </header>

      <main className="flex-1 px-4 pb-10 max-w-md w-full mx-auto space-y-4">
        <h1 className="text-page-title text-foreground">Installer la borne</h1>

        <Card className="p-5 space-y-4">
          {state.status === 'loading' && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Recherche de la dernière version…
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <div className="space-y-1">
                <p className="text-base font-medium text-foreground">
                  Le téléchargement de la version {state.version} a commencé.
                </p>
                <p className="text-sm text-muted-foreground">
                  Rien ne se passe au bout de quelques secondes ? Cliquez sur le bouton.
                </p>
              </div>
              <Button asChild>
                <a href={state.exeUrl} download>
                  <Download className="w-4 h-4" />
                  Télécharger la version {state.version}
                </a>
              </Button>
              <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                <li>Ouvrez le fichier téléchargé (setup-polakiosk.exe).</li>
                <li>
                  Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations
                  complémentaires » puis « Exécuter quand même ».
                </li>
                <li>Suivez l’installation, lancez la borne, puis associez-la à votre compte avec le code qu’elle affiche.</li>
              </ol>
            </>
          )}

          {state.status === 'none' && (
            <p className="text-sm text-muted-foreground">
              Aucune version de la borne n’est publiée pour le moment.
            </p>
          )}

          {state.status === 'error' && (
            <div className="space-y-3">
              <div role="alert" className="flex items-start gap-2 rounded-xl bg-state-red px-3 py-2.5 text-sm text-state-red-fg">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>La dernière version n’a pas pu être trouvée. Vérifiez la connexion à internet, puis réessayez.</span>
              </div>
              <Button variant="outline" onClick={retry}>Réessayer</Button>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
