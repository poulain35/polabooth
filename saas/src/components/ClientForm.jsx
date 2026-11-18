import { useState } from 'react';
import { submitFormResponse } from '../lib/supabase';
import { isChoiceType, hasAnswer } from '../utils/formQuestions';
import BrandLogo from './BrandLogo';
import { BRAND } from '../lib/instanceBrand';
import { usePfFonts } from './public/clientEditorStyles';
import { Spinner } from './ui/spinner';

// Clavier et remplissage automatique adaptés au type de la question (LAB-352).
const INPUT_PROPS = {
  tel:   { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false },
  text:  { type: 'text' },
};

export default function ClientForm({ code, event, formConfig, initialAnswers, onDone }) {
  usePfFonts();
  const questions = formConfig?.questions ?? [];
  const [answers,  setAnswers]  = useState(initialAnswers ?? {});
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  function set(id, value) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleMulti(id, option) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? prev[id] : [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [id]: next };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Vérifier les questions obligatoires
    const missing = questions.find((q) => q.required && !hasAnswer(answers[q.id]));
    if (missing) {
      setError(`Le champ "${missing.label}" est obligatoire.`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await submitFormResponse({ code, answers });
      onDone(answers);
    } catch (err) {
      setError(err.message ?? 'Erreur lors de l\'envoi');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pola-client pola-pf-page min-h-screen flex flex-col">

      {/* Header */}
      <header className="py-5 px-6 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-center">
          <BrandLogo className="h-9 w-auto" />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        <div className="min-h-full flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-lg flex flex-col items-center">

          {/* Titre */}
          <div className="text-center mb-7">
            <h1 className="pola-pf-title text-[30px] md:text-[36px] mb-2">
              Bienvenue, quelques questions
            </h1>
            <p className="text-pf-muted text-base">
              {event.name} · Répondez avant d'ouvrir l'éditeur.
            </p>
          </div>

          {/* Card */}
          <div className="pola-pf-card px-6 sm:px-8 py-7">

            <div className="pola-pf-icon-circle mx-auto mb-5">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {questions.map((q) => (
                <div key={q.id}>
                  <label htmlFor={isChoiceType(q.type) ? undefined : `q-${q.id}`} className="pola-pf-label mb-2">
                    {q.label}
                    {q.required && <span className="text-pf-noyer ml-1" aria-hidden="true">*</span>}
                  </label>

                  {isChoiceType(q.type) ? (
                    <div className="space-y-2">
                      {(q.options ?? []).map((opt) => {
                        const checked = q.type === 'multi'
                          ? Array.isArray(answers[q.id]) && answers[q.id].includes(opt)
                          : answers[q.id] === opt;
                        return (
                          <label
                            key={opt}
                            className={`flex items-center gap-3 border-2 rounded-2xl px-4 py-3 text-base cursor-pointer transition-colors
                              ${checked ? 'border-pf-noyer bg-pf-surface text-pf-text' : 'border-pf-line bg-white text-pf-text hover:border-pf-muted'}`}
                          >
                            <input
                              type={q.type === 'multi' ? 'checkbox' : 'radio'}
                              name={q.id}
                              checked={checked}
                              onChange={() => q.type === 'multi' ? toggleMulti(q.id, opt) : set(q.id, opt)}
                              className="w-5 h-5 accent-[#6A4128]"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      id={`q-${q.id}`}
                      {...(INPUT_PROPS[q.type] ?? INPUT_PROPS.text)}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => set(q.id, e.target.value)}
                      placeholder={q.placeholder ?? ''}
                      aria-required={q.required || undefined}
                      className="pola-pf-input"
                    />
                  )}
                </div>
              ))}

              {error && (
                <p className="pola-pf-error" role="alert">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="pola-pf-btn-primary w-full mt-1"
              >
                {loading ? (
                  <>
                    <Spinner className="h-4 w-4 border-current" label="Envoi en cours" />
                    Envoi…
                  </>
                ) : "Continuer vers l'éditeur →"}
              </button>
            </form>
          </div>
        </div>
        </div>
      </main>

      <footer className="py-4 shrink-0 text-center text-sm text-pf-muted">
        © {new Date().getFullYear()} {BRAND.name}
      </footer>
    </div>
  );
}
