import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { requestPasswordReset, signInAdmin } from '../lib/supabase';
import { safeNextPath } from '../lib/kioskPairing';
import { RESET_REQUEST_SENT } from '../lib/passwordRules';
import AuthPageShell from '../components/AuthPageShell';

function ErrorLine({ children }) {
  return (
    <p className="text-sm text-destructive flex items-center gap-1.5 bg-destructive/10 rounded-md px-3 py-2">
      <AlertCircle className="w-4 h-4 shrink-0" />
      {children}
    </p>
  );
}

/** Demande d'un lien de réinitialisation : même message que le compte existe ou non. */
function ForgotPasswordForm({ initialEmail, onBack }) {
  const [email,   setEmail]   = useState(initialEmail);
  const [error,   setError]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm text-emerald-700 bg-emerald-50 rounded-md px-3 py-2 flex items-start gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            {RESET_REQUEST_SENT}
          </p>
          <p className="text-xs text-muted-foreground">
            Le lien est valable une heure et ne sert qu'une fois. Pensez à regarder dans les indésirables.
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={() => setSent(false)}>
            Renvoyer un email
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Saisissez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email" type="email" value={email} autoFocus required
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="admin@exemple.fr"
            />
          </div>

          {error && <ErrorLine>{error}</ErrorLine>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (<><Loader2 className="w-4 h-4 animate-spin" />Envoi…</>) : 'Recevoir le lien'}
          </Button>
        </form>
      )}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        <button type="button" onClick={onBack} className="text-primary hover:underline font-medium">
          ← Retour à la connexion
        </button>
      </p>
    </>
  );
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  // ?oubli=1 : arrivée depuis un lien de réinitialisation expiré.
  const [forgot,   setForgot]   = useState(() => searchParams.has('oubli'));

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInAdmin(email, password);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    // ?next= : retour vers une page admin interne (ex. /admin/demandes/:id depuis un lien
    // d'email déjà utilisé). Chemin relatif uniquement : pas de redirection ouverte.
    // LAB-243 : aussi /associer?code=… (QR code affiché par une borne).
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    navigate(next ?? '/admin/events');
  }

  if (forgot) {
    return (
      <AuthPageShell
        title="Mot de passe oublié"
        subtitle="Recevez un lien pour en choisir un nouveau."
        label="Réinitialisation"
        icon={KeyRound}
      >
        <ForgotPasswordForm initialEmail={email} onBack={() => setForgot(false)} />
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Espace administration"
      subtitle="Connectez-vous pour gérer vos événements."
      label="Connexion admin"
    >
      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email" type="email" value={email} autoFocus required
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            placeholder="admin@exemple.fr"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="password">Mot de passe</Label>
            <button
              type="button"
              onClick={() => { setForgot(true); setError(''); }}
              className="text-xs text-primary hover:underline font-medium"
            >
              Mot de passe oublié ?
            </button>
          </div>
          <Input
            id="password" type="password" value={password} required autoComplete="current-password"
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="••••••••"
          />
        </div>

        {error && <ErrorLine>{error}</ErrorLine>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? (<><Loader2 className="w-4 h-4 animate-spin" />Connexion…</>) : 'Se connecter'}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        <a href="/" className="text-primary hover:underline font-medium">← Retour à l'accueil</a>
      </p>
    </AuthPageShell>
  );
}
