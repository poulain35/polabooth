import { useState } from 'react';
import { submitFormResponse } from '../lib/supabase';
import { isChoiceType, hasAnswer } from '../utils/formQuestions';
import BrandLogo from './BrandLogo';
import { BRAND } from '../lib/instanceBrand';

export default function ClientForm({ code, event, formConfig, initialAnswers, onDone }) {
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
      onDone();
    } catch (err) {
      setError(err.message ?? 'Erreur lors de l\'envoi');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex flex-col relative overflow-hidden">

      {/* Background */}
      <div className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 35%, #fdf4ff 65%, #fff7ed 100%)' }}
      />
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-40 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #a5b4fc, transparent 70%)' }} />
      <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full opacity-30 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #86efac, transparent 70%)' }} />
      <div className="absolute bottom-0 left-1/3 w-72 h-72 rounded-full opacity-25 blur-3xl -z-10"
        style={{ background: 'radial-gradient(circle, #f0abfc, transparent 70%)' }} />

      {/* Header */}
      <header className="py-4 px-8 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-center">
          <BrandLogo className="h-9 w-auto" />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-4 py-4">
        <div className="w-full max-w-lg flex flex-col items-center">

          {/* Titre */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-1.5">
              Bienvenue, quelques questions
            </h1>
            <p className="text-gray-500 text-sm">
              {event.name} · Répondez avant d'accéder à l'éditeur.
            </p>
          </div>

          {/* Card */}
          <div className="w-full bg-card rounded-3xl shadow-xl shadow-gray-200/60 px-8 py-6 border border-white/80">

            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {questions.map((q) => (
                <div key={q.id}>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                    {q.label}
                    {q.required && <span className="text-primary ml-1">*</span>}
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
                            className={`flex items-center gap-2.5 border-2 rounded-2xl px-4 py-2.5 text-sm cursor-pointer transition-all
                              ${checked ? 'border-primary bg-primary/5 text-gray-900' : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'}`}
                          >
                            <input
                              type={q.type === 'multi' ? 'checkbox' : 'radio'}
                              name={q.id}
                              checked={checked}
                              onChange={() => q.type === 'multi' ? toggleMulti(q.id, opt) : set(q.id, opt)}
                              className="accent-primary"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      type={q.type === 'tel' ? 'tel' : q.type === 'email' ? 'email' : 'text'}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => set(q.id, e.target.value)}
                      placeholder={q.placeholder ?? ''}
                      className="w-full border-2 border-gray-100 bg-gray-50 text-gray-900 placeholder-gray-300
                        rounded-2xl px-4 py-2.5 text-sm outline-none transition-all
                        focus:border-primary focus:bg-card focus:shadow-md focus:shadow-primary/15"
                    />
                  )}
                </div>
              ))}

              {error && (
                <p className="text-sm text-red-500 flex items-center gap-1.5 bg-red-50 rounded-xl px-3 py-2">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 text-white font-semibold text-sm rounded-2xl mt-1
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
                    Envoi…
                  </span>
                ) : 'Continuer vers l\'éditeur →'}
              </button>
            </form>
          </div>
        </div>
        </div>
      </main>

      <footer className="py-3 shrink-0 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {BRAND.name}
      </footer>
    </div>
  );
}
