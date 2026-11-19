// Onglet Versions de la page Bornes (/admin/bornes?tab=versions, LAB-338) : version installée sur
// chaque borne, demande de mise à jour (LAB-200 : uniquement sur demande d'ici) et, pour le
// super-admin, publication des versions. Déplacé de l'onglet État sans changer les appels.
import { useEffect, useState } from 'react';
import { Camera, Check, Copy, Download, Trash2 } from 'lucide-react';
import { supabase, fetchLicenses, fetchKioskReleases, uploadKioskRelease, deleteKioskRelease,
  requestKioskUpdate, isAppAdmin, fetchKioskAccounts } from '../../../lib/supabase';
import { compareVersions, kioskInstallerAddress, kioskUpdateStatus, latestRelease } from '../../../lib/kioskUpdate';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { Card, CardTitle } from '../../../components/ui/card';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Meter } from '../../../components/ui/meter';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusPill } from '../../../components/ui/status-pill';
import { toast } from 'sonner';
import { formatDateTime } from '../../../lib/dates';
import { kioskName } from '../../../lib/kioskLogs';
import { useCopy } from '../../../hooks/useCopy';

// ── Mise à jour de la borne (LAB-200 : uniquement sur demande d'ici) ─────────
function UpdateStatusLine({ status }) {
  if (status.state === 'none') {
    return <p className="mt-2 text-[13px] text-muted-foreground">Aucune demande : la borne ne se met jamais à jour d'elle-même.</p>;
  }
  return (
    <p className="mt-2 text-[13px] text-muted-foreground">
      v{status.version} demandée le {formatDateTime(status.requestedAt)}
      {status.state === 'requested' && <>{' · '}<span className="text-state-amber-fg">en attente de la borne</span></>}
      {status.receivedAt && <>{' · '}reçue par la borne le {formatDateTime(status.receivedAt)}</>}
      {status.state === 'received' && (
        <>{' · '}<span className="text-state-amber-fg">installation dès qu'aucune séance invité n'est en cours</span></>
      )}
      {status.state === 'installed' && <>{' · '}<span className="text-state-green-fg">installée</span></>}
      {status.state === 'failed' && (
        <>
          {' · '}
          <span className="text-destructive">
            échec le {formatDateTime(status.failedAt)}{status.error ? ` : ${status.error}` : ''}
          </span>
        </>
      )}
    </p>
  );
}

