// Page d'aide (/aide) : liens dans un texte et contact du loueur (appel, SMS, message), partagés entre la
// page ouverte et le chat de l'assistant (module privé, LAB-422). Style du site (classes pola-pf-*).
import { useState } from 'react';
import { CheckCircle2, Mail, MessageSquare, Phone } from 'lucide-react';
import { submitSupportMessage } from '../../lib/supabase';
import { isFeatureDisabledError } from '../../features/featureGate';
import { cn } from '../../lib/utils';

// Rend un texte en transformant les URLs en liens cliquables. `linkClassName` : couleur du lien
// (vide dans une bulle noyer, où le lien garde la couleur du texte).
export function Linkified({ text, linkClassName = 'text-pf-noyer' }) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={cn('break-all underline underline-offset-2', linkClassName)}>{part}</a>
      : part
  );
}

// ── Boutons d'escalade + formulaire « laisser un message » ──────────────────────
export function Escalation({ code, contact, phone, urgency, transcript }) {
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState('');
  const [msgPhone, setMsgPhone]   = useState('');
  const [text, setText]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent]           = useState(false);
  const [err, setErr]             = useState('');

  const blocking = urgency === 'blocking';

  async function submit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true); setErr('');
    try {
      await submitSupportMessage({
        code, name, phone: msgPhone, message: text,
        urgency: blocking ? 'blocking' : 'normal', transcript,
      });
      setSent(true);
    } catch (e) {
      setErr(isFeatureDisabledError(e) ? "L'envoi de message n'est pas disponible." : e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="mx-3 mb-3 flex items-start gap-2 rounded-2xl bg-pf-sage-soft p-3 text-[15px] text-pf-sage">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 break-words">Message envoyé. {contact?.contact_company || 'Le loueur'} vous recontactera dès que possible.</span>
      </p>
    );
  }

  return (
    <div className={cn('mx-3 mb-3 rounded-2xl p-3', blocking ? 'bg-pola-error-soft' : 'bg-pf-surface')}>
      <p className={cn('mb-2 text-[15px] font-medium', blocking ? 'text-pola-error' : 'text-pf-text')}>
        {blocking
          ? 'Problème bloquant — contactez le loueur directement :'
          : 'Besoin de contacter le loueur ?'}
      </p>

      {/* flex-wrap : sur un petit téléphone, le troisième bouton passe à la ligne au lieu de déborder. */}
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={`tel:${phone}`} className={cn(blocking ? 'pola-btn-destructive' : 'pola-pf-btn-primary', 'flex-1 px-4 py-3 text-base')}>
            <Phone aria-hidden="true" className="size-4" />Appeler
          </a>
        )}
        {phone && (
          <a href={`sms:${phone}`} className="pola-pf-btn-secondary flex-1 bg-white px-4">
            <MessageSquare aria-hidden="true" className="size-4" />SMS
          </a>
        )}
        <button type="button" className="pola-pf-btn-secondary flex-1 bg-white px-4" aria-expanded={showForm} onClick={() => setShowForm((s) => !s)}>
          <Mail aria-hidden="true" className="size-4" />Message
        </button>
      </div>

      {showForm && (
        <div className="mt-3 flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre prénom" aria-label="Votre prénom" className="pola-pf-input" />
          <input value={msgPhone} onChange={(e) => setMsgPhone(e.target.value)} type="tel"
            placeholder="Votre numéro (pour être rappelé)" aria-label="Votre numéro (pour être rappelé)" className="pola-pf-input" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder="Décrivez votre problème…" aria-label="Décrivez votre problème" className="pola-pf-input resize-none" />
          {err && <p role="alert" className="pola-pf-error break-words">{err}</p>}
          <button type="button" onClick={submit} disabled={!text.trim() || submitting} className="pola-pf-btn-primary w-full">
            {submitting ? 'Envoi…' : 'Envoyer le message'}
          </button>
        </div>
      )}
    </div>
  );
}
