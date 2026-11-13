import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, Trash2, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { supabase, fetchKioskMonitoring, updateLicense, deleteLicense, fetchKioskLogs, deleteKioskLogsByMachine,
  fetchKioskReleases, uploadKioskRelease, deleteKioskRelease, getPaperUsage,
  setKioskAdminPin, pushKioskAdminPin, requestKioskUpdate, retireLicense,
  isAppAdmin, fetchKioskAccounts, updateOrgKioskLimit, fetchPushableEvents } from '../../lib/supabase';
import { KioskEventPushSection } from '../../components/admin/KioskEventPush';
import { compareVersions, kioskUpdateStatus, latestRelease } from '../../lib/kioskUpdate';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { toast } from 'sonner';

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

function onlineStatus(lastSeenAt) {
  if (!lastSeenAt) return { label: 'Jamais vu', color: 'text-gray-400', dot: 'bg-gray-300', pulse: false };
  const min = (Date.now() - new Date(lastSeenAt).getTime()) / 60000;
  if (min < 5)  return { label: 'En ligne',   color: 'text-emerald-600', dot: 'bg-emerald-500', pulse: true  };
  if (min < 30) return { label: 'Récent',      color: 'text-amber-600',   dot: 'bg-amber-400',   pulse: false };
  return              { label: 'Hors ligne',   color: 'text-gray-400',    dot: 'bg-gray-300',    pulse: false };
}

// Statut matériel imprimante remonté par le kiosk (kiosk_licenses.printer_status)
const PRINTER_STATUS = {
  ready:     { label: 'Imprimante prête', dot: 'bg-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  offline:   { label: 'Impr. hors ligne', dot: 'bg-gray-400',    bg: 'bg-gray-100',    text: 'text-gray-500'    },
  paper_out: { label: 'Plus de papier',   dot: 'bg-red-500',     bg: 'bg-red-50',      text: 'text-red-600'     },
  paper_jam: { label: 'Bourrage papier',  dot: 'bg-red-500',     bg: 'bg-red-50',      text: 'text-red-600'     },
  error:     { label: 'Erreur impr.',     dot: 'bg-red-500',     bg: 'bg-red-50',      text: 'text-red-600'     },
  not_found: { label: 'Impr. introuvable', dot: 'bg-amber-500',  bg: 'bg-amber-50',    text: 'text-amber-600'   },
  unknown:   { label: 'Impr. inconnue',   dot: 'bg-gray-300',    bg: 'bg-gray-100',    text: 'text-gray-400'    },
};

// État de l'appareil photo remonté par le kiosk (kiosk_licenses.camera_status, LAB-263).
// NULL = jamais dit : pas de badge.
const CAMERA_STATUS = {
  ok:           { label: 'Appareil photo OK',  dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  disconnected: { label: 'Appareil débranché', dot: 'bg-red-500',     bg: 'bg-red-50',     text: 'text-red-600'     },
};

// ── Stock papier (estimation par décompte des tirages) ───────────────────────
function PaperStock({ lic, used, onSave, onReset }) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(lic.paper_capacity ?? '');
  const cap = lic.paper_capacity;
  const remaining = cap ? Math.max(0, cap - used) : null;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const low = cap && remaining <= cap * 0.1;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';

  function save() { onSave(lic, val); if (val) setEditing(false); }

  return (
    <div className="pt-3 border-t border-gray-50">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Stock papier</p>
        {cap && !editing && (
          <div className="flex items-center gap-3">
            <button onClick={() => { setVal(cap); setEditing(true); }} className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">Modifier</button>
            <button onClick={() => onReset(lic)} className="text-[11px] font-medium text-violet-600 hover:text-violet-800 transition-colors">Rouleau rechargé ↺</button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="number" min={1} value={val} onChange={e => setVal(e.target.value)} placeholder="ex : 700"
            className="w-24 h-8 text-sm" />
          <span className="text-xs text-gray-400">tirages / rouleau</span>
          <Button size="sm" className="h-8" onClick={save}>
            {cap ? 'Mettre à jour' : 'Activer'}
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { setVal(cap ?? ''); setEditing(false); }}>Annuler</Button>
        </div>
      ) : cap ? (
        <>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-xs ${low ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
              ≈ {remaining} restants{low ? ' — bientôt vide' : ''}
            </span>
            <span className="text-[11px] text-gray-400">{used} / {cap}</span>
          </div>
        </>
      ) : (
        <button onClick={() => setEditing(true)} className="text-xs font-medium text-violet-600 hover:text-violet-800 transition-colors">
          + Activer le suivi du papier
        </button>
      )}
    </div>
  );
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
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
    <div className="pt-3 border-t border-gray-50">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">PIN admin</p>
      <div className="flex items-center gap-2 flex-wrap">
        <Input type="password" inputMode="numeric" autoComplete="new-password" value={pin}
          onChange={e => setPin(digitsOnly(e.target.value))} placeholder="4 à 8 chiffres"
          aria-label="PIN admin" className="w-32 h-8 text-sm font-mono" />
        <Input type="password" inputMode="numeric" autoComplete="new-password" value={confirm}
          onChange={e => setConfirm(digitsOnly(e.target.value))} placeholder="Confirmer"
          aria-label="Confirmer le PIN admin" className="w-32 h-8 text-sm font-mono" />
        <Button size="sm" className="h-8" onClick={send} disabled={!canSend || busy}>
          {busy ? 'Envoi…' : 'Envoyer à la borne'}
        </Button>
      </div>
      {confirm.length >= 4 && pin !== confirm && (
        <p className="text-xs text-red-600 mt-1">Les deux PIN ne correspondent pas.</p>
      )}
      <p className="text-xs text-gray-500 mt-1.5">
        {lic.admin_pin_set_at ? (
          <>
            PIN défini le {formatDateTime(lic.admin_pin_set_at)}
            {' · '}
            {lic.admin_pin_pushed_at ? `envoyé le ${formatDateTime(lic.admin_pin_pushed_at)}` : 'pas encore envoyé'}
            {lic.admin_pin_pushed_at && (
              <>
                {' · '}
                {received
                  ? <span className="text-emerald-600">reçu par la borne le {formatDateTime(lic.admin_pin_received_at)}</span>
                  : <span className="text-amber-600">en attente de la borne</span>}
              </>
            )}
          </>
        ) : (
          <span className="text-amber-600">Aucun PIN : l'écran admin de la borne reste bloqué.</span>
        )}
      </p>
    </div>
  );
}

