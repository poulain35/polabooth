import { Suspense, useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { StatusPill } from '../../components/ui/status-pill';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import TestEmailButton from '../../components/admin/TestEmailButton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import { getFeature } from '../../features/catalog';
import { keyGroups, moduleSettingFields } from '../../features/serviceKeys';
import { EMAIL_PROVIDER } from '../../lib/emailTracking';
import { moduleSlot } from '../../features/modules';
import { useFeatures } from '../../hooks/useFeatures';
import {
  deleteServiceKey, getServiceSettings, listServiceKeys, saveServiceSettings, setServiceKey, testServiceKey,
} from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { formatDate } from '../../lib/dates';
import { Spinner } from '../../components/ui/spinner';
import { Notice } from '../../components/admin/CardParts';
import { SETTING_TILE as TILE, SettingField } from '../../components/admin/ServiceSettingField';

const SOURCE_LABELS = {
  vault: 'clé saisie ici',
  env: 'variable d\'environnement du serveur',
  none: 'aucune clé',
};

// Compléments des modules privés dans la carte de leur service (réglages, aide au choix des modèles).
// Affichés même si la fonctionnalité est désactivée, comme les clés (pas de <ModuleSlot>).
const MODULE_SETTINGS = moduleSlot('settings.services');

const ADMIN_ONLY = 'Réservé aux administrateurs de l\'application.';

function errorMessage(e) {
  return e?.code === '42501' ? ADMIN_ONLY : (e?.message || 'Erreur inattendue');
}

function KeyStatus({ stored }) {
  if (!stored) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Non saisie : la variable d'environnement du serveur est utilisée si elle existe.
      </p>
    );
  }
  const last4 = stored.last4 ? ` ••••${stored.last4}` : '';
  return (
    <StatusPill tone="green">
      Configurée{last4} (le {formatDate(stored.updated_at)})
    </StatusPill>
  );
}

function KeyCard({ serviceKey, stored, busy, testResult, onEdit, onDelete, onTest }) {
  const testing = busy === 'test';
  return (
    <div className={TILE}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-foreground">{serviceKey.label}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{serviceKey.name}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{serviceKey.help}</p>
          <div className="mt-2"><KeyStatus stored={stored} /></div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(serviceKey)} disabled={!!busy}>
            {stored ? 'Remplacer' : 'Saisir'}
          </Button>
          {stored && (
            <Button size="sm" variant="outline" onClick={() => onDelete(serviceKey)} disabled={!!busy}>
              Supprimer
            </Button>
          )}
          {serviceKey.testable && (
            <Button size="sm" variant="outline" onClick={() => onTest(serviceKey)} disabled={!!busy}>
              {testing && <Loader2 className="animate-spin" />}
              Tester
            </Button>
          )}
        </div>
      </div>
      {testResult && (
        <Notice tone={testResult.ok ? 'green' : 'red'} className="mt-3" role="status">
          {testResult.message}
          {testResult.source && (
            <span className="mt-0.5 block text-xs">Source : {SOURCE_LABELS[testResult.source] ?? testResult.source}</span>
          )}
        </Notice>
      )}
    </div>
  );
}

function TestEmailCard() {
  return (
    <div className={TILE}>
      <p className="text-sm font-medium text-foreground">Email de test</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Vérifie que les emails partent vraiment : un email est envoyé à l'adresse de votre compte, avec l'expéditeur de votre entreprise.
      </p>
      <TestEmailButton className="mt-3" />
    </div>
  );
}

