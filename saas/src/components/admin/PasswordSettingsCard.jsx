import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getCurrentUserEmail, sendReauthenticationCode, updatePassword } from '../../lib/supabase';
import { passwordProblem } from '../../lib/passwordRules';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import NewPasswordFields from '../NewPasswordFields';

/**
 * Carte « Mot de passe » des Paramètres (LAB-268). Si le projet Supabase exige une confirmation
 * (« Secure password change » : session de plus de 24 h), un code est envoyé par email et demandé ici ;
 * s'il exige le mot de passe actuel, le champ apparaît.
 */
export default function PasswordSettingsCard() {
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmation,    setConfirmation]    = useState('');
  const [nonce,           setNonce]           = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [needNonce,       setNeedNonce]       = useState(false);
  const [needCurrent,     setNeedCurrent]     = useState(false);
  const [error,           setError]           = useState('');
  const [saving,          setSaving]          = useState(false);

  useEffect(() => { getCurrentUserEmail().then(setEmail).catch(() => {}); }, []);

  function reset() {
    setPassword(''); setConfirmation(''); setNonce(''); setCurrentPassword('');
    setNeedNonce(false); setNeedCurrent(false); setError('');
  }

  async function askCode() {
    await sendReauthenticationCode();
    setNeedNonce(true);
    toast.success(`Code de vérification envoyé à ${email || 'votre adresse'}.`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = passwordProblem(password, confirmation);
    if (problem) { setError(problem); return; }
    if (needNonce && !nonce.trim()) { setError('Saisissez le code reçu par email.'); return; }
    if (needCurrent && !currentPassword) { setError('Saisissez votre mot de passe actuel.'); return; }
    setSaving(true);
    setError('');
    try {
      await updatePassword(password, { nonce: needNonce ? nonce : undefined, currentPassword: needCurrent ? currentPassword : undefined });
      reset();
      toast.success('Mot de passe modifié.');
    } catch (err) {
      if (err.code === 'reauthentication_needed' && !needNonce) {
        try { await askCode(); } catch (sendErr) { setError(sendErr.message); }
      } else if (err.code === 'current_password_required') {
        setNeedCurrent(true);
        setError(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleResend() {
    setSaving(true);
    setError('');
    try { await askCode(); } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Mot de passe</h2>
      <p className="text-sm text-gray-500 mb-5">
        Mot de passe de connexion à l'administration{email ? <> ({email})</> : null}.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        {needCurrent && (
          <div className="space-y-1.5">
            <Label htmlFor="pwd-current">Mot de passe actuel</Label>
            <Input
              id="pwd-current" type="password" value={currentPassword} autoComplete="current-password"
              onChange={(e) => { setCurrentPassword(e.target.value); setError(''); }}
            />
          </div>
        )}
        <NewPasswordFields
          idPrefix="pwd"
          password={password}
          confirmation={confirmation}
          onPassword={(v) => { setPassword(v); setError(''); }}
          onConfirmation={(v) => { setConfirmation(v); setError(''); }}
        />
        {needNonce && (
          <div className="space-y-1.5">
            <Label htmlFor="pwd-nonce">Code de vérification</Label>
            <Input
              id="pwd-nonce" value={nonce} inputMode="numeric" autoComplete="one-time-code" autoFocus
              onChange={(e) => { setNonce(e.target.value); setError(''); }}
            />
            <p className="text-xs text-gray-400">
              Par sécurité, saisissez le code envoyé à {email || 'votre adresse'}.{' '}
              <button type="button" onClick={handleResend} disabled={saving} className="text-primary hover:underline">
                Renvoyer le code
              </button>
            </p>
          </div>
        )}

        {error && <p className="text-sm bg-red-50 text-red-700 rounded-md px-3 py-2">{error}</p>}

        <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
          <Button type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Changer le mot de passe'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
