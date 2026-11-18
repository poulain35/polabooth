import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEventByCode } from '../lib/supabase';
import BrandLogo from '../components/BrandLogo';
import { BRAND } from '../lib/instanceBrand';
import { usePfFonts } from '../components/public/clientEditorStyles';
import { Spinner } from '../components/ui/spinner';

export default function Landing() {
  usePfFonts();
  const navigate = useNavigate();
  const [code, setCode]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      await getEventByCode(trimmed);
      navigate(`/e/${trimmed}`);
    } catch (err) {
      setError(err.message ?? 'Code invalide');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pola-client pola-pf-page min-h-screen flex flex-col">

      {/* ── Header ── */}
      <header className="py-5 px-6 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-center">
          <BrandLogo className="h-9 w-auto" />
        </div>
      </header>

      {/* ── Accès par code ── */}
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-md flex flex-col items-center">

          <div className="text-center mb-7">
            <h1 className="pola-pf-title text-[34px] md:text-[40px] mb-3">
              Créez le cadre<br />de vos photos
            </h1>
            <p className="text-pf-muted leading-relaxed text-base">
              Entrez le code reçu par e-mail pour ouvrir<br className="hidden sm:block" />
              votre éditeur.
            </p>
          </div>

          <div className="pola-pf-card px-6 sm:px-8 py-7">

            <div className="pola-pf-icon-circle mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label htmlFor="access-code" className="block text-center text-sm font-medium text-pf-text">
                Code d'accès
              </label>
              <input
                id="access-code"
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                placeholder="ex : A3K9X2"
                maxLength={10}
                autoFocus
                aria-invalid={Boolean(error)}
                className={`w-full text-center text-3xl font-semibold tracking-[0.35em] py-4 px-4 text-pf-text
                  placeholder:text-pf-muted placeholder:font-normal placeholder:tracking-normal
                  border-2 rounded-2xl outline-none transition-colors
                  ${error
                    ? 'border-pola-error bg-pola-error-soft'
                    : 'border-pf-line bg-pf-bg focus:border-pf-noyer focus:bg-white'
                  }`}
              />

              {error && (
                <p className="pola-pf-error justify-center" role="alert">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="pola-pf-btn-primary w-full"
              >
                {loading ? (
                  <>
                    <Spinner className="h-4 w-4 border-current" label="Vérification en cours" />
                    Vérification…
                  </>
                ) : (
                  'Ouvrir mon éditeur →'
                )}
              </button>
            </form>

            {BRAND.email && (
              <p className="mt-5 text-center text-sm text-pf-muted">
                Pas de code ?{' '}
                <a href={`mailto:${BRAND.email}`} className="pola-pf-link">
                  Contactez {BRAND.name}
                </a>
              </p>
            )}
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="py-4 shrink-0 text-center text-sm text-pf-muted">
        © {new Date().getFullYear()} {BRAND.name} ·{' '}
        <a href="/admin/login" className="underline-offset-4 hover:underline hover:text-pf-text rounded-sm pola-pf-focus">Admin</a>
      </footer>
    </div>
  );
}
