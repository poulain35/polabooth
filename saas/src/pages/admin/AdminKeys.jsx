import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
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
import { keyGroups } from '../../features/serviceKeys';
import { EMAIL_PROVIDER } from '../../lib/emailTracking';
import {
  ASSISTANT_MODELS, ASSISTANT_MODEL_LINKS, PRICES_CHECKED_ON, VISUAL_MODELS,
} from '../../features/aiModels';
import { useFeatures } from '../../hooks/useFeatures';
import {
  deleteServiceKey, getServiceSettings, listServiceKeys, saveServiceSettings, setServiceKey, testServiceKey,
} from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { formatDate } from '../../lib/dates';
import { Spinner } from '../../components/ui/spinner';
import { Notice } from '../../components/admin/CardParts';

const SOURCE_LABELS = {
  vault: 'clé saisie ici',
  env: 'variable d\'environnement du serveur',
  none: 'aucune clé',
};

// Tuile d'une clé ou d'un réglage, posée dans la carte de son service.
const TILE = 'rounded-xl bg-muted p-3.5';
const LINK = 'inline-flex items-center gap-1 rounded-sm text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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

function SettingField({ id, label, help, placeholder, value, onSave, disabled, children }) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const dirty = draft.trim() !== (value ?? '');

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={TILE}>
      <Label htmlFor={id} className="text-foreground">{label}</Label>
      {help && <p className="mt-1 text-[13px] text-muted-foreground">{help}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || saving}
          spellCheck={false}
          className="min-w-[10rem] flex-1"
        />
        <Button className="shrink-0" onClick={save} disabled={disabled || saving || !dirty}>
          {saving && <Loader2 className="animate-spin" />}
          Enregistrer
        </Button>
      </div>
      {children?.(setDraft)}
    </div>
  );
}

function AssistantModelHelp({ pick }) {
  return (
    <div className="mt-4">
      <p className="text-[13px] text-muted-foreground">Modèles conseillés (prix par million de jetons, entrée / sortie) :</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {ASSISTANT_MODELS.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => pick(m.id)}
              className="w-full rounded-xl bg-card px-3 py-2 text-left transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-foreground">{m.label}</span>
                <span className="text-[13px] text-muted-foreground">{m.price}</span>
              </span>
              <span className="block break-all font-mono text-xs text-muted-foreground">{m.id}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{m.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Prix indicatifs relevés le {PRICES_CHECKED_ON}, à vérifier chez le fournisseur.
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 text-xs">
        <a href={ASSISTANT_MODEL_LINKS.models} target="_blank" rel="noreferrer" className={LINK}>
          Liste des modèles <ExternalLink className="h-3 w-3" />
        </a>
        <a href={ASSISTANT_MODEL_LINKS.pricing} target="_blank" rel="noreferrer" className={LINK}>
          Tarifs <ExternalLink className="h-3 w-3" />
        </a>
      </p>
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

function VisualModelsList() {
  return (
    <div className={TILE}>
      <p className="text-sm font-medium text-foreground">Modèles utilisés sur Replicate</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Pour information : le modèle de fond se choisit dans l'éditeur. Les tarifs sont sur la page de chaque modèle.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {VISUAL_MODELS.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
            <span className="text-[13px]">
              <span className="font-medium text-foreground">{m.label}</span>
              <span className="text-muted-foreground"> · {m.use}</span>
            </span>
            <a href={m.url} target="_blank" rel="noreferrer" className={cn(LINK, 'text-xs')}>
              voir la page du modèle <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
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
    if (feature === 'assistant') {
      return (
        <SettingField
          id="assistant_model"
          label="Modèle de l'assistant"
          help="Identifiant exact du modèle Claude."
          placeholder="Vide : modèle par défaut du serveur"
          value={settings.settings.assistant_model}
          onSave={(v) => saveSetting('assistant_model', v)}
          disabled={!settings.orgId}
        >
          {(pick) => <AssistantModelHelp pick={pick} />}
        </SettingField>
      );
    }
    if (feature === 'google_calendar') {
      return (
        <SettingField
          id="google_calendar_id"
          label="Agenda Google"
          help="Identifiant de l'agenda à synchroniser (Paramètres de l'agenda, Intégrer l'agenda)."
          placeholder="Vide : variable d'environnement du serveur"
          value={settings.settings.google_calendar_id}
          onSave={(v) => saveSetting('google_calendar_id', v)}
          disabled={!settings.orgId}
        />
      );
    }
    if (feature === 'ai_visuals') return <VisualModelsList />;
    if (feature === null) return <TestEmailCard />;
    return null;
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
