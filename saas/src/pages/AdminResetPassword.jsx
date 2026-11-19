import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { openPasswordRecovery, updatePassword } from '../lib/supabase';
import { FORGOT_PASSWORD_PATH, passwordProblem, recoveryLinkMessage } from '../lib/passwordRules';
import { Button } from '../components/ui/button';
import AuthPageShell from '../components/AuthPageShell';
import NewPasswordFields from '../components/NewPasswordFields';

/** Page ouverte par le lien de l'email « Mot de passe oublié » (route publique). */
export default function AdminResetPassword() {
  const navigate = useNavigate();
  const [state,        setState]        = useState({ status: 'checking' });
  const [password,     setPassword]     = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error,        setError]        = useState('');
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    let active = true;
    openPasswordRecovery()
      .then((res) => { if (active) setState(res.ok ? { status: 'ready', email: res.email } : { status: 'invalid', reason: res.reason }); })
      .catch(() => { if (active) setState({ status: 'invalid', reason: 'invalid' }); });
    return () => { active = false; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = passwordProblem(password, confirmation);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      await updatePassword(password);
      toast.success('Mot de passe modifié.');
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const shell = (children) => (
    <AuthPageShell
      title="Nouveau mot de passe"
      subtitle="Choisissez le mot de passe de votre compte administrateur."
      label="Réinitialisation"
      icon={KeyRound}
    >
      {children}
    </AuthPageShell>
  );

  if (state.status === 'checking') {
    return shell(
      <div className="flex justify-center py-6">
        <Loader2 className="w-6 h-6 animate-spin text-primary-ink" />
      </div>
    );
  }

  if (state.status === 'invalid') {
    return shell(
      <div className="space-y-4">
        <p className="text-[13px] text-state-red-fg flex items-start gap-1.5 bg-state-red rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {recoveryLinkMessage(state.reason)}
        </p>
        <Button asChild className="w-full">
          <Link to={FORGOT_PASSWORD_PATH}>Recevoir un nouveau lien</Link>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/admin/login" className="text-primary-ink hover:underline font-medium">← Retour à la connexion</Link>
        </p>
      </div>
    );
  }

  return shell(
    <form onSubmit={handleSubmit} className="space-y-4">
      {state.email && (
        <p className="text-sm text-muted-foreground">
          Compte : <span className="font-medium text-foreground">{state.email}</span>
        </p>
      )}
      <NewPasswordFields
        idPrefix="reset"
        autoFocus
        password={password}
        confirmation={confirmation}
        onPassword={(v) => { setPassword(v); setError(''); }}
        onConfirmation={(v) => { setConfirmation(v); setError(''); }}
      />

      {error && (
        <p className="text-[13px] text-state-red-fg flex items-start gap-1.5 bg-state-red rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? (<><Loader2 className="w-4 h-4 animate-spin" />Enregistrement…</>) : 'Enregistrer le mot de passe'}
      </Button>
    </form>
  );
}