export default function AdminKeys() {
  const { isEnabled, isInstalled, loading: featuresLoading } = useFeatures();
  const [stored, setStored] = useState({}); // name → { last4, updated_at }
  const [settings, setSettings] = useState({ orgId: null, settings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // name → 'save' | 'delete' | 'test'
  const [tests, setTests] = useState({}); // name → { ok, source, message }
  const [editing, setEditing] = useState(null); // serviceKey
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState(null); // serviceKey

  const reloadKeys = useCallback(async () => {
    const rows = await listServiceKeys();
    setStored(Object.fromEntries(rows.map((r) => [r.name, r])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [, s] = await Promise.all([reloadKeys(), getServiceSettings()]);
        if (!cancelled) setSettings(s);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKeys]);

  const setKeyBusy = (name, value) => setBusy((b) => ({ ...b, [name]: value }));
  const clearTest = (name) => setTests((t) => ({ ...t, [name]: undefined }));

  function openEdit(serviceKey) {
    setDraft('');
    setEditing(serviceKey);
  }

  function closeEdit() {
    setDraft('');
    setEditing(null);
  }

  async function saveKey() {
    const { name, label } = editing;
    setKeyBusy(name, 'save');
    try {
      await setServiceKey(name, draft.trim());
      await reloadKeys();
      clearTest(name);
      toast.success(`Clé enregistrée : ${label}`);
      closeEdit();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setKeyBusy(name, undefined);
    }
  }

  async function confirmDelete() {
    const { name, label } = deleting;
    setKeyBusy(name, 'delete');
    try {
      await deleteServiceKey(name);
      await reloadKeys();
      clearTest(name);
      toast.success(`Clé supprimée : ${label}`);
      setDeleting(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setKeyBusy(name, undefined);
    }
  }

  async function runTest(serviceKey) {
    const { name } = serviceKey;
    setKeyBusy(name, 'test');
    clearTest(name);
    try {
      const result = await testServiceKey(name);
      setTests((t) => ({ ...t, [name]: result }));
    } catch (e) {
      setTests((t) => ({ ...t, [name]: { ok: false, message: errorMessage(e) } }));
    } finally {
      setKeyBusy(name, undefined);
    }
  }

  async function saveSetting(key, value) {
    try {
      const next = await saveServiceSettings(settings.orgId, { [key]: value });
      setSettings((s) => ({ ...s, settings: next }));
      toast.success('Réglage enregistré');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function renderSettings(feature) {
    // Réglages déclarés par les modules privés avec un libellé (agenda Google, LAB-421).
    const fields = moduleSettingFields(feature);
    if (fields.length) {
      return fields.map((field) => (
        <SettingField
          key={field.id}
          id={field.id}
          label={field.label}
          help={field.help}
          placeholder={field.placeholder}
          value={settings.settings[field.id]}
          onSave={(v) => saveSetting(field.id, v)}
          disabled={!settings.orgId}
        />
      ));
    }
    if (feature === null) return <TestEmailCard />;
    const extras = MODULE_SETTINGS.filter((item) => item.feature === feature);
    if (!extras.length) return null;
    return (
      <Suspense fallback={<Spinner />}>
        {extras.map(({ Component }, i) => (
          <Component key={i} settings={settings.settings} onSave={saveSetting} disabled={!settings.orgId} />
        ))}
      </Suspense>
    );
  }

  const pageLoading = loading || featuresLoading;

  return (
    // Section Services connectés de la page Réglages (/admin/reglages#services, LAB-335).
    <div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Les clés d’accès des services sont chiffrées sur le serveur : une fois saisies, elles ne sont plus jamais affichées, seulement leurs 4 derniers caractères.
      </p>

      {pageLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <Notice tone="red" role="alert">{error}</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          {keyGroups({ installed: isInstalled, emailProvider: EMAIL_PROVIDER }).map((group) => {
            const feature = group.feature ? getFeature(group.feature) : null;
            const enabled = !feature || isEnabled(feature.id);
            return (
              <Card key={group.feature ?? 'core'} className={cn('p-card', !enabled && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle as="h2">{group.title ?? feature?.label}</CardTitle>
                  {!enabled && <StatusPill tone="gray" dot={false}>fonctionnalité désactivée</StatusPill>}
                </div>
                <p className="mb-4 mt-0.5 text-[13px] text-muted-foreground">{group.help ?? feature?.description}</p>
                <div className="flex flex-col gap-2">
                  {group.keys.map((k) => (
                    <KeyCard
                      key={k.name}
                      serviceKey={k}
                      stored={stored[k.name]}
                      busy={busy[k.name]}
                      testResult={tests[k.name]}
                      onEdit={openEdit}
                      onDelete={setDeleting}
                      onTest={runTest}
                    />
                  ))}
                  {renderSettings(group.feature)}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy[editing.name]) closeEdit(); }}>
          <DialogContent className="sm:max-w-md">
            <form
              onSubmit={(e) => { e.preventDefault(); if (draft.trim()) saveKey(); }}
              autoComplete="off"
            >
              <DialogHeader>
                <DialogTitle>{stored[editing.name] ? 'Remplacer' : 'Saisir'} : {editing.label}</DialogTitle>
                <DialogDescription>{editing.help}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5 py-4">
                <Label htmlFor="service-key-value">Valeur</Label>
                <Input
                  id="service-key-value"
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <DialogFooter className="gap-3 sm:gap-3">
                <Button type="button" variant="outline" onClick={closeEdit} disabled={!!busy[editing.name]}>Annuler</Button>
                <Button type="submit" disabled={!draft.trim() || !!busy[editing.name]}>
                  {busy[editing.name] && <Loader2 className="animate-spin" />}
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {deleting && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy[deleting.name]) setDeleting(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Supprimer « {deleting.label} » ?</DialogTitle>
              <DialogDescription>
                La clé saisie ici est effacée. Le serveur utilisera la variable d'environnement si elle existe, sinon le service cessera de fonctionner.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-3 sm:gap-3">
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={!!busy[deleting.name]}>Annuler</Button>
              <Button variant="destructive" onClick={confirmDelete} disabled={!!busy[deleting.name]}>
                {busy[deleting.name] && <Loader2 className="animate-spin" />}
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