function KioskUpdate({ lic, releases, onUpdateChange }) {
  const [choice, setChoice] = useState('');
  const [busy,   setBusy]   = useState(false);
  const latest  = latestRelease(releases);
  const sorted  = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  // Par défaut, la dernière version publiée.
  const version = releases.some(r => r.version === choice) ? choice : (latest?.version ?? '');
  const alreadyInstalled = !!lic.app_version && compareVersions(lic.app_version, version) === 0;

  async function request() {
    const name = kioskName(lic);
    if (!confirm(`Mettre à jour « ${name} » en version ${version} ?\nLa borne l'installera dès qu'aucune séance invité n'est en cours.`)) return;
    setBusy(true);
    try {
      onUpdateChange(lic.id, await requestKioskUpdate(lic.id, version));
      toast.success('Mise à jour demandée : la borne la recevra à sa prochaine connexion');
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t pt-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Mise à jour</p>
      {releases.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Aucune version publiée.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={version} onValueChange={setChoice}>
            <SelectTrigger className="w-auto min-w-36 font-mono" aria-label="Version à installer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sorted.map(r => (
                <SelectItem key={r.id} value={r.version}>
                  v{r.version}{r.version === latest?.version ? ' (dernière)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={request} disabled={!version || alreadyInstalled || busy}
            title={alreadyInstalled ? 'Version déjà installée sur cette borne' : undefined}>
            {busy ? 'Envoi…' : 'Mettre à jour'}
          </Button>
        </div>
      )}
      <UpdateStatusLine status={kioskUpdateStatus(lic)} />
    </div>
  );
}

// ── Nouvelle borne : adresse courte de l'installeur ──────────────────────────

const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin;

/** Adresse courte et publique (/installer-borne) qui télécharge toujours la dernière version. */
function NewKioskCard({ latestVersion }) {
  const { copied, copy } = useCopy();
  const address = kioskInstallerAddress(APP_URL);
  return (
    <Card className="p-card">
      <CardTitle as="h2">Installer une nouvelle borne</CardTitle>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Sur le PC de la borne, ouvrez le navigateur et tapez cette adresse : la dernière version
        (v{latestVersion}) se télécharge, sans connexion. L'adresse ne change pas d'une version à l'autre.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-soft px-3 py-2">
        <a href={address} target="_blank" rel="noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-sm text-foreground hover:underline">
          {address.replace(/^https?:\/\//, '')}
        </a>
        <Button type="button" variant="ghost" size="icon-sm"
          onClick={async () => { if (!(await copy(address, 'installer'))) toast.error('Copie impossible'); }}
          title={copied === 'installer' ? 'Adresse copiée' : "Copier l'adresse"}
          aria-label="Copier l'adresse de l'installeur">
          {copied === 'installer' ? <Check /> : <Copy />}
        </Button>
      </div>
    </Card>
  );
}

// ── Versions kiosk (déploiement, super-admin seulement) ──────────────────────

function ReleasesPanel({ releases, loading, onChanged }) {
  const [version,  setVersion]  = useState('');
  const [notes,    setNotes]    = useState('');
  const [file,     setFile]     = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState(null);
  const { copied, copy } = useCopy();

  async function handlePublish(e) {
    e.preventDefault();
    if (!version.trim() || !file) return;
    setBusy(true);
    setProgress(null);
    try {
      await uploadKioskRelease({ version: version.trim(), notes: notes.trim() || null, file, onProgress: setProgress });
      setVersion(''); setNotes(''); setFile(null);
      toast.success('Version publiée !');
      await onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); setProgress(null); }
  }

  async function handleDelete(rel) {
    if (!confirm(`Supprimer la version ${rel.version} ?\nLes demandes de mise à jour vers cette version seront annulées.`)) return;
    try { await deleteKioskRelease(rel.id); await onChanged(); }
    catch (err) { toast.error(err.message); }
  }

  return (
    <Card className="p-card">
      <CardTitle as="h2">Versions de la borne</CardTitle>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Publiez une version, puis demandez-la borne par borne avec « Mettre à jour » sur chaque PC.
        Une borne ne se met jamais à jour d'elle-même. Pour revenir en arrière, demandez une version antérieure.
        Une version précise pour une borne : téléchargez son installeur, ou copiez son lien.
      </p>

      {/* Publier une version */}
      <form onSubmit={handlePublish} className="mt-4 grid grid-cols-1 gap-4 rounded-xl bg-soft p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="release-version">Version * (ex : 1.1.0)</Label>
            <Input id="release-version" type="text" value={version} onChange={e => setVersion(e.target.value)} placeholder="1.1.0"
              className="font-mono" />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="release-file">Installeur (.exe) *</Label>
            <input id="release-file" type="file" accept=".exe" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-md text-[13px] text-muted-foreground file:mr-3 file:h-[var(--control-sm)] file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:text-[13px] file:font-medium file:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-notes">Notes de version (optionnel)</Label>
          <Textarea id="release-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Corrections, nouveautés…"
            className="min-h-0 resize-none" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!version.trim() || !file || busy}>
            {busy ? (progress === null ? 'Préparation…' : `Envoi… ${progress} %`) : 'Publier la version'}
          </Button>
          {/* Avancement d'un envoi : même jauge que le reste de l'admin, annoncée comme une barre de progression. */}
          {busy && progress !== null && (
            <Meter role="progressbar" tone="brand" value={progress} max={100} aria-label="Envoi de l'installeur" className="min-w-24 flex-1" />
          )}
        </div>
      </form>

      {/* Liste des versions */}
      {loading ? (
        <div className="mt-4 space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : releases.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Aucune version publiée.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {releases.map(rel => (
            <li key={rel.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-sm font-medium text-foreground">v{rel.version}</span>
                {rel.notes && <p className="mt-0.5 whitespace-pre-line break-words text-[13px] text-muted-foreground">{rel.notes}</p>}
                {rel.sha256 && (
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={`SHA-256 : ${rel.sha256}`}>
                    SHA-256 {rel.sha256.slice(0, 16)}…
                  </p>
                )}
              </div>
              {rel.exe_url && (
                <>
                  <Button asChild variant="outline" size="sm">
                    <a href={rel.exe_url} download={`setup-polakiosk-${rel.version}.exe`}
                      aria-label={`Télécharger l'installeur de la version ${rel.version}`}>
                      <Download /><span className="hidden sm:inline">Télécharger</span>
                    </a>
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm"
                    onClick={async () => { if (!(await copy(rel.exe_url, rel.id))) toast.error('Copie impossible'); }}
                    title={copied === rel.id ? 'Lien copié' : "Copier le lien de l'installeur"}
                    aria-label={`Copier le lien de l'installeur de la version ${rel.version}`}>
                    {copied === rel.id ? <Check /> : <Copy />}
                  </Button>
                </>
              )}
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleDelete(rel)} title="Supprimer"
                aria-label={`Supprimer la version ${rel.version}`}
                className="text-muted-foreground hover:bg-state-red hover:text-state-red-fg">
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Version installée sur la borne, comparée à la dernière version publiée. */
function InstalledVersion({ lic, latestVersion }) {
  const installed = lic.app_version;
  if (!installed) return <StatusPill tone="gray" dot={false}>Version inconnue</StatusPill>;
  const upToDate = latestVersion && compareVersions(installed, latestVersion) >= 0;
  const outdated = latestVersion && !upToDate;
  return (
    <StatusPill
      tone={upToDate ? 'green' : outdated ? 'amber' : 'gray'}
      title={outdated ? `Dernière version publiée : ${latestVersion}` : upToDate ? 'À jour' : undefined}
    >
      v{installed}
      {upToDate && ' ✓'}
      {outdated && ` → ${latestVersion}`}
    </StatusPill>
  );
}

export default function VersionsTab() {
  const [licenses,   setLicenses]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [releases,   setReleases]   = useState([]);
  const [relLoading, setRelLoading] = useState(true);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [accounts,   setAccounts]   = useState([]);

  async function load() {
    try { setLicenses(await fetchLicenses()); }
    catch { /* non bloquant */ }
    finally { setLoading(false); }
  }

  async function loadReleases() {
    try { setReleases(await fetchKioskReleases()); }
    catch { /* non bloquant */ }
    finally { setRelLoading(false); }
  }

  useEffect(() => {
    load();
    loadReleases();
    isAppAdmin().then(setSuperAdmin).catch(() => {});
    fetchKioskAccounts().then(({ accounts: list }) => setAccounts(list)).catch(() => {});

    // Temps réel : la borne écrit sa version et l'avancement de la mise à jour.
    const channel = supabase
      .channel(`kiosk-licenses-versions-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_licenses' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function handleUpdateChange(id, update) {
    if (update) setLicenses(l => l.map(x => x.id === id ? { ...x, ...update } : x));
  }

  const latestVersion = latestRelease(releases)?.version ?? null;
  const accountName = (lic) => accounts.find(o => o.id === lic.org_id)?.name || 'Autre compte';

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Une borne ne se met jamais à jour d'elle-même : choisissez la version à installer, borne par borne.
        {latestVersion && <> Dernière version publiée : <span className="font-mono font-medium text-foreground">v{latestVersion}</span>.</>}
      </p>

      {latestVersion && <NewKioskCard latestVersion={latestVersion} />}

      {/* Versions de la borne (publication, super-admin) */}
      {superAdmin && <ReleasesPanel releases={releases} loading={relLoading} onChanged={loadReleases} />}

      <section aria-labelledby="versions-bornes">
        <CardTitle as="h2" id="versions-bornes" className="mb-3">Bornes</CardTitle>
        {loading ? (
          <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32 rounded-card" />)}</div>
        ) : licenses.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-card py-10 text-center">
            <IconCircle tone="muted"><Camera /></IconCircle>
            <p className="text-sm text-muted-foreground">Aucune borne associée.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {licenses.map(lic => (
              <Card key={lic.id} className="flex flex-col gap-4 p-card">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <CardTitle as="span">{kioskName(lic)}</CardTitle>
                  <InstalledVersion lic={lic} latestVersion={latestVersion} />
                  {superAdmin && <span className="text-[13px] text-muted-foreground">{accountName(lic)}</span>}
                </div>
                <KioskUpdate lic={lic} releases={releases} onUpdateChange={handleUpdateChange} />
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
