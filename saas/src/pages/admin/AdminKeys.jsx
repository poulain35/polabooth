import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
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

const SOURCE_LABELS = {
  vault: 'clé saisie ici',
  env: 'variable d\'environnement du serveur',
  none: 'aucune clé',
};

const ADMIN_ONLY = 'Réservé aux administrateurs de l\'application.';

function errorMessage(e) {
  return e?.code === '42501' ? ADMIN_ONLY : (e?.message || 'Erreur inattendue');
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '';
}

function KeyStatus({ stored }) {
  if (!stored) {
    return (
      <p className="text-sm text-gray-500">
        Non saisie : la variable d'environnement du serveur est utilisée si elle existe.
      </p>
    );
  }
  const last4 = stored.last4 ? ` ••••${stored.last4}` : '';
  return (
    <p className="text-sm text-emerald-700">
      Configurée{last4} (le {formatDate(stored.updated_at)})
    </p>
  );
}

function KeyCard({ serviceKey, stored, busy, testResult, onEdit, onDelete, onTest }) {
  const testing = busy === 'test';
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex-1 min-w-[12rem]">
          <p className="font-medium text-gray-900">{serviceKey.label}</p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{serviceKey.name}</p>
          <p className="text-sm text-gray-500 mt-1">{serviceKey.help}</p>
          <div className="mt-2"><KeyStatus stored={stored} /></div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
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
              {testing && <Loader2 className="w-4 h-4 animate-spin" />}
              Tester
            </Button>
          )}
        </div>
      </div>
      {testResult && (
        <p
          className={`mt-3 rounded-lg text-sm px-3 py-2 ${testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}
          role="status"
        >
          {testResult.message}
          {testResult.source && (
            <span className="block text-xs opacity-80 mt-0.5">Source : {SOURCE_LABELS[testResult.source] ?? testResult.source}</span>
          )}
        </p>
      )}
    </Card>
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
    <Card className="p-4 sm:p-5">
      <Label htmlFor={id} className="font-medium text-gray-900">{label}</Label>
      {help && <p className="text-sm text-gray-500 mt-1">{help}</p>}
      <div className="flex gap-2 mt-3">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || saving}
          spellCheck={false}
        />
        <Button size="sm" className="h-10 shrink-0" onClick={save} disabled={disabled || saving || !dirty}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Enregistrer
        </Button>
      </div>
      {children?.(setDraft)}
    </Card>
  );
}

function AssistantModelHelp({ pick }) {
  return (
    <div className="mt-4">
      <p className="text-sm text-gray-600">Modèles conseillés (prix par million de jetons, entrée / sortie) :</p>
      <ul className="mt-2 space-y-1.5">
        {ASSISTANT_MODELS.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => pick(m.id)}
              className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium text-gray-900 text-sm">{m.label}</span>
                <span className="text-sm text-gray-600">{m.price}</span>
              </span>
              <span className="block text-xs text-gray-500 font-mono">{m.id}</span>
              <span className="block text-xs text-gray-500 mt-0.5">{m.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-400 mt-2">
        Prix indicatifs relevés le {PRICES_CHECKED_ON}, à vérifier chez le fournisseur.
      </p>
      <p className="text-xs mt-1 flex flex-wrap gap-x-4">
        <a href={ASSISTANT_MODEL_LINKS.models} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 underline">
          Liste des modèles <ExternalLink className="w-3 h-3" />
        </a>
        <a href={ASSISTANT_MODEL_LINKS.pricing} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 underline">
          Tarifs <ExternalLink className="w-3 h-3" />
        </a>
      </p>
    </div>
  );
}

function VisualModelsList() {
  return (
    <Card className="p-4 sm:p-5">
      <p className="font-medium text-gray-900">Modèles utilisés sur Replicate</p>
      <p className="text-sm text-gray-500 mt-1">
        Pour information : le modèle de fond se choisit dans l'éditeur. Les tarifs sont sur la page de chaque modèle.
      </p>
      <ul className="mt-3 divide-y divide-gray-100">
        {VISUAL_MODELS.map((m) => (
          <li key={m.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm">
              <span className="font-medium text-gray-900">{m.label}</span>
              <span className="text-gray-500"> · {m.use}</span>
            </span>
            <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 underline">
              voir la page du modèle <ExternalLink className="w-3 h-3" />
            </a>
          </li>
        ))}
      </ul>
    </Card>
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
    return null;
  }

  const pageLoading = loading || featuresLoading;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <Link to="/admin/settings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Paramètres
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clés des services</h1>
        <p className="text-gray-500 text-sm mt-1">
          Les clés sont chiffrées sur le serveur : une fois saisies, elles ne sont plus jamais affichées, seulement leurs 4 derniers caractères.
        </p>
      </div>

      {pageLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-red-50 text-red-700 text-sm px-4 py-3">{error}</p>
      ) : (
        <div className="space-y-8">
          {keyGroups({ installed: isInstalled, emailProvider: EMAIL_PROVIDER }).map((group) => {
            const feature = group.feature ? getFeature(group.feature) : null;
            const enabled = !feature || isEnabled(feature.id);
            return (
              <section key={group.feature ?? 'core'} className={enabled ? '' : 'opacity-60'}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-gray-800">{group.title ?? feature?.label}</h2>
                  {!enabled && <Badge variant="secondary" className="font-medium">fonctionnalité désactivée</Badge>}
                </div>
                <p className="text-sm text-gray-500 mt-0.5 mb-3">{group.help ?? feature?.description}</p>
                <div className="space-y-2">
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
              </section>
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
              <div className="py-4">
                <Label htmlFor="service-key-value">Valeur</Label>
                <Input
                  id="service-key-value"
                  type="password"
                  className="mt-1.5"
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
                  {busy[editing.name] && <Loader2 className="w-4 h-4 animate-spin" />}
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
                {busy[deleting.name] && <Loader2 className="w-4 h-4 animate-spin" />}
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
