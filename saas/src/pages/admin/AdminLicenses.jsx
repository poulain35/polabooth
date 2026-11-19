import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, ChevronDown, ChevronRight, Camera } from 'lucide-react';
import { supabase, fetchKioskMonitoring, updateLicense, deleteLicense,
  fetchKioskReleases, getPaperUsage,
  setKioskAdminPin, pushKioskAdminPin, retireLicense,
  isAppAdmin, fetchKioskAccounts, updateOrgKioskLimit, fetchPushableEvents } from '../../lib/supabase';
import { KioskEventPushSection } from '../../components/admin/KioskEventPush';
import { KioskCameraSection } from '../../components/admin/KioskCameraSection';
import { kioskName } from '../../lib/kioskLogs';
import { compareVersions, latestRelease } from '../../lib/kioskUpdate';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { Card, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { IconCircle } from '../../components/ui/icon-circle';
import { Meter } from '../../components/ui/meter';
import { StatusPill, statusPillVariants } from '../../components/ui/status-pill';
import { toast } from 'sonner';
import { CreateButton } from '../../components/admin/AdminPage';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import { formatDateTime, formatShortDate } from '../../lib/dates';
import { countLabel, plural } from '../../lib/format';

// LAB-243 : parc de bornes par compte. Le propriétaire voit et gère les bornes de son compte, le
// super-admin (app_admins) celles de tous les comptes. Une borne s'ajoute par /associer (QR code
// affiché par le kiosk) : plus de secret affiché ni d'identifiant machine à saisir ici.

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

// Tons des pastilles (StatusPill) : green = prêt / en ligne, amber = à surveiller, red = alerte, gray = neutre.
function onlineStatus(lastSeenAt) {
  if (!lastSeenAt) return { label: 'Jamais vu', tone: 'gray' };
  const min = (Date.now() - new Date(lastSeenAt).getTime()) / 60000;
  if (min < 5)  return { label: 'En ligne',   tone: 'green' };
  if (min < 30) return { label: 'Récent',     tone: 'amber' };
  return              { label: 'Hors ligne', tone: 'gray'  };
}

// Statut matériel imprimante remonté par le kiosk (kiosk_licenses.printer_status). Mêmes tons que la carte
// « Bornes » de la page Aujourd'hui : une imprimante qui ne peut pas imprimer est une alerte (rouge).
const PRINTER_STATUS = {
  ready:     { label: 'Imprimante prête',  tone: 'green' },
  offline:   { label: 'Impr. hors ligne',  tone: 'red'   },
  paper_out: { label: 'Plus de papier',    tone: 'red'   },
  paper_jam: { label: 'Bourrage papier',   tone: 'red'   },
  error:     { label: 'Erreur impr.',      tone: 'red'   },
  not_found: { label: 'Impr. introuvable', tone: 'red'   },
  unknown:   { label: 'Impr. inconnue',    tone: 'gray'  },
};

// État de l'appareil photo remonté par le kiosk (kiosk_licenses.camera_status, LAB-263).
// NULL = jamais dit : pas de pastille.
const CAMERA_STATUS = {
  ok:           { label: 'Appareil photo OK',  tone: 'green' },
  disconnected: { label: 'Appareil débranché', tone: 'red'   },
};

// Titre d'une rubrique dans la carte d'une borne.
const SECTION_LABEL = 'text-xs font-medium text-muted-foreground';
// Libellé d'une mesure (dernière connexion, événement actif, dernière photo).
const METRIC_LABEL = 'mb-1 text-xs text-muted-foreground';
// Action discrète en texte (Modifier, Rouleau rechargé…).
const TEXT_ACTION = 'rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// ── Stock papier (estimation par décompte des tirages) ───────────────────────
function PaperStock({ lic, used, onSave, onReset }) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(lic.paper_capacity ?? '');
  const cap = lic.paper_capacity;
  const remaining = cap ? Math.max(0, cap - used) : null;
  // Jauge : rouge quand il reste 10 % du rouleau, ambre à partir de 25 %.
  const low = cap && remaining <= cap * 0.1;
  const warn = cap && !low && remaining <= cap * 0.25;

  function save() { onSave(lic, val); if (val) setEditing(false); }

  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className={SECTION_LABEL}>Stock papier</p>
        {cap && !editing && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { setVal(cap); setEditing(true); }} className={`${TEXT_ACTION} text-muted-foreground hover:text-foreground`}>Modifier</button>
            <button type="button" onClick={() => onReset(lic)} className={`${TEXT_ACTION} font-medium text-primary-ink hover:underline`}>Rouleau rechargé ↺</button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="number" min={1} value={val} onChange={e => setVal(e.target.value)} placeholder="ex : 700"
            aria-label="Tirages par rouleau" className="w-24" />
          <span className="text-xs text-muted-foreground">tirages / rouleau</span>
          <Button onClick={save}>
            {cap ? 'Mettre à jour' : 'Activer'}
          </Button>
          <Button variant="ghost" onClick={() => { setVal(cap ?? ''); setEditing(false); }}>Annuler</Button>
        </div>
      ) : cap ? (
        <>
          <Meter value={used} max={cap} tone={low ? 'red' : warn ? 'amber' : 'brand'} aria-label="Papier utilisé sur le rouleau" />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3">
            <span className={`text-[13px] ${low ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
              ≈ {remaining} restants{low ? ' — bientôt vide' : ''}
            </span>
            <span className="text-xs text-muted-foreground">{used} / {cap}</span>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={`${TEXT_ACTION} font-medium text-primary-ink hover:underline`}>
          + Activer le suivi du papier
        </button>
      )}
    </div>
  );
}

// ── PIN admin de la borne (haché côté serveur, récupéré par le kiosk) ────────
function AdminPin({ lic, onPinChange }) {
  const [pin,     setPin]     = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy,    setBusy]    = useState(false);

  const digitsOnly = (v) => v.replace(/\D/g, '').slice(0, 8);
  const typing = pin.length > 0 || confirm.length > 0;
  // Sans saisie, le bouton renvoie le PIN déjà défini.
  const canSend = typing ? /^\d{4,8}$/.test(pin) && pin === confirm : !!lic.admin_pin_set_at;
  const received = lic.admin_pin_received_at && lic.admin_pin_pushed_at
    && new Date(lic.admin_pin_received_at) >= new Date(lic.admin_pin_pushed_at);

  async function send() {
    setBusy(true);
    try {
      if (typing) {
        onPinChange(lic.id, await setKioskAdminPin(lic.id, pin));
        setPin(''); setConfirm('');
      }
      onPinChange(lic.id, await pushKioskAdminPin(lic.id));
      toast.success('PIN envoyé : la borne le recevra à sa prochaine connexion');
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-border pt-4">
      <p className={`${SECTION_LABEL} mb-2`}>PIN admin</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="password" inputMode="numeric" autoComplete="new-password" value={pin}
          onChange={e => setPin(digitsOnly(e.target.value))} placeholder="4 à 8 chiffres"
          aria-label="PIN admin" className="min-w-28 flex-1 font-mono sm:w-40 sm:flex-none" />
        <Input type="password" inputMode="numeric" autoComplete="new-password" value={confirm}
          onChange={e => setConfirm(digitsOnly(e.target.value))} placeholder="Confirmer"
          aria-label="Confirmer le PIN admin" className="min-w-28 flex-1 font-mono sm:w-40 sm:flex-none" />
        <Button onClick={send} disabled={!canSend || busy}>
          {busy ? 'Envoi…' : 'Envoyer à la borne'}
        </Button>
      </div>
      {confirm.length >= 4 && pin !== confirm && (
        <p className="mt-1.5 text-[13px] text-destructive">Les deux PIN ne correspondent pas.</p>
      )}
      <p className="mt-2 text-[13px] text-muted-foreground">
        {lic.admin_pin_set_at ? (
          <>
            PIN défini le {formatDateTime(lic.admin_pin_set_at)}
            {' · '}
            {lic.admin_pin_pushed_at ? `envoyé le ${formatDateTime(lic.admin_pin_pushed_at)}` : 'pas encore envoyé'}
            {lic.admin_pin_pushed_at && (
              <>
                {' · '}
                {received
                  ? <span className="text-state-green-fg">reçu par la borne le {formatDateTime(lic.admin_pin_received_at)}</span>
                  : <span className="text-state-amber-fg">en attente de la borne</span>}
              </>
            )}
          </>
        ) : (
          <span className="text-state-amber-fg">Aucun PIN : l'écran admin de la borne reste bloqué.</span>
        )}
      </p>
    </div>
  );
}


// ── Composant carte monitoring ────────────────────────────────────────────────
function KioskCard({ lic, accountName, superAdmin, onToggle, onDelete, onLabelEdit, onRetire, releases, paperUsed, onPaperSave, onPaperReset, onPinChange, onUpdateChange, events }) {
  const status = onlineStatus(lic.last_seen_at);
  const installed = lic.app_version;
  const latestVersion = latestRelease(releases)?.version ?? null;
  const upToDate  = installed && latestVersion && compareVersions(installed, latestVersion) >= 0;
  const outdated  = installed && latestVersion && !upToDate;
  const printer   = lic.printer_status ? (PRINTER_STATUS[lic.printer_status] ?? PRINTER_STATUS.unknown) : null;
  const camera    = CAMERA_STATUS[lic.camera_status] ?? null;

  return (
    <Card className="flex flex-col gap-4 p-card">

      {/* Ligne 1 : nom, PC, interrupteur actif / désactivé */}
      <div className="flex items-start gap-3.5">
        <IconCircle tone="sand"><Camera /></IconCircle>

        <div className="min-w-0 flex-1">
          <input
            type="text"
            defaultValue={lic.label ?? ''}
            maxLength={80}
            onBlur={e => {
              // Le nom est obligatoire : un champ vidé reprend l'ancien nom.
              if (!e.target.value.trim()) { e.target.value = lic.label ?? ''; return; }
              onLabelEdit(lic, e.target.value.trim());
            }}
            placeholder="Nom de la borne"
            aria-label="Nom de la borne"
            className="-ml-1.5 block w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-card-title font-medium text-foreground transition-colors placeholder:text-muted-foreground hover:bg-soft focus:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-0.5 break-words text-[13px] text-muted-foreground">
            {superAdmin && <><span className="font-medium text-ink">{accountName}</span>{' · '}</>}
            PC {lic.machine_name || 'inconnu'}
            {lic.activated_at && <>{' · '}associée le {formatShortDate(lic.activated_at)}</>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-1">
          <Switch
            checked={lic.is_active}
            onCheckedChange={() => onToggle(lic)}
            aria-label={lic.is_active ? 'Désactiver la borne' : 'Activer la borne'}
          />
          {superAdmin && (
            <Button variant="ghost" size="icon-sm" onClick={() => onDelete(lic)}
              title="Supprimer définitivement" aria-label="Supprimer définitivement"
              className="-my-1.5 text-muted-foreground hover:bg-state-red hover:text-state-red-fg">
              <X />
            </Button>
          )}
        </div>
      </div>

      {/* Pastilles d'état : connexion, activation, version, imprimante, appareil photo */}
      <div className="flex flex-wrap gap-1.5">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        <StatusPill tone={lic.is_active ? 'green' : 'gray'} dot={false}>
          {lic.is_active ? 'Active' : 'Désactivée'}
        </StatusPill>
        {/* Version installée vs dernière version publiée ; mise à jour dans l'onglet Versions (LAB-338) */}
        {installed && (
          <Link to="?tab=versions"
            title={outdated ? `Dernière version publiée : ${latestVersion}. Mettre à jour dans l'onglet Versions` : upToDate ? 'À jour' : 'Voir les versions'}
            className={cn(
              statusPillVariants({ tone: upToDate ? 'green' : outdated ? 'amber' : 'gray' }),
              'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            v{installed}
            {upToDate && ' ✓'}
            {outdated && ` → ${latestVersion}`}
          </Link>
        )}
        {printer && (
          <StatusPill
            tone={printer.tone}
            title={lic.printer_name ? `${lic.printer_name}${lic.printer_status_at ? ` · ${timeAgo(lic.printer_status_at)}` : ''}` : undefined}
          >
            {printer.label}
          </StatusPill>
        )}
        {camera && (
          <StatusPill
            tone={camera.tone}
            title={lic.camera_status_at ? `Dernier état connu ${timeAgo(lic.camera_status_at)}` : undefined}
          >
            {camera.label}
          </StatusPill>
        )}
      </div>

      {/* Ligne 2 : métriques */}
      <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">

        {/* Dernière connexion */}
        <div className="min-w-0">
          <p className={METRIC_LABEL}>Dernière connexion</p>
          <p className="text-sm font-medium text-foreground">
            {lic.last_seen_at ? timeAgo(lic.last_seen_at) : <span className="font-normal text-muted-foreground">—</span>}
          </p>
        </div>

        {/* Événement actif */}
        <div className="min-w-0">
          <p className={METRIC_LABEL}>Événement actif</p>
          <p className="truncate text-sm font-medium text-foreground">
            {lic.activeEvent
              ? <span title={lic.activeEvent.name}>{lic.activeEvent.name}</span>
              : <span className="font-normal text-muted-foreground">—</span>}
          </p>
        </div>

        {/* Dernière photo */}
        <div className="min-w-0">
          <p className={METRIC_LABEL}>Dernière photo</p>
          {lic.lastPhoto ? (
            <div className="flex items-center gap-2">
              <img
                src={lic.lastPhoto.thumbnail_url ?? lic.lastPhoto.photo_url}
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg bg-muted object-cover"
                onError={e => { e.target.style.display = 'none'; }}
              />
              <span className="text-sm font-medium text-foreground">{timeAgo(lic.lastPhoto.created_at)}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>
      </div>

      {/* Événement affiché par la borne, envoyé depuis le SaaS (LAB-245) ; ancre du lien de /associer */}
      <div id={`envoyer-${lic.id}`} className="scroll-mt-24">
        {/* Suivi relu par le temps réel et toutes les 30 s (load) : pas de relecture propre à la section. */}
        <KioskEventPushSection lic={lic} events={events} onLicenseUpdate={onUpdateChange} />
      </div>

      {/* Réglages de l'appareil photo (LAB-429), relus de la même façon */}
      <KioskCameraSection lic={lic} onLicenseUpdate={onUpdateChange} />

      {/* Ligne 3 : stock papier */}
      <PaperStock lic={lic} used={paperUsed} onSave={onPaperSave} onReset={onPaperReset} />

      {/* Ligne 4 : accès à la borne */}
      <AdminPin lic={lic} onPinChange={onPinChange} />

      {/* Remplacer le PC / retirer la borne */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button asChild size="sm" variant="outline">
          <Link to={`/associer?replace=${lic.id}`}>Remplacer le PC</Link>
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:bg-state-red hover:text-state-red-fg"
          onClick={() => onRetire(lic)}>
          Retirer cette borne
        </Button>
      </div>
    </Card>
  );
}

// ── Bornes retirées : historique gardé, réassociables ─────────────────────────
function RetiredKiosks({ licenses, accountName, superAdmin, onDelete }) {
  const [open, setOpen] = useState(false);
  if (licenses.length === 0) return null;

  return (
    <section>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Bornes retirées
        <Badge variant="secondary" className="ml-1">{licenses.length}</Badge>
      </button>
      {open && (
        <Card className="mt-3 divide-y px-card py-1">
          {licenses.map(lic => (
            <div key={lic.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:flex-nowrap">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium text-foreground">{kioskName(lic)}</p>
                <p className="text-[13px] text-muted-foreground">
                  {superAdmin && <>{accountName(lic)}{' · '}</>}
                  Retirée le {formatShortDate(lic.retired_at)}
                  {lic.machine_name && <>{' · '}PC {lic.machine_name}</>}
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link to={`/associer?replace=${lic.id}`}>Associer de nouveau</Link>
              </Button>
              {superAdmin && (
                <Button variant="ghost" size="icon-sm" onClick={() => onDelete(lic)}
                  title="Supprimer définitivement" aria-label="Supprimer définitivement"
                  className="shrink-0 text-muted-foreground hover:bg-state-red hover:text-state-red-fg">
                  <X />
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

// ── Limite de bornes du compte (modifiable par le super-admin) ────────────────
function KioskLimit({ account, used, superAdmin, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState('');
  const limit = account.kiosk_limit;

  function startEdit() { setVal(limit ?? ''); setEditing(true); }
  async function save() {
    const next = val === '' ? null : Number(val);
    if (next !== null && (!Number.isInteger(next) || next < 0)) { toast.error('Limite invalide'); return; }
    if (await onSave(account, next)) setEditing(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span>
        {superAdmin && account.name && <span className="font-medium text-foreground">{account.name} : </span>}
        {limit == null
          ? <>{countLabel(used, 'borne')}, sans limite</>
          : <span className={used >= limit ? 'font-medium text-state-amber-fg' : undefined}>
              {countLabel(used, 'borne')} sur {limit} {plural(limit, 'autorisée')}
            </span>}
      </span>
      {superAdmin && !editing && (
        <button type="button" onClick={startEdit} className={`${TEXT_ACTION} text-muted-foreground hover:text-foreground`}>Modifier la limite</button>
      )}
      {editing && (
        <span className="flex flex-wrap items-center gap-2">
          <Input type="number" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder="Sans limite"
            aria-label="Limite de bornes" className="w-32" />
          <Button onClick={save}>Enregistrer</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
          <span className="text-xs text-muted-foreground">Vide = sans limite</span>
        </span>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

const ALL_ACCOUNTS = 'all';

export default function AdminLicenses() {
  const [licenses,   setLicenses]   = useState([]);
  const [paperUsage, setPaperUsage] = useState({});
  const [loading,    setLoading]    = useState(true);
  const [releases,   setReleases]   = useState([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [accounts,   setAccounts]   = useState([]);
  const [ownOrgId,   setOwnOrgId]   = useState(null);
  const [accountFilter, setAccountFilter] = useState(ALL_ACCOUNTS);
  const [pushEvents, setPushEvents] = useState([]);
  const location = useLocation();

  useEffect(() => {
    load();
    loadReleases();
    isAppAdmin().then(setSuperAdmin).catch(() => {});
    loadAccounts();
    fetchPushableEvents().then(setPushEvents).catch(() => {});

    // Realtime : un heartbeat ou un changement de borne relit les colonnes autorisées (load).
    const channel = supabase
      .channel('kiosk-licenses-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_licenses' }, load)
      .subscribe();

    // Refresh toutes les 30s pour garder les "il y a X min" à jour
    const timer = setInterval(load, 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, []);

  // Lien « Envoyer un événement sur cette borne » de /associer : défile jusqu'à la borne.
  useEffect(() => {
    if (loading || !location.hash.startsWith('#envoyer-')) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, location.hash]);

  async function load() {
    try {
      const data = await fetchKioskMonitoring();
      setLicenses(data);
      refreshPaper(data.filter(l => !l.retired_at));
    } catch { /* non bloquant */ }
    finally { setLoading(false); }
  }

  async function loadReleases() {
    try { setReleases(await fetchKioskReleases()); }
    catch { /* non bloquant */ }
  }

  async function loadAccounts() {
    try {
      const { accounts: list, ownOrgId: own } = await fetchKioskAccounts();
      setAccounts(list);
      setOwnOrgId(own);
    } catch { /* non bloquant */ }
  }

  async function refreshPaper(machines) {
    try {
      const usage = await getPaperUsage(
        machines.map(m => ({ machine_id: m.machine_id, paper_reset_at: m.paper_reset_at }))
      );
      setPaperUsage(usage);
    } catch { /* non bloquant */ }
  }

  async function handlePaperSave(lic, capacity) {
    const cap = capacity ? parseInt(capacity, 10) : null;
    setLicenses(l => l.map(x => x.id === lic.id ? { ...x, paper_capacity: cap } : x));
    try { await updateLicense(lic.id, { paper_capacity: cap }); } catch { /* non bloquant */ }
  }

  async function handlePaperReset(lic) {
    const now = new Date().toISOString();
    setLicenses(l => l.map(x => x.id === lic.id ? { ...x, paper_reset_at: now } : x));
    if (lic.machine_id) setPaperUsage(u => ({ ...u, [lic.machine_id]: 0 }));
    try { await updateLicense(lic.id, { paper_reset_at: now }); } catch { /* non bloquant */ }
  }

  async function toggleActive(lic) {
    const next = !lic.is_active;
    setLicenses(l => l.map(x => x.id === lic.id ? { ...x, is_active: next } : x));
    try { await updateLicense(lic.id, { is_active: next }); }
    catch (err) {
      toast.error(err.message);
      setLicenses(l => l.map(x => x.id === lic.id ? { ...x, is_active: !next } : x));
    }
  }

  async function handleRetire(lic) {
    if (!confirm(`Retirer « ${kioskName(lic)} » ?\n`
      + 'La borne revient à l\'écran d\'association et disparaît des listes de choix. '
      + 'Son historique est gardé et vous pourrez l\'associer de nouveau plus tard.')) return;
    try {
      const res = await retireLicense(lic.id);
      setLicenses(l => l.map(x => x.id === lic.id ? { ...x, retired_at: res?.retired_at ?? new Date().toISOString(), is_active: false } : x));
      toast.success('Borne retirée');
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function handleDelete(lic) {
    if (!confirm(`Supprimer définitivement « ${kioskName(lic)} » ?\nSon historique sera perdu. Pour la mettre de côté, préférez « Retirer cette borne ».`)) return;
    setLicenses(l => l.filter(x => x.id !== lic.id));
    try { await deleteLicense(lic.id); }
    catch (err) { toast.error(err.message); load(); }
  }

  async function handleLabelEdit(lic, label) {
    if (label === lic.label) return;
    setLicenses(l => l.map(x => x.id === lic.id ? { ...x, label } : x));
    try { await updateLicense(lic.id, { label }); }
    catch (err) { toast.error(err.message); }
  }

  async function handleLimitSave(account, limit) {
    try {
      await updateOrgKioskLimit(account.id, limit);
      setAccounts(a => a.map(o => o.id === account.id ? { ...o, kiosk_limit: limit } : o));
      toast.success('Limite enregistrée');
      return true;
    } catch (err) { toast.error(err.message); return false; }
  }

  function handlePinChange(id, dates) {
    setLicenses(l => l.map(x => x.id === id ? { ...x, ...dates } : x));
  }

  function handleUpdateChange(id, update) {
    if (update) setLicenses(l => l.map(x => x.id === id ? { ...x, ...update } : x));
  }

  // Comptes : ceux lisibles (organizations), plus ceux des bornes visibles dont le nom n'est pas lisible.
  const accountById = Object.fromEntries(accounts.map(o => [o.id, o]));
  const accountName = (lic) => accountById[lic.org_id]?.name || 'Autre compte';
  const accountOptions = [
    ...accounts.filter(o => o.id === ownOrgId || licenses.some(l => l.org_id === o.id)),
    ...[...new Set(licenses.map(l => l.org_id))]
      .filter(id => id && !accountById[id])
      .map(id => ({ id, name: `Autre compte (${id.slice(0, 8)})` })),
  ];

  const filter = superAdmin ? accountFilter : ALL_ACCOUNTS;
  const visible = filter === ALL_ACCOUNTS ? licenses : licenses.filter(l => l.org_id === filter);
  const active  = visible.filter(l => !l.retired_at);
  const retired = visible.filter(l => l.retired_at);
  const online  = active.filter(l => l.last_seen_at && (Date.now() - new Date(l.last_seen_at).getTime()) < 5 * 60_000);

  // Limite affichée : compte filtré (super-admin), sinon son propre compte.
  const limitAccount = accountById[filter === ALL_ACCOUNTS ? ownOrgId : filter] ?? null;
  const limitUsed = limitAccount ? licenses.filter(l => l.org_id === limitAccount.id && !l.retired_at).length : 0;

  return (
    // Onglet État de la page Bornes (/admin/bornes, LAB-335) : titre et onglets dans AdminBornes.
    <div className="flex flex-col gap-5">

      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-muted-foreground">Vos bornes en temps réel.</p>
          {!loading && active.length > 0 && (
            <StatusPill tone={online.length > 0 ? 'green' : 'gray'}>
              {online.length}/{active.length} en ligne
            </StatusPill>
          )}
        </div>
        <CreateButton to="/associer">Associer une borne</CreateButton>
      </div>

      {/* Filtre par compte et limite de bornes */}
      {(limitAccount || (superAdmin && accountOptions.length > 1)) && (
        <Card className="flex flex-col gap-3 p-card">
          {superAdmin && accountOptions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="kiosk-account-filter" className="text-[13px] text-muted-foreground">Compte</Label>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger id="kiosk-account-filter" className="w-auto min-w-48 max-w-full" aria-label="Filtrer par compte">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACCOUNTS}>Tous les comptes</SelectItem>
                  {accountOptions.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || 'Compte sans nom'}{o.id === ownOrgId ? ' (mon compte)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {limitAccount && (
            <KioskLimit key={limitAccount.id} account={limitAccount} used={limitUsed}
              superAdmin={superAdmin} onSave={handleLimitSave} />
          )}
        </Card>
      )}

      {/* Liste monitoring */}
      <section className="flex flex-col gap-3">
        <CardTitle as="h2" className="flex items-center gap-2">
          Bornes
          {active.length > 0 && <Badge variant="secondary">{active.length}</Badge>}
        </CardTitle>

        {loading ? (
          <div className="grid grid-cols-1 gap-card xl:grid-cols-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 rounded-card" />)}
          </div>
        ) : active.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-card py-10 text-center">
            <IconCircle tone="muted"><Camera /></IconCircle>
            <p className="max-w-md text-sm text-muted-foreground">
              Aucune borne associée. Allumez la borne : elle affiche un QR code à scanner avec votre téléphone,
              ou cliquez sur « Associer une borne » et tapez son code.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-card xl:grid-cols-2">
            {active.map(lic => (
              <KioskCard
                key={lic.id}
                lic={lic}
                accountName={accountName(lic)}
                superAdmin={superAdmin}
                onToggle={toggleActive}
                onDelete={handleDelete}
                onLabelEdit={handleLabelEdit}
                onRetire={handleRetire}
                releases={releases}
                paperUsed={(lic.machine_id && paperUsage[lic.machine_id]) || 0}
                onPaperSave={handlePaperSave}
                onPaperReset={handlePaperReset}
                onPinChange={handlePinChange}
                onUpdateChange={handleUpdateChange}
                events={pushEvents}
              />
            ))}
          </div>
        )}

        <RetiredKiosks licenses={retired} accountName={accountName} superAdmin={superAdmin} onDelete={handleDelete} />
      </section>

    </div>
  );
}
