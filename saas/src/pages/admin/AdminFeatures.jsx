import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import {
  FEATURES, disableWithDependents, enableWithDependencies, getFeature,
} from '../../features/catalog';
import { useFeatures } from '../../hooks/useFeatures';
import { INSTALLED_MODULES } from '../../features/modules';

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

const labelOf = (id) => getFeature(id)?.label ?? id;
const listOf = (ids) => ids.map(labelOf).join(', ');
const doneMessage = (feature, enable) => `Fonctionnalité ${enable ? 'activée' : 'désactivée'} : ${feature.label}`;

function alsoMessage(changed, enable) {
  const plural = changed.length > 1;
  const subject = plural ? 'Ces fonctionnalités seront' : 'Cette fonctionnalité sera';
  const verb = `${enable ? 'activée' : 'désactivée'}${plural ? 's' : ''}`;
  return `${subject} ${verb} aussi : ${listOf(changed)}.`;
}

function FeatureCard({ feature, enabled, disabled, onToggle }) {
  return (
    <Card className="p-4 sm:p-5 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900">{feature.label}</p>
        <p className="text-sm text-gray-500 mt-0.5">{feature.description}</p>
        {feature.dependsOn.length > 0 && (
          <p className="text-xs text-gray-400 mt-2">Nécessite : {listOf(feature.dependsOn)}</p>
        )}
      </div>
      {feature.core ? (
        <Badge variant="secondary" className="shrink-0 font-medium">Toujours actif</Badge>
      ) : (
        <Switch
          className="shrink-0 mt-0.5"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(feature, checked)}
          aria-label={`${enabled ? 'Désactiver' : 'Activer'} ${feature.label}`}
        />
      )}
    </Card>
  );
}

export default function AdminFeatures() {
  const { features, isEnabled, loading, error, save } = useFeatures();
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <Link to="/admin/settings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Paramètres
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Fonctionnalités</h1>
        <p className="text-gray-500 text-sm mt-1">Choisissez les fonctionnalités utilisées par votre entreprise.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-red-50 text-red-700 text-sm px-4 py-3">{error}</p>
      ) : (
        <div className="space-y-8">
          {GROUPS.map((group) => {
            const items = FEATURES.filter(group.filter);
            if (!items.length) return null;
            return (
              <section key={group.id}>
                <h2 className="font-semibold text-gray-800">{group.title}</h2>
                <p className="text-sm text-gray-500 mt-0.5 mb-3">{group.help}</p>
                <div className="space-y-2">
                  {items.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      enabled={isEnabled(feature.id)}
                      disabled={saving}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </section>
            );
          })}
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
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {confirm.enable ? 'Activer' : 'Désactiver'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
