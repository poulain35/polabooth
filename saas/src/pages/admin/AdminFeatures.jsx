import { useState } from 'react';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { IconCircle } from '../../components/ui/icon-circle';
import { StatusPill } from '../../components/ui/status-pill';
import { Switch } from '../../components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import {
  FEATURES, disableWithDependents, enableWithDependencies, getFeature,
} from '../../features/catalog';
import { useFeatures } from '../../hooks/useFeatures';
import { INSTALLED_MODULES } from '../../features/modules';
import { moduleRequestMailto, onDemandModules } from '../../features/onDemandModules';
import { keptFeatureChoices } from '../../lib/setupSteps';
import { Spinner } from '../../components/ui/spinner';
import { Notice } from '../../components/admin/CardParts';

const GROUPS = [
  {
    id: 'core',
    title: 'Socle',
    help: 'Toujours actif : c\'est la base du logiciel.',
    filter: (f) => f.core,
  },
  {
    id: 'open',
    title: 'Fonctionnalités',
    help: 'Activez seulement ce que vous proposez à vos clients. Une fonctionnalité désactivée disparaît de l\'administration et de ses pages publiques.',
    filter: (f) => !f.core && f.visibility === 'open',
  },
  {
    id: 'private',
    title: 'Options privées',
    help: 'Modules propres à votre activité, absents de la version ouverte.',
    // Seulement les modules installés (src/modules/) : rien dans la version ouverte.
    filter: (f) => !f.core && f.visibility === 'private' && INSTALLED_MODULES.has(f.id),
  },
];

// Modules privés absents de cette installation (LAB-422) : seul endroit où ils apparaissent.
const ON_DEMAND = onDemandModules(INSTALLED_MODULES);

const labelOf = (id) => getFeature(id)?.label ?? id;
const listOf = (ids) => ids.map(labelOf).join(', ');
const doneMessage = (feature, enable) => `Fonctionnalité ${enable ? 'activée' : 'désactivée'} : ${feature.label}`;

function alsoMessage(changed, enable) {
  const several = changed.length > 1;
  const subject = several ? 'Ces fonctionnalités seront' : 'Cette fonctionnalité sera';
  const verb = `${enable ? 'activée' : 'désactivée'}${several ? 's' : ''}`;
  return `${subject} ${verb} aussi : ${listOf(changed)}.`;
}

function KeepChoices({ saving, onKeep }) {
  return (
    <Card tone="sky" className="flex flex-col gap-3 p-card sm:flex-row sm:items-center">
      <IconCircle tone="white" className="hidden sm:inline-flex"><CheckCircle2 /></IconCircle>
      <div className="min-w-0 flex-1">
        <CardTitle as="p">Ces choix vous conviennent ?</CardTitle>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Les fonctionnalités ci-dessous sont celles proposées par défaut. Gardez-les telles quelles ou changez-les une à une.
        </p>
      </div>
      <Button className="shrink-0 self-start sm:self-auto" onClick={onKeep} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Garder ces choix
      </Button>
    </Card>
  );
}

/** Une fonctionnalité : tuile dans la carte de son groupe. */
function FeatureRow({ feature, enabled, disabled, onToggle }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{feature.label}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{feature.description}</p>
        {feature.dependsOn.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Nécessite : {listOf(feature.dependsOn)}</p>
        )}
      </div>
      {feature.core ? (
        <StatusPill tone="green">Toujours actif</StatusPill>
      ) : (
        <Switch
          className="mt-0.5 shrink-0"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(feature, checked)}
          aria-label={`${enabled ? 'Désactiver' : 'Activer'} ${feature.label}`}
        />
      )}
    </div>
  );
}

/** Un module sur demande : libellé, description et lien pour en parler, sans interrupteur. */
function OnDemandRow({ feature }) {
  const href = moduleRequestMailto(feature, {
    origin: window.location.origin, version: import.meta.env.VITE_APP_VERSION,
  });
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted p-3.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{feature.label}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{feature.description}</p>
      </div>
      <a
        href={href}
        className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-primary-ink hover:underline"
      >
        <Mail className="size-3.5" aria-hidden="true" />
        Contactez-moi pour en parler
      </a>
    </div>
  );
}

export default function AdminFeatures() {
  const { orgId, features, isEnabled, loading, error, save } = useFeatures();
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { feature, enable, next, changed }

  async function apply(next, message) {
    setSaving(true);
    try {
      await save(next);
      toast.success(message);
      setConfirm(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(feature, enable) {
    const { features: next, changed } = enable
      ? enableWithDependencies(features, feature.id)
      : disableWithDependents(features, feature.id);
    if (changed.length) {
      setConfirm({ feature, enable, next, changed });
      return;
    }
    apply(next, doneMessage(feature, enable));
  }

  return (
    // Section Fonctionnalités de la page Réglages (/admin/reglages#fonctionnalites, LAB-335).
    <div>
      <p className="mb-4 text-[13px] text-muted-foreground">Choisissez les fonctionnalités utilisées par votre entreprise.</p>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <Notice tone="red" role="alert">{error}</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          {orgId && Object.keys(features ?? {}).length === 0 && (
            <KeepChoices saving={saving} onKeep={() => apply(keptFeatureChoices(features), 'Choix des fonctionnalités enregistrés')} />
          )}
          {GROUPS.map((group) => {
            const items = FEATURES.filter(group.filter);
            if (!items.length) return null;
            return (
              <Card key={group.id} className="p-card">
                <section aria-labelledby={`features-${group.id}`}>
                  <CardTitle as="h2" id={`features-${group.id}`}>{group.title}</CardTitle>
                  <p className="mb-4 mt-0.5 text-[13px] text-muted-foreground">{group.help}</p>
                  <div className="flex flex-col gap-2">
                    {items.map((feature) => (
                      <FeatureRow
                        key={feature.id}
                        feature={feature}
                        enabled={isEnabled(feature.id)}
                        disabled={saving}
                        onToggle={handleToggle}
                      />
                    ))}
                  </div>
                </section>
              </Card>
            );
          })}
          {ON_DEMAND.length > 0 && (
            <Card className="p-card">
              <section aria-labelledby="features-on-demand">
                <CardTitle as="h2" id="features-on-demand">Modules sur demande</CardTitle>
                <p className="mb-4 mt-0.5 text-[13px] text-muted-foreground">
                  Modules supplémentaires absents de cette installation. Écrivez-moi pour en parler.
                </p>
                <div className="flex flex-col gap-2">
                  {ON_DEMAND.map((feature) => <OnDemandRow key={feature.id} feature={feature} />)}
                </div>
              </section>
            </Card>
          )}
        </div>
      )}

      {confirm && (
        <Dialog open onOpenChange={(open) => { if (!open && !saving) setConfirm(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {confirm.enable ? 'Activer' : 'Désactiver'} « {confirm.feature.label} » ?
              </DialogTitle>
              <DialogDescription>
                {alsoMessage(confirm.changed, confirm.enable)}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-3 sm:gap-3">
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={saving}>Annuler</Button>
              <Button
                onClick={() => apply(confirm.next, doneMessage(confirm.feature, confirm.enable))}
                disabled={saving}
              >
                {saving && <Loader2 className="animate-spin" />}
                {confirm.enable ? 'Activer' : 'Désactiver'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
