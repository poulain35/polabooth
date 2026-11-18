import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '../ui/button';
import { Notice } from './CardParts';
import { sendTestEmail } from '../../lib/supabase';

// Bouton « Envoyer un email de test » (mise en route, LAB-345) : réservé à l'administrateur de
// l'application, l'email part à l'adresse de son compte. Résultat affiché sous le bouton.
export default function TestEmailButton({ size = 'sm', variant = 'outline', label = 'Envoyer un email de test', className = '' }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, hint? }

  async function send() {
    setSending(true);
    setResult(null);
    try {
      setResult(await sendTestEmail());
    } catch (e) {
      setResult({ ok: false, message: e?.message || 'Envoi de l\'email de test impossible' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={className}>
      <Button size={size} variant={variant} onClick={send} disabled={sending}>
        {sending ? <Loader2 className="animate-spin" /> : <Mail />}
        {sending ? 'Envoi…' : label}
      </Button>
      {result && (
        <Notice role="status" tone={result.ok ? 'green' : 'red'} className="mt-3">
          <span className="break-words">{result.message}</span>
          {result.hint && <span className="block text-xs opacity-80 mt-0.5">{result.hint}</span>}
        </Notice>
      )}
    </div>
  );
}
