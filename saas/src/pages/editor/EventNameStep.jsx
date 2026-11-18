import { useState } from 'react';
import BrandLogo from '../../components/BrandLogo';

// ── Saisie du nom de l'événement (première connexion) ────────────────────────

export default function EventNameStep({ onSubmit }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err.message ?? "Impossible d'enregistrer le nom, réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-pf-bg font-pola text-pf-text flex flex-col items-center justify-center p-6">
      <div className="mb-8"><BrandLogo variant="square" className="h-12 w-auto" /></div>
      <div className="pola-pf-card p-8 max-w-sm">
        <h1 className="pola-pf-title text-[30px] mb-2 text-center">Bienvenue !</h1>
        <label htmlFor="event-name" className="block text-pf-muted text-base mb-6 text-center">
          Comment souhaitez-vous appeler votre événement ?
        </label>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            id="event-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Mariage Marie & Pierre"
            autoFocus
            className="pola-pf-input"
          />
          {error && (
            <p className="pola-pf-error" role="alert">{error}</p>
          )}
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="pola-pf-btn-primary w-full"
          >
            {saving ? 'Enregistrement…' : 'Continuer →'}
          </button>
        </form>
      </div>
    </div>
  );
}
