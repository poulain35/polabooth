// Composants communs aux onglets de la fiche de l'événement (LAB-337), au style de l'admin (LAB-366) :
// interrupteur, carte d'option, barre d'enregistrement, étapes numérotées, rond à cocher.
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { IconCircle } from '../../../components/ui/icon-circle';
import { StatusPill } from '../../../components/ui/status-pill';
import { Switch } from '../../../components/ui/switch';
import { cn } from '../../../lib/utils';

// ── Toggle ──────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange }) {
  return <Switch checked={checked} onCheckedChange={onChange} />;
}

// Titre de carte et encart d'état : briques communes à tout l'admin, reprises ici pour les onglets.
export { CardHeading, Notice } from '../../../components/admin/CardParts';

// ── Rond à cocher ────────────────────────────────────────────────────────────
// `state` : done (vert, coche), current (bleu, flèche) ou todo (gris, vide).
const CHECK_TONES = {
  done: 'bg-state-green text-state-green-fg',
  current: 'bg-primary text-primary-foreground',
  todo: 'bg-muted text-muted-foreground',
};

export function CheckMark({ state = 'todo' }) {
  return (
    <span aria-hidden="true"
      className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full', CHECK_TONES[state])}>
      {state === 'done' && <Check className="h-3.5 w-3.5" />}
      {state === 'current' && <ArrowRight className="h-3.5 w-3.5" />}
    </span>
  );
}

// ── Étapes numérotées ────────────────────────────────────────────────────────
// Ronds reliés par un trait : étape faite (fond fort et coche), en cours (bleu et numéro), à venir (gris et
// numéro). L'étape en cours est la première qui n'est pas faite. La barre défile à l'horizontale quand elle
// ne tient pas (téléphone) : la page ne déborde pas.
const STEP_TONES = {
  done: 'bg-strong text-strong-foreground',
  current: 'bg-primary text-primary-foreground',
  todo: 'bg-muted text-muted-foreground',
};

export function EventSteps({ steps, label = 'Étapes de l’événement' }) {
  if (!steps.length) return null;
  const current = steps.findIndex((step) => !step.done);
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <ol aria-label={label} className="flex w-max min-w-full pb-1 pt-1.5">
        {steps.map((step, i) => {
          const state = step.done ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li key={step.id} aria-current={i === current ? 'step' : undefined}
              className="relative flex min-w-[96px] flex-1 flex-col items-center gap-2 px-1 text-center text-[13px]">
              {i > 0 && (
                <span aria-hidden="true"
                  className={cn('absolute right-1/2 top-[15px] h-0.5 w-full', state === 'todo' ? 'bg-border' : 'bg-strong')} />
              )}
              <span className={cn('relative z-[1] flex h-8 w-8 items-center justify-center rounded-full font-medium ring-[5px] ring-card', STEP_TONES[state])}>
                {step.done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className={state === 'todo' ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                {step.label}
                <span className="sr-only"> {step.done ? '(fait)' : '(à faire)'}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Carte d'option à interrupteur ────────────────────────────────────────────
// Tuile à poser dans une carte. `tone` : pastel du rond d'icône ; option coupée : rond blanc.
export function FeatureCard({ iconPath, label, descOn, descOff, tone = 'sky', checked, onChange, locked }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted p-3.5">
      <IconCircle tone={checked ? tone : 'white'}>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </IconCircle>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight text-foreground">{label}</p>
        <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{checked ? descOn : (descOff ?? descOn)}</p>
      </div>
      {locked ? (
        <StatusPill tone="gray" dot={false}>Bientôt</StatusPill>
      ) : (
        <Toggle checked={checked} onChange={onChange} />
      )}
    </div>
  );
}

// ── Barre d'enregistrement des réglages de la borne ──────────────────────────
// `className` : remplace le filet et les marges (barre flottante de l'onglet Réglages de la borne).
export function KioskSaveBar({ saving, onSave, className = 'mt-2 border-t border-border py-3' }) {
  return (
    <div className={cn('flex items-center justify-end gap-3', className)}>
      <Button onClick={onSave} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
      </Button>
    </div>
  );
}
