import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEventByCode } from '../lib/supabase';
import BrandLogo from '../components/BrandLogo';
import { BRAND } from '../lib/instanceBrand';

export default function Landing() {
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
    <div className="h-screen flex flex-col relative overflow-hidden">

      {/* ── Background dégradé ── */}
      <div className="absolute inset-0 -z-10"
        style={{
          background: 'linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 35%, #fdf4ff 65%, #fff7ed 100%)',
        }}
      />
      {/* Orbes flous décoratifs */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-40 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #a5b4fc, transparent 70%)' }} />
      <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full opacity-30 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #86efac, transparent 70%)' }} />
      <div className="absolute bottom-0 left-1/3 w-72 h-72 rounded-full opacity-25 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #f0abfc, transparent 70%)' }} />

      {/* ── Header ── */}
      <header className="py-4 px-8 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-center">
          <BrandLogo className="h-9 w-auto" />
        </div>
      </header>

      {/* ── Hero ── */}
      <main className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        <div className="w-full max-w-md flex flex-col items-center">

          {/* Titre au-dessus de la card */}
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2 leading-tight">
              Créez votre template<br />photobooth
            </h1>
            <p className="text-gray-500 leading-relaxed text-sm">
              Entrez le code reçu par email pour accéder<br className="hidden sm:block" />
              à votre éditeur personnalisé.
            </p>
          </div>

          {/* ── Card blanche ── */}
          <div className="w-full bg-card rounded-3xl shadow-xl shadow-gray-200/60 px-8 py-6 border border-white/80">

            {/* Icône */}
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>

            <p className="text-center text-xs font-medium text-gray-400 mb-4 uppercase tracking-widest">
              Code d'accès
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                placeholder="ex : A3K9X2"
                maxLength={10}
                autoFocus
                className={`w-full text-center text-3xl font-bold tracking-[0.35em] py-4 px-4
                  border-2 rounded-2xl outline-none transition-all
                  ${error
                    ? 'border-red-300 bg-red-50 focus:border-red-400'
                    : 'border-gray-100 bg-gray-50 focus:border-primary focus:bg-card focus:shadow-md focus:shadow-primary/15'
                  }`}
              />

              {error && (
                <p className="text-sm text-red-500 flex items-center justify-center gap-1.5">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full py-3.5 text-white font-semibold text-base rounded-2xl
                  disabled:opacity-50 disabled:cursor-not-allowed transition-all
                  shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Vérification…
                  </span>
                ) : (
                  'Accéder à l\'éditeur →'
                )}
              </button>
            </form>

            {BRAND.email && (
              <p className="mt-4 text-center text-xs text-gray-400">
                Pas de code ?{' '}
                <a href={`mailto:${BRAND.email}`} className="text-primary hover:text-primary transition-colors font-medium">
                  Contactez {BRAND.name}
                </a>
              </p>
            )}
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="py-3 shrink-0 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {BRAND.name} ·{' '}
        <a href="/admin/login" className="hover:text-gray-600 transition-colors">Admin</a>
      </footer>
    </div>
  );
}
