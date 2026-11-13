/**
 * Page publique /rapport/:token (LAB-236, spec LAB-209 SAAS-3) : charge le bilan par son jeton
 * (RPC get_event_report) et l'affiche avec EventReportView. Jeton inconnu, révoqué ou expiré :
 * la RPC renvoie null et la page dit seulement « Ce bilan n'est plus disponible », sans la cause.
 * noindex : meta robots ici + en-tête X-Robots-Tag (vercel.json).
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getEventReport } from '../lib/supabase';
import { isReportToken } from '../lib/eventReport';
import { FEATURE_UNAVAILABLE_MESSAGE, isFeatureDisabledError } from '../features/featureGate';
import { usePolaPublicHead } from '../components/public/polaHead';
import { POLA_F_FONTS_HREF } from '../components/public/polaStyles';
import EventReportView, { ReportShell, ReportUnavailable } from '../components/report/EventReportView';
import { BRAND } from '../lib/instanceBrand';

const APP_URL = (import.meta.env.VITE_APP_URL ?? window.location.origin).replace(/\/$/, '');

export default function EventReport() {
  const { token = '' } = useParams();
  const valid = isReportToken(token);
  const [attempt, setAttempt] = useState(0);
  // Résultat du dernier chargement, rattaché au jeton et à l'essai : sinon on est en cours de chargement.
  const [result, setResult] = useState(null);
  const key = `${token}#${attempt}`;
  const state = !valid ? { status: 'unavailable' } : result?.key === key ? result : { status: 'loading' };

  const title = state.status === 'ready' && state.report?.name ? `Bilan · ${state.report.name}` : `Bilan de votre événement · ${BRAND.name}`;
  usePolaPublicHead(title, { privatePage: true, fontsHref: POLA_F_FONTS_HREF });

  useEffect(() => {
    if (!valid) return undefined;
    let cancelled = false;
    getEventReport(token.trim())
      .then((report) => { if (!cancelled) setResult(report ? { key, status: 'ready', report } : { key, status: 'unavailable' }); })
      .catch((err) => {
        if (cancelled) return;
        // Bilan désactivé pour l'organisation (fonctionnalité event_report).
        setResult({ key, status: isFeatureDisabledError(err) ? 'disabled' : 'error' });
      });
    return () => { cancelled = true; };
  }, [token, valid, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.status === 'ready') return <EventReportView report={state.report} appUrl={APP_URL} />;
  if (state.status === 'unavailable') return <ReportUnavailable />;
  if (state.status === 'disabled') {
    return (
      <ReportShell>
        <h1 className="mt-10 font-pf-serif font-normal text-[34px] md:text-[44px] leading-tight">{FEATURE_UNAVAILABLE_MESSAGE}</h1>
      </ReportShell>
    );
  }
  if (state.status === 'error') {
    return (
      <ReportShell>
        <h1 className="mt-10 font-pf-serif font-normal text-[34px] md:text-[44px] leading-tight">Le bilan n’a pas pu être chargé.</h1>
        <p className="mt-4 text-lg text-pf-muted">Vérifiez votre connexion, puis réessayez.</p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-pf-noyer text-white text-[17px] font-medium px-7 py-4 hover:bg-pf-noyer-h transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pf-noyer focus-visible:ring-offset-2"
        >
          Réessayer
        </button>
      </ReportShell>
    );
  }
  return (
    <ReportShell>
      <p role="status" className="mt-16 text-center text-lg text-pf-muted">Chargement du bilan…</p>
    </ReportShell>
  );
}