// ── Mise à jour de la borne (LAB-200 : uniquement sur demande d'ici) ─────────
function UpdateStatusLine({ status }) {
  if (status.state === 'none') {
    return <p className="text-xs text-gray-500 mt-1.5">Aucune demande : la borne ne se met jamais à jour d'elle-même.</p>;
  }
  return (
    <p className="text-xs text-gray-500 mt-1.5">
      v{status.version} demandée le {formatDateTime(status.requestedAt)}
      {status.state === 'requested' && <>{' · '}<span className="text-amber-600">en attente de la borne</span></>}
      {status.receivedAt && <>{' · '}reçue par la borne le {formatDateTime(status.receivedAt)}</>}
      {status.state === 'received' && (
        <>{' · '}<span className="text-amber-600">installation dès qu'aucune séance invité n'est en cours</span></>
      )}
      {status.state === 'installed' && <>{' · '}<span className="text-emerald-600">installée</span></>}
      {status.state === 'failed' && (
        <>
          {' · '}
          <span className="text-red-600">
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
    <div className="pt-3 border-t border-gray-50">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Mise à jour</p>
      {releases.length === 0 ? (
        <p className="text-xs text-gray-400">Aucune version publiée.</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={version} onValueChange={setChoice}>
            <SelectTrigger className="h-8 w-auto min-w-32 text-sm font-mono" aria-label="Version à installer">
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
          <Button size="sm" className="h-8" onClick={request} disabled={!version || alreadyInstalled || busy}
            title={alreadyInstalled ? 'Version déjà installée sur cette borne' : undefined}>
            {busy ? 'Envoi…' : 'Mettre à jour'}
          </Button>
        </div>
      )}
      <UpdateStatusLine status={kioskUpdateStatus(lic)} />
    </div>
  );
}


function kioskName(lic) {
  return lic.label || lic.machine_name || 'Borne sans nom';
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
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
    <Card className="p-5 space-y-4 rounded-2xl">

      {/* Ligne 1 : toggle + nom + badge online + badge actif */}
      <div className="flex items-start gap-3">
        <Switch
          checked={lic.is_active}
          onCheckedChange={() => onToggle(lic)}
          className="mt-0.5"
          aria-label={lic.is_active ? 'Désactiver la borne' : 'Activer la borne'}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
              className="text-sm font-semibold text-gray-900 bg-transparent outline-none hover:bg-gray-50 focus:bg-gray-50 px-1 py-0.5 rounded transition-colors"
            />
            {/* Badge online */}
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${status.color}`}>
              <span className="relative flex h-2 w-2">
                {status.pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${status.dot} opacity-70`} />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${status.dot}`} />
              </span>
              {status.label}
            </span>
            {/* Badge actif/inactif */}
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${lic.is_active ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
              {lic.is_active ? 'Active' : 'Désactivée'}
            </span>
            {/* Badge version installée vs dernière version publiée */}
            {installed && (
              <span
                title={outdated ? `Dernière version publiée : ${latestVersion}` : upToDate ? 'À jour' : undefined}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  upToDate ? 'bg-emerald-100 text-emerald-700'
                  : outdated ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'}`}
              >
                v{installed}
                {upToDate && ' ✓'}
                {outdated && ` → ${latestVersion}`}
              </span>
            )}
            {/* Badge statut imprimante */}
            {printer && (
              <span
                title={lic.printer_name ? `${lic.printer_name}${lic.printer_status_at ? ` · ${timeAgo(lic.printer_status_at)}` : ''}` : undefined}
                className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${printer.bg} ${printer.text}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${printer.dot}`} />
                {printer.label}
              </span>
            )}
            {/* Badge appareil photo */}
            {camera && (
              <span
                title={lic.camera_status_at ? `Dernier état connu ${timeAgo(lic.camera_status_at)}` : undefined}
                className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${camera.bg} ${camera.text}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${camera.dot}`} />
                {camera.label}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 px-1">
            {superAdmin && <><span className="font-medium text-gray-600">{accountName}</span>{' · '}</>}
            PC {lic.machine_name || <span className="text-gray-300">inconnu</span>}
            {lic.activated_at && <>{' · '}associée le {formatDate(lic.activated_at)}</>}
          </p>
        </div>

        {superAdmin && (
          <button onClick={() => onDelete(lic)} title="Supprimer définitivement"
            className="shrink-0 text-gray-300 hover:text-destructive transition-colors mt-0.5">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Ligne 2 : métriques */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-gray-50">

        {/* Dernière connexion */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Dernière connexion</p>
          <p className="text-sm font-medium text-gray-800">
            {lic.last_seen_at ? timeAgo(lic.last_seen_at) : <span className="text-gray-300">—</span>}
          </p>
        </div>

        {/* Événement actif */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Événement actif</p>
          <p className="text-sm font-medium text-gray-800 truncate">
            {lic.activeEvent
              ? <span title={lic.activeEvent.name}>{lic.activeEvent.name}</span>
              : <span className="text-gray-300">—</span>}
          </p>
        </div>

        {/* Dernière photo */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Dernière photo</p>
          {lic.lastPhoto ? (
            <div className="flex items-center gap-2">
              <img
                src={lic.lastPhoto.thumbnail_url ?? lic.lastPhoto.photo_url}
                alt=""
                className="w-8 h-8 rounded-lg object-cover shrink-0 bg-gray-100"
                onError={e => { e.target.style.display = 'none'; }}
              />
              <span className="text-sm font-medium text-gray-800">{timeAgo(lic.lastPhoto.created_at)}</span>
            </div>
          ) : (
            <p className="text-sm text-gray-300">—</p>
          )}
        </div>
      </div>

      {/* Événement affiché par la borne, envoyé depuis le SaaS (LAB-245) ; ancre du lien de /associer */}
      <div id={`envoyer-${lic.id}`} className="scroll-mt-24">
        {/* Suivi relu par le temps réel et toutes les 30 s (load) : pas de relecture propre à la section. */}
        <KioskEventPushSection lic={lic} events={events} onLicenseUpdate={onUpdateChange} />
      </div>

      {/* Ligne 3 : stock papier */}
      <PaperStock lic={lic} used={paperUsed} onSave={onPaperSave} onReset={onPaperReset} />

      {/* Mise à jour, uniquement sur demande */}
      <KioskUpdate lic={lic} releases={releases} onUpdateChange={onUpdateChange} />

      {/* Ligne 4 : accès à la borne */}
      <AdminPin lic={lic} onPinChange={onPinChange} />

      {/* Remplacer le PC / retirer la borne */}
      <div className="pt-3 border-t border-gray-50 flex items-center gap-2 flex-wrap">
        <Button asChild size="sm" variant="outline" className="h-8">
          <Link to={`/associer?replace=${lic.id}`}>Remplacer le PC</Link>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
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
    <section className="mt-6">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Bornes retirées
        <span className="ml-1 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-semibold rounded-full">{licenses.length}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {licenses.map(lic => (
            <div key={lic.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-card px-4 py-3 flex-wrap sm:flex-nowrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-700 truncate">{kioskName(lic)}</p>
                <p className="text-xs text-gray-400">
                  {superAdmin && <>{accountName(lic)}{' · '}</>}
                  Retirée le {formatDate(lic.retired_at)}
                  {lic.machine_name && <>{' · '}PC {lic.machine_name}</>}
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 shrink-0">
                <Link to={`/associer?replace=${lic.id}`}>Associer de nouveau</Link>
              </Button>
              {superAdmin && (
                <button onClick={() => onDelete(lic)} title="Supprimer définitivement"
                  className="shrink-0 text-gray-300 hover:text-destructive transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Limite de bornes du compte (modifiable par le super-admin) ────────────────
function KioskLimit({ account, used, superAdmin, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState('');
  const limit = account.kiosk_limit;
  const plural = (n) => (n > 1 ? 's' : '');

  function startEdit() { setVal(limit ?? ''); setEditing(true); }
  async function save() {
    const next = val === '' ? null : Number(val);
    if (next !== null && (!Number.isInteger(next) || next < 0)) { toast.error('Limite invalide'); return; }
    if (await onSave(account, next)) setEditing(false);
  }

  return (
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-sm text-gray-600">
      <span>
        {superAdmin && account.name && <span className="font-medium text-gray-800">{account.name} : </span>}
        {limit == null
          ? <>{used} borne{plural(used)}, sans limite</>
          : <span className={used >= limit ? 'font-semibold text-amber-700' : undefined}>
              {used} borne{plural(used)} sur {limit} autorisée{plural(limit)}
            </span>}
      </span>
      {superAdmin && !editing && (
        <button onClick={startEdit} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Modifier la limite</button>
      )}
      {editing && (
        <span className="flex items-center gap-2 flex-wrap">
          <Input type="number" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder="Sans limite"
            aria-label="Limite de bornes" className="w-28 h-8 text-sm" />
          <Button size="sm" className="h-8" onClick={save}>Enregistrer</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Annuler</Button>
          <span className="text-xs text-gray-400">Vide = sans limite</span>
        </span>
      )}
    </div>
  );
}

// ── Viewer de logs ────────────────────────────────────────────────────────────

const LEVEL_STYLE = {
  error:   { label: 'Erreur',     bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'    },
  warning: { label: 'Warning',    bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  info:    { label: 'Info',       bg: 'bg-gray-100',   text: 'text-gray-600',   dot: 'bg-gray-400'   },
};

function LogEntry({ log, machineLabel }) {
  const [expanded, setExpanded] = useState(false);
  const style = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.error;

  return (
    <div className={`rounded-xl border px-4 py-3 ${log.level === 'error' ? 'border-red-100 bg-red-50/40' : 'border-gray-100 bg-card'}`}>
      <div className="flex items-start gap-3">
        {/* Niveau */}
        <span className={`shrink-0 mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>

        <div className="flex-1 min-w-0">
          {/* En-tête */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400 mb-1">
            {machineLabel && <span className="font-medium text-gray-600">{machineLabel}</span>}
            {log.context && (
              <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">{log.context}</span>
            )}
            {log.app_version && <span>v{log.app_version}</span>}
            <span className="ml-auto">{timeAgo(log.occurred_at)}</span>
          </div>

          {/* Message */}
          <p className="text-sm text-gray-800 font-medium break-words">{log.message}</p>

          {/* Stack trace (toggle) */}
          {log.stack_trace && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {expanded ? '▲ Masquer la trace' : '▼ Voir la trace'}
            </button>
          )}
          {expanded && log.stack_trace && (
            <pre className="mt-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {log.stack_trace}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}


function LogsPanel({ licenses }) {
  const [logs,        setLogs]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [levelFilter, setLevelFilter] = useState('all');
  const [machFilter,  setMachFilter]  = useState('all');
  const [clearing,    setClearing]    = useState(false);

  useEffect(() => {
    loadLogs();
    const channel = supabase
      .channel('kiosk-logs-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kiosk_logs' }, loadLogs)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function loadLogs() {
    try {
      const data = await fetchKioskLogs({ limit: 300 });
      setLogs(data);
    } finally { setLoading(false); }
  }

  async function handleClearMachine(machineId) {
    if (!confirm(`Supprimer tous les logs de cette machine ?`)) return;
    setClearing(true);
    try {
      await deleteKioskLogsByMachine(machineId);
      setLogs(l => l.filter(x => x.machine_id !== machineId));
    } finally { setClearing(false); }
  }

  // Une borne retirée qui a cédé son PC n'a plus de machine_id.
  const machines = licenses.filter(l => l.machine_id);
  const machineLabel = (machineId) => {
    const lic = machines.find(l => l.machine_id === machineId);
    if (lic) return kioskName(lic);
    return machineId ? machineId.slice(0, 12) + '…' : null;
  };

  const filtered = logs.filter(l => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false;
    if (machFilter  !== 'all' && l.machine_id !== machFilter) return false;
    return true;
  });

  const errorCount = logs.filter(l => l.level === 'error').length;

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          Logs kiosk
          {errorCount > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full">
              {errorCount} erreur{errorCount > 1 ? 's' : ''}
            </span>
          )}
        </h2>

        {/* Filtres */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtre machine */}
          {machines.length > 1 && (
            <Select value={machFilter} onValueChange={setMachFilter}>
              <SelectTrigger className="h-8 w-auto text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les bornes</SelectItem>
                {machines.map(l => (
                  <SelectItem key={l.id} value={l.machine_id}>
                    {kioskName(l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Filtre niveau */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {['all', 'error', 'warning', 'info'].map(lv => (
              <button
                key={lv}
                onClick={() => setLevelFilter(lv)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  levelFilter === lv ? 'bg-card text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {lv === 'all' ? 'Tous' : LEVEL_STYLE[lv].label}
              </button>
            ))}
          </div>
          {/* Purge machine filtrée */}
          {machFilter !== 'all' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
              onClick={() => handleClearMachine(machFilter)}
              disabled={clearing}
            >
              Purger
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          {logs.length === 0 ? 'Aucun log reçu.' : 'Aucun log pour ce filtre.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(log => (
            <LogEntry key={log.id} log={log} machineLabel={machines.length > 1 ? machineLabel(log.machine_id) : null} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Versions kiosk (déploiement, super-admin seulement) ──────────────────────

function ReleasesPanel({ releases, loading, onChanged }) {
  const [version,  setVersion]  = useState('');
  const [notes,    setNotes]    = useState('');
  const [file,     setFile]     = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState(null);

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
    <Card className="p-5 mb-6">
      <h2 className="font-semibold text-gray-800 mb-1">Versions kiosk</h2>
      <p className="text-xs text-gray-400 mb-4">
        Publiez une version, puis demandez-la borne par borne avec « Mettre à jour » sur chaque PC.
        Une borne ne se met jamais à jour d'elle-même. Pour revenir en arrière, demandez une version antérieure.
      </p>

      {/* Publier une version */}
      <form onSubmit={handlePublish} className="grid grid-cols-1 gap-3 mb-5 p-4 bg-muted/50 rounded-xl border border-gray-100">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Version * (ex : 1.1.0)</Label>
            <Input type="text" value={version} onChange={e => setVersion(e.target.value)} placeholder="1.1.0"
              className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Installeur (.exe) *</Label>
            <input type="file" accept=".exe" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Notes de version (optionnel)</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Corrections, nouveautés…"
            className="min-h-0 resize-none" />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!version.trim() || !file || busy}>
            {busy ? (progress === null ? 'Préparation…' : `Envoi… ${progress} %`) : 'Publier la version'}
          </Button>
          {busy && progress !== null && (
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden" role="progressbar"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Envoi de l'installeur">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </form>

      {/* Liste des versions */}
      {loading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : releases.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Aucune version publiée.</p>
      ) : (
        <div className="space-y-2">
          {releases.map(rel => (
            <div key={rel.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 font-mono">v{rel.version}</span>
                </div>
                {rel.notes && <p className="text-xs text-gray-500 mt-0.5 truncate" title={rel.notes}>{rel.notes}</p>}
                {rel.sha256 && (
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5 truncate" title={`SHA-256 : ${rel.sha256}`}>
                    SHA-256 {rel.sha256.slice(0, 16)}…
                  </p>
                )}
              </div>
              <button onClick={() => handleDelete(rel)} title="Supprimer"
                className="shrink-0 text-gray-300 hover:text-destructive transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

const ALL_ACCOUNTS = 'all';

export default function AdminLicenses() {
  const [licenses,   setLicenses]   = useState([]);
  const [paperUsage, setPaperUsage] = useState({});
  const [loading,    setLoading]    = useState(true);
  const [releases,   setReleases]   = useState([]);
  const [relLoading, setRelLoading] = useState(true);
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
    finally { setRelLoading(false); }
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">

      {/* En-tête */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parc kiosk</h1>
          <p className="text-gray-500 text-sm mt-1">
            Vos bornes PolaKiosk en temps réel.
            {!loading && active.length > 0 && (
              <span className="ml-2 font-medium text-emerald-600">
                {online.length}/{active.length} en ligne
              </span>
            )}
          </p>
        </div>
        <Button asChild>
          <Link to="/associer"><Plus className="w-4 h-4 mr-1.5" />Associer une borne</Link>
        </Button>
      </div>

      {/* Filtre par compte et limite de bornes */}
      {(limitAccount || (superAdmin && accountOptions.length > 1)) && (
        <Card className="p-4 mb-6 space-y-3">
          {superAdmin && accountOptions.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-xs text-gray-500">Compte</Label>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="h-8 w-auto min-w-48 text-sm" aria-label="Filtrer par compte">
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

      {/* Versions kiosk (déploiement) */}
      {superAdmin && <ReleasesPanel releases={releases} loading={relLoading} onChanged={loadReleases} />}

      {/* Liste monitoring */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">
            Bornes
            {active.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-semibold rounded-full">
                {active.length}
              </span>
            )}
          </h2>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        ) : active.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            Aucune borne associée. Allumez la borne : elle affiche un QR code à scanner avec votre téléphone,
            ou cliquez sur « Associer une borne » et tapez son code.
          </p>
        ) : (
          <div className="space-y-3">
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

      {/* Logs d'erreurs remontés par les kiosks */}
      <LogsPanel licenses={visible} />
    </div>
  );
}
