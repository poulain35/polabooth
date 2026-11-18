// Carte « Mise en route » en haut de la page Aujourd'hui (LAB-344, spec docs/specs/mise-en-route.md).
// Les étapes se cochent d'après les vraies données (setupSteps.js), jamais à la main. « Masquer la
// mise en route » écrit today_dismissals `setup:card` ; les étapes indispensables non faites passent
// alors dans « À faire ». Toutes faites : une seule ligne « Mise en route terminée » + « Fermer ».
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, CheckCircle2, EyeOff, ListChecks } from 'lucide-react';
import { Card, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Meter } from '../../../components/ui/meter';
import TestEmailButton from '../../../components/admin/TestEmailButton';

/**
 * Actions en plus du bouton principal, par id d'étape : composant rendu sous l'aide de l'étape, que
 * l'étape soit faite ou non (« Configuré » ne veut pas dire « fonctionne »), avec la prop `step`.
 * Ex. `emails: TestEmailButton` pour l'email de test.
 */
const STEP_ACTIONS = { emails: TestEmailButton };

function StepRow({ step, actions }) {
  const Extra = actions?.[step.id] ?? STEP_ACTIONS[step.id];
  return (
    <li className="flex items-start gap-3.5 py-3.5 sm:items-center">
      {step.done ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-state-green text-state-green-fg" aria-hidden="true">
          <Check className="size-4" />
        </span>
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground" aria-hidden="true">
          {step.n}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`break-words text-sm font-medium ${step.done ? 'text-muted-foreground' : 'text-foreground'}`}>
          <span className="sr-only">{step.done ? 'Fait : ' : 'À faire : '}</span>
          {step.label}
        </p>
        {step.help && <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{step.help}</p>}
        {Extra && <div className="mt-2"><Extra step={step} /></div>}
        {!step.done && (
          <Button asChild size="sm" variant="outline" className="mt-2.5 sm:hidden">
            <Link to={step.href}>{step.actionLabel}</Link>
          </Button>
        )}
      </div>
      {step.done ? (
        <Button asChild size="sm" variant="link" className="shrink-0 text-muted-foreground">
          <Link to={step.href} aria-label={`Voir : ${step.label}`}>Voir</Link>
        </Button>
      ) : (
        <Button asChild size="sm" variant="outline" className="hidden shrink-0 sm:inline-flex">
          <Link to={step.href}>{step.actionLabel}</Link>
        </Button>
      )}
    </li>
  );
}

/**
 * `setup` : résultat de buildSetupSteps ; `onHide()` : masque la carte (rejette en cas d'erreur) ;
 * `onShow()` : la réaffiche (bouton « Annuler » du toast). `actions` : `{ [idÉtape]: Composant }`,
 * actions en plus sur une étape (prioritaires sur STEP_ACTIONS).
 */
export default function SetupCard({ setup, onHide, onShow, actions }) {
  if (!setup?.steps?.length) return null;

  const hide = async ({ done = false } = {}) => {
    try {
      await onHide?.();
      if (done) return;
      toast.success('Mise en route masquée', {
        description: 'Les étapes indispensables restent dans « À faire ».',
        action: { label: 'Annuler', onClick: () => { onShow?.()?.catch?.(() => toast.error('Impossible de réafficher la mise en route.')); } },
      });
    } catch {
      toast.error('Impossible de masquer la mise en route. Réessayez.');
    }
  };

  if (setup.complete) {
    return (
      <section aria-label="Mise en route">
        <Card tone="mint" className="flex flex-col gap-3.5 p-card sm:flex-row sm:items-center">
          <IconCircle tone="white"><CheckCircle2 /></IconCircle>
          <p className="flex-1 text-sm font-medium">
            Mise en route terminée : vous pouvez prendre votre première commande
          </p>
          <Button size="sm" variant="strong" className="shrink-0 self-start sm:self-auto" onClick={() => hide({ done: true })}>
            Fermer
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="today-setup">
      <Card className="p-card">
        <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2">
          <IconCircle tone="lilac"><ListChecks /></IconCircle>
          <div className="min-w-0 flex-1 basis-[220px]">
            <CardTitle as="h2" id="today-setup">
              Mise en route · {setup.done} {setup.done > 1 ? 'étapes' : 'étape'} sur {setup.total}
            </CardTitle>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Ce qu’il reste à renseigner et à connecter avant votre première commande. Chaque étape se coche toute seule.
            </p>
          </div>
          <Button variant="link" size="sm" className="px-0 text-muted-foreground" onClick={() => hide()}>
            <EyeOff />Masquer la mise en route
          </Button>
        </div>
        <Meter tone="brand" value={setup.done} max={setup.total} aria-label="Avancement de la mise en route" className="mt-4" />
        <ol className="mt-2 divide-y">
          {setup.steps.map((step) => <StepRow key={step.id} step={step} actions={actions} />)}
        </ol>
      </Card>
    </section>
  );
}
