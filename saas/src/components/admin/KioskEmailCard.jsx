// Carte « Email de la photo » de l'onglet Partage (LAB-302, spec email-galerie-couleurs) : textes de
// l'email envoyé par la borne (objet, titre, message, bouton), variables insérées au curseur,
// avertissements, et aperçu servi par kiosk-email-preview. Écrit par l'admin seulement.
import { useRef, useState } from 'react';
import { TEXT_LIMITS } from '../../lib/eventBranding';
import { emailWarnings } from '../../lib/eventBrandingAdmin';
import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { Textarea } from '../ui/textarea';
import KioskEmailPreview from './KioskEmailPreview';
import { Input } from '../ui/input';

const VARIABLES = [
  { name: 'event_name', help: "nom de l'événement" },
  { name: 'event_date', help: 'date, « samedi 13 juin 2026 »' },
  { name: 'client_name', help: 'nom du client' },
  { name: 'company_name', help: 'nom de votre société' },
  { name: 'photo_url', help: 'lien de la photo' },
];

const charCount = (v) => Array.from(v ?? '').length;

function Counter({ value, max }) {
  const n = charCount(value);
  return <span className={`text-xs ${n > max ? 'text-destructive' : 'text-muted-foreground'}`}>{n}/{max}</span>;
}

export default function KioskEmailCard({ eventId, event, email, setEmail, companyName, previewDraft }) {
  const fields = useRef({});
  const [activeField, setActiveField] = useState('message');
  const warnings = emailWarnings(email, event);

  function insertVariable(name) {
    const token = `{${name}}`;
    const key = activeField;
    const el = fields.current[key];
    const value = email?.[key] ?? '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setEmail(key, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      const target = fields.current[key];
      if (!target) return;
      target.focus();
      target.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const fieldProps = (key) => ({
    ref: (el) => { fields.current[key] = el; },
    value: email?.[key] ?? '',
    maxLength: TEXT_LIMITS[key].input,
    onFocus: () => setActiveField(key),
    onChange: (e) => setEmail(key, e.target.value),
  });

  const labelRow = (id, label, key) => (
    <div className="flex items-end justify-between gap-3 mb-1">
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">{label}</label>
      <Counter value={email?.[key]} max={TEXT_LIMITS[key].input} />
    </div>
  );

  return (
    <Card className="p-card">
      <CardHeading
        className="mb-5"
        tone="lilac"
        icon={(
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )}
        title="Email de la photo"
        description="Envoyé par la borne à l'invité qui saisit son adresse. Le client ne voit pas ces réglages."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="email-sender-name" className="block text-xs font-medium text-muted-foreground mb-1">Nom de l'expéditeur</label>
              <Input id="email-sender-name" type="text" value={email?.sender_name ?? ''} onChange={e => setEmail('sender_name', e.target.value)}
                placeholder={companyName} />
            </div>
            <div>
              <label htmlFor="email-sender-email" className="block text-xs font-medium text-muted-foreground mb-1">Email de l'expéditeur</label>
              <Input id="email-sender-email" type="email" value={email?.sender_email ?? ''} onChange={e => setEmail('sender_email', e.target.value)}
                placeholder="photos@exemple.fr" />
            </div>
          </div>
          <div>
            {labelRow('email-subject', 'Objet', 'subject')}
            <Input id="email-subject" type="text" {...fieldProps('subject')} placeholder="Vos photos — {event_name}" />
          </div>
          <div>
            {labelRow('email-title', 'Titre', 'title')}
            <Input id="email-title" type="text" {...fieldProps('title')} placeholder="📷 {event_name}" />
          </div>
          <div>
            {labelRow('email-message', 'Message', 'message')}
            <Textarea id="email-message" {...fieldProps('message')} rows={7}
              placeholder={`Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\n${companyName}`}
              className="resize-y" />
          </div>
          <div>
            {labelRow('email-button', 'Libellé du bouton', 'button_label')}
            <Input id="email-button" type="text" {...fieldProps('button_label')} placeholder="Voir ma photo →" />
          </div>

          <div className="space-y-2 rounded-xl bg-muted px-3 py-3">
            <p className="text-xs text-muted-foreground">Variables : un clic l'insère dans le dernier champ choisi.</p>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map(v => (
                <button key={v.name} type="button" title={v.help}
                  onMouseDown={e => e.preventDefault()} onClick={() => insertVariable(v.name)}
                  className="rounded-sm border border-border bg-card px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {`{${v.name}}`}
                </button>
              ))}
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {VARIABLES.map(v => <li key={v.name}><code>{`{${v.name}}`}</code> : {v.help}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">
              Champ vide : texte par défaut. Message en texte brut, retours à la ligne gardés, <code>**gras**</code> permis. Un titre ou un bouton saisi vaut pour les photos et les animations.
            </p>
          </div>

          {warnings.length > 0 && (
            <Notice as="ul" tone="amber" className="space-y-1">
              {warnings.map(w => <li key={w}>{w}</li>)}
            </Notice>
          )}
        </div>

        <div className="min-w-0">
          <KioskEmailPreview eventId={eventId} draft={previewDraft} />
        </div>
      </div>
    </Card>
  );
}
