import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useOrg } from './AdminLayout';
import { useFeatures } from '../../hooks/useFeatures';
import { useAppAdmin } from '../../hooks/useAppAdmin';
import { supabase, updateEventFormConfig, getFormResponses, getGlobalFormConfig, reviewDesign, resendAccessEmail, getEmailLogs, saveDbTemplate, invalidateTemplatesCache, saveKioskConfig, uploadKioskBackground, duplicateEvent, exportPolaFile, getEventPrintLogs, fetchLicenses, updateEventPhotobooth, getEventStats, sendDeliveryEmailForEvent, updateGalleryConfig, syncEventToGoogleCalendar } from '../../lib/supabase';
import DateTimePicker from '../../components/DateTimePicker';
import ModuleSlot from '../../components/ModuleSlot';
import EmailLogList from '../../components/EmailLogList';
import KioskQuestionnaireSettings from '../../components/admin/KioskQuestionnaireSettings';
import GuestResponsesPanel from '../../components/admin/GuestResponsesPanel';
import GuestExportReminderBanner from '../../components/admin/GuestExportReminderBanner';
import PhotoConsentsPanel from '../../components/admin/PhotoConsentsPanel';
import EventReportCard from '../../components/admin/EventReportCard';
import { EventKioskPushCard } from '../../components/admin/KioskEventPush';
import { kioskChoices } from '../../lib/kioskEventPush';
import { KIOSK_CREAM } from '../../lib/kioskSetupScreen';
import { FORMATS } from '../../utils/formats';
import { hasAnswer } from '../../utils/formQuestions';
import { renderDesignToPng } from '../../utils/renderDesign';
import { downloadPNG } from '../../utils/export';
import QRCode from 'qrcode';
import { ChevronLeft, Pencil, Loader2, X, Copy, Check, Download, Upload, Send, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { Card } from '../../components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Skeleton } from '../../components/ui/skeleton';
import { toast } from 'sonner';
import { mediaPurgeInfo } from '../../lib/mediaExpiry';
import { guestExportReminder } from '../../lib/guestExportReminder';
import {
  BOOMERANG_LIMITS, buildDefaultCapture, buildDefaultHome, buildDefaultResultButtons, cleanKioskFormats, DISPLAY_NAME_MAX, enabledFormats, FORMAT_LABEL_MAX,
  GIF_LIMITS, KIOSK_FORMATS, NO_FORMAT_ERROR, validateKioskFormats, withCaptureDefaults, withHomeDefaults,
  withResultButtonsDefaults,
} from '../../lib/kioskFormats';
import {
  buildDefaultQuestionnaire, withQuestionnaireDefaults, cleanQuestionnaire, validateKioskQuestionnaire,
} from '../../lib/kioskQuestionnaire';
import { BRAND } from '../../lib/instanceBrand';
import { KIOSK_BG_ACCEPT } from '../../lib/kioskBackground';

const APP_URL = (import.meta.env.VITE_APP_URL ?? window.location.origin).replace(/\/$/, '');

// Expiration par défaut des liens photos & audio : fin d'événement + 2 mois (date seule).
function mediaExpiryDefault(endIso) {
  if (!endIso) return '';
  const [y, mo, d] = endIso.split('T')[0].split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setMonth(dt.getMonth() + 2);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

const STATUS_DESIGN = {
  draft:     { label: 'Brouillon',               color: 'bg-gray-100 text-gray-500'        },
  submitted: { label: 'En attente de validation', color: 'bg-amber-100 text-amber-700'     },
  approved:  { label: 'Approuvé',                 color: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: 'Refusé',                   color: 'bg-red-100 text-red-600'         },
};

// Statut matériel imprimante remonté par le kiosk (kiosk_licenses.printer_status)
const PRINTER_STATUS = {
  ready:     { label: 'Prête',          dot: 'bg-emerald-500', text: 'text-emerald-700' },
  offline:   { label: 'Hors ligne',     dot: 'bg-gray-400',    text: 'text-gray-500'    },
  paper_out: { label: 'Plus de papier', dot: 'bg-red-500',     text: 'text-red-600'     },
  paper_jam: { label: 'Bourrage papier', dot: 'bg-red-500',    text: 'text-red-600'     },
  error:     { label: 'Erreur',         dot: 'bg-red-500',     text: 'text-red-600'     },
  not_found: { label: 'Introuvable',    dot: 'bg-amber-500',   text: 'text-amber-600'   },
  unknown:   { label: 'Inconnu',        dot: 'bg-gray-300',    text: 'text-gray-400'    },
};

// État de l'appareil photo remonté par le kiosk (kiosk_licenses.camera_status, LAB-263)
const CAMERA_STATUS = {
  ok:           { label: 'OK',        dot: 'bg-emerald-500', text: 'text-emerald-700' },
  disconnected: { label: 'Débranché', dot: 'bg-red-500',     text: 'text-red-600'     },
};

/** Durée relative compacte (« il y a 3 min », « il y a 2 h »). */
function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1)  return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24)   return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

const RESULT_BUTTONS = [
  { key: 'retake', name: 'Reprendre' },
  { key: 'print',  name: 'Imprimer'  },
  { key: 'qr',     name: 'QR Code'    },
  { key: 'email',  name: 'Email'      },
  { key: 'home',   name: 'Accueil'    },
];

const AVAILABLE_EFFECTS = [
  { id: 'black_and_white', label: 'Noir & blanc' },
  { id: 'sepia',           label: 'Sépia'        },
  { id: 'vintage',         label: 'Vintage'       },
  { id: 'vignette',        label: 'Vignette'      },
  { id: 'bright',          label: 'Lumineux'      },
];

function buildDefaultKiosk(companyName) {
  return {
    home:    buildDefaultHome(),
    capture: buildDefaultCapture(),
    effects: { user_can_choose: false, enabled_effects: ['none'], default_effect: 'none' },
    rgpd:    {
      enabled: false,
      message: "En participant à cet événement, vous acceptez que vos photos puissent être utilisées à des fins de communication par l'organisateur.",
    },
    result:  {
      auto_print: false, max_prints_per_event: 400,
      max_prints_per_photo: 2, show_remaining_prints: true,
      auto_return_seconds: 30,
      share: { qr: true },
      buttons: buildDefaultResultButtons(),
    },
    email: {
      enabled: false,
      sender_name:  companyName,
      sender_email: '',
      subject:      'Vos photos — {event_name}',
      message:      `Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\n${companyName}`,
    },
    printer: { default_printer: '', paper_format: '4x6' },
    questionnaire: buildDefaultQuestionnaire(),
  };
}

// ── Toggle ──────────────────────────────────────────────────────────────────
// Wrapper shadcn Switch — colorOn conservé pour compat mais le thème primary shadcn s'applique.
function Toggle({ checked, onChange }) {
  return <Switch checked={checked} onCheckedChange={onChange} />;
}

// ── Feature card toggle ──────────────────────────────────────────────────────
function FeatureCard({ iconPath, label, descOn, descOff, colorBg, colorIcon, colorOn, checked, onChange, locked }) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${checked ? 'bg-card border-gray-200 shadow-sm' : 'bg-gray-50 border-gray-100'}`}>
      <div className={`w-10 h-10 rounded-xl ${colorBg} flex items-center justify-center shrink-0`}>
        <svg className={`w-5 h-5 ${colorIcon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 leading-tight">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-tight">{checked ? descOn : (descOff ?? descOn)}</p>
      </div>
      {locked ? (
        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Bientôt</span>
      ) : (
        <Toggle checked={checked} onChange={onChange} colorOn={colorOn} />
      )}
    </div>
  );
}

// ── Galerie invités ───────────────────────────────────────────────────────────
const GALLERY_PLAN_DEFAULTS = {
  essentiel: { retention_days: 90,  allow_video: false, slideshow_enabled: false },
  premium:   { retention_days: 365, allow_video: true,  slideshow_enabled: true  },
};

function buildDefaultGallery() {
  return {
    guest_upload_enabled: false,
    plan:                 'essentiel',
    retention_days:       90,
    allow_video:          false,
    max_upload_mb:        20,
    moderation:           false,
    slideshow_enabled:    false,
    welcome_text:         '',
    ...GALLERY_PLAN_DEFAULTS.essentiel,
  };
}

function GallerySection({ event, onSaved }) {
  const [cfg,    setCfg]    = useState(() => ({ ...buildDefaultGallery(), ...(event.form_config?.gallery ?? {}) }));
  const [saving, setSaving] = useState(false);

  const guestUrl = `${APP_URL}/photos/${event.access_code}`;
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(guestUrl, { width: 512, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [guestUrl]);

  function downloadQr() {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `qr-galerie-${event.access_code}.png`;
    a.click();
  }

  function set(patch) { setCfg(c => ({ ...c, ...patch })); }

  function applyPlan(plan) {
    set({ plan, ...GALLERY_PLAN_DEFAULTS[plan] });
  }

  async function save(patch) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setSaving(true);
    try {
      const saved = await updateGalleryConfig(event.id, next);
      onSaved(saved);
      toast.success('Galerie enregistrée');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const enabled = cfg.guest_upload_enabled === true;

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-800">Galerie invités</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {enabled
              ? 'Les invités peuvent envoyer leurs photos depuis le lien galerie.'
              : 'Désactivée — seul le photobooth alimente la galerie.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={() => save({ guest_upload_enabled: !enabled })} disabled={saving} />
        </div>
      </div>

      {enabled && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-5">
          {/* Lien + QR code à partager aux invités */}
          <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            {qrDataUrl && (
              <img src={qrDataUrl} alt="QR code galerie invités"
                className="w-28 h-28 rounded-lg bg-card p-1.5 shadow-sm shrink-0" />
            )}
            <div className="min-w-0 flex-1 w-full">
              <p className="text-sm font-medium text-gray-700">Lien d'ajout de photos</p>
              <p className="text-xs text-gray-400 mb-2">À imprimer ou afficher : les invités scannent pour envoyer leurs photos.</p>
              <div className="flex items-center gap-2 bg-card border border-gray-200 rounded-lg px-3 py-2">
                <span className="flex-1 text-xs text-gray-500 font-mono truncate">{guestUrl}</span>
                <button type="button"
                  onClick={() => { navigator.clipboard.writeText(guestUrl); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:border-violet-300 hover:text-violet-600 transition-colors">
                  {copiedLink ? '✓ Copié' : 'Copier'}
                </button>
              </div>
              <button type="button" onClick={downloadQr} disabled={!qrDataUrl}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600 transition-colors disabled:opacity-50">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Télécharger le QR
              </button>
            </div>
          </div>

          {/* Palier */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Palier</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'essentiel', label: 'Essentiel', desc: 'Rétention 90 j · photos uniquement' },
                { id: 'premium',   label: 'Premium',   desc: 'Rétention 365 j · vidéos + diaporama' },
              ].map(p => (
                <button key={p.id} type="button" onClick={() => applyPlan(p.id)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    cfg.plan === p.id
                      ? 'border-violet-400 bg-gradient-to-br from-pink-50 to-violet-50 ring-2 ring-violet-100'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className={`text-sm font-semibold ${cfg.plan === p.id ? 'text-violet-700' : 'text-gray-700'}`}>{p.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-tight">{p.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Changer de palier applique ses valeurs par défaut ; vous pouvez ensuite ajuster finement ci-dessous.</p>
          </div>

          {/* Options fines */}
          <div className="space-y-1">
            <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
              <div>
                <p className="text-sm text-gray-700">Modération</p>
                <p className="text-xs text-gray-400">Les photos invités restent en attente jusqu'à validation.</p>
              </div>
              <Toggle checked={cfg.moderation === true} onChange={v => set({ moderation: v })} colorOn="bg-violet-600" />
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
              <div>
                <p className="text-sm text-gray-700">Vidéos autorisées</p>
                <p className="text-xs text-gray-400">Les invités peuvent envoyer des vidéos.</p>
              </div>
              <Toggle checked={cfg.allow_video === true} onChange={v => set({ allow_video: v })} colorOn="bg-violet-600" />
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
              <div>
                <p className="text-sm text-gray-700">Diaporama</p>
                <p className="text-xs text-gray-400">Affichage en diaporama sur la galerie.</p>
              </div>
              <Toggle checked={cfg.slideshow_enabled === true} onChange={v => set({ slideshow_enabled: v })} colorOn="bg-violet-600" />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">Rétention (jours)</Label>
                <Input type="number" min={1} value={cfg.retention_days ?? ''}
                  onChange={e => set({ retention_days: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">Taille max par envoi (Mo)</Label>
                <Input type="number" min={1} value={cfg.max_upload_mb ?? ''}
                  onChange={e => set({ max_upload_mb: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
            </div>
            <div className="pt-3 space-y-1.5">
              <Label className="text-xs text-gray-500">Texte d'accueil <span className="text-gray-400 font-normal">(optionnel)</span></Label>
              <Textarea rows={2} value={cfg.welcome_text ?? ''}
                onChange={e => set({ welcome_text: e.target.value })}
                placeholder="Message affiché aux invités sur la page d'envoi…"
                className="min-h-0 resize-none" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => save({})} disabled={saving} className="rounded-xl">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Enregistrement…' : 'Enregistrer la galerie'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}


// ── Formulaire pré-édition toggle ─────────────────────────────────────────────
function FormToggle({ event, onSaved }) {
  const [enabled, setEnabled] = useState(event.form_config?.enabled ?? false);
  const [saving,  setSaving]  = useState(false);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await updateEventFormConfig(event.id, { enabled: next });
      onSaved(next);
      toast.success(next ? 'Formulaire activé' : 'Formulaire désactivé');
    } catch (err) {
      setEnabled(!next);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-800">Formulaire pré-édition</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {enabled ? 'Le client répondra aux questions avant d\'accéder à l\'éditeur.' : 'Le client accède directement à l\'éditeur.'}
            {' '}
            <a href="/admin/settings" className="text-primary hover:underline">Configurer →</a>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={toggle} disabled={saving} />
        </div>
      </div>
    </Card>
  );
}

// ── Réponses formulaire ───────────────────────────────────────────────────────
const PAGE_SIZE = 5;
function fmtAnswer(value) {
  return Array.isArray(value) ? value.join(', ') : value;
}

function FormResponses({ eventId }) {
  const [responses, setResponses] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [page,      setPage]      = useState(1);

  useEffect(() => {
    Promise.all([getFormResponses(eventId), getGlobalFormConfig()])
      .then(([resp, cfg]) => { setResponses(resp); setQuestions(cfg?.questions ?? []); })
      .catch(() => { setResponses([]); setQuestions([]); });
  }, [eventId]);

  if (responses === null) return (
    <Card className="p-5 rounded-2xl">
      <Skeleton className="h-4 rounded-full w-40 mb-4" />
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-3 rounded-full w-3/4 mb-2" />)}
    </Card>
  );

  const totalPages = Math.ceil(responses.length / PAGE_SIZE);
  const paged = responses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <h2 className="font-semibold text-gray-800 mb-4">
        Réponses du formulaire
        {responses.length > 0 && <span className="ml-2 px-2 py-0.5 bg-primary/15 text-primary text-xs font-semibold rounded-full">{responses.length}</span>}
      </h2>
      {responses.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Aucune réponse pour le moment.</p>
      ) : (
        <>
          <div className="space-y-4">
            {paged.map((r) => (
              <div key={r.id} className="border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-3">Soumis le {new Date(r.submitted_at).toLocaleString('fr-FR')}</p>
                <dl className="space-y-2">
                  {questions.map((q) => hasAnswer(r.answers[q.id]) ? (
                    <div key={q.id}>
                      <dt className="text-xs text-gray-400 font-medium">{q.label}</dt>
                      <dd className="text-sm text-gray-800 mt-0.5">{fmtAnswer(r.answers[q.id])}</dd>
                    </div>
                  ) : null)}
                  {Object.entries(r.answers).filter(([k]) => hasAnswer(r.answers[k]) && !questions.find((q) => q.id === k)).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-gray-400 font-medium italic">{k}</dt>
                      <dd className="text-sm text-gray-800 mt-0.5">{fmtAnswer(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <span className="text-xs text-gray-400">Page {page} / {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => p - 1)} disabled={page === 1}>← Précédent</Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>Suivant →</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Promotion en modèle ───────────────────────────────────────────────────────
function PromoteToTemplateForm({ design, event, onDone }) {
  const [name,   setName]   = useState(event?.name ?? '');
  const [tags,   setTags]   = useState('');
  const [saving, setSaving] = useState(false);
  const [done,   setDone]   = useState(false);
  const [error,  setError]  = useState('');

  async function handleSave() {
    if (!name.trim() || !design?.canvas_json) return;
    setSaving(true);
    setError('');
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      await saveDbTemplate({ name: name.trim(), format_id: design.format, canvas_json: design.canvas_json, preview_url: design.final_png_url ?? null, tags: tagList, is_active: true });
      invalidateTemplatesCache();
      setDone(true);
      setTimeout(onDone, 1800);
    } catch (err) {
      setError(err.message ?? 'Erreur lors de la création du modèle.');
    } finally {
      setSaving(false);
    }
  }

  if (done) return (
    <div className="mt-4 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700 font-medium">
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      Modèle créé et disponible dans la bibliothèque.
    </div>
  );

  return (
    <div className="mt-4 p-4 bg-primary/10 border border-primary/15 rounded-xl space-y-3">
      <p className="text-xs font-semibold text-primary">Promouvoir en modèle</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Nom du modèle</Label>
        <Input type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder="ex: Mariage champêtre…" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Tags <span className="text-gray-400 font-normal">(optionnel, séparés par des virgules)</span></Label>
        <Input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="ex: mariage, floral, élégant" />
      </div>
      {error && <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={!name.trim() || saving}>
          {saving ? 'Création…' : 'Créer le modèle'}
        </Button>
        <Button variant="outline" onClick={onDone}>Annuler</Button>
      </div>
    </div>
  );
}

// ── Design soumis ─────────────────────────────────────────────────────────────
function DesignSection({ design, event, onReviewed }) {
  const [lightbox,       setLightbox]       = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showPromote,    setShowPromote]    = useState(false);
  // Les modèles sont un catalogue de l'application : promotion réservée à son administrateur (LAB-276).
  const { isAdmin: canPromote } = useAppAdmin();
  const [feedback,       setFeedback]       = useState('');
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [downloading,    setDownloading]    = useState(false);
  const [downloadingFond, setDownloadingFond] = useState(false);
  const statusInfo = STATUS_DESIGN[design?.status] ?? STATUS_DESIGN.draft;

  async function handleDownload() {
    setDownloading(true);
    setError('');
    try {
      // Régénère depuis canvas_json (source de vérité) pour garantir les bonnes
      // polices, y compris les polices custom. On ne retombe sur le PNG figé soumis
      // par le client que si le canvas_json est absent.
      const format = FORMATS[design.format];
      if (design.canvas_json && format) {
        const dataURL = await renderDesignToPng(design.canvas_json, format, { punchZones: true });
        downloadPNG(dataURL, `template-${event?.name ?? 'client'}.png`);
        return;
      }
      if (!design.final_png_url) { setError('Aucun rendu disponible pour ce design.'); return; }
      const res = await fetch(design.final_png_url);
      if (!res.ok) throw new Error(`Téléchargement échoué (${res.status})`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `template-${event?.name ?? 'client'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message ?? 'Erreur lors du téléchargement');
    } finally {
      setDownloading(false);
    }
  }

  // Regénère le PNG depuis le canvas_json sans percer les zones photo : le fond du
  // template reste visible aux emplacements photo (pour recadrer/ajouter les photos ailleurs).
  async function handleDownloadFondPlein() {
    if (!design.canvas_json) return;
    const format = FORMATS[design.format];
    if (!format) { setError('Format inconnu pour ce design.'); return; }
    setDownloadingFond(true);
    setError('');
    try {
      const dataURL = await renderDesignToPng(design.canvas_json, format, { punchZones: false });
      downloadPNG(dataURL, `template-${event?.name ?? 'client'}-fond-plein.png`);
    } catch (err) {
      setError(err.message ?? 'Erreur lors de la génération du PNG fond plein');
    } finally {
      setDownloadingFond(false);
    }
  }

  async function handleReview(action) {
    if (action === 'reject' && !showRejectForm) { setShowRejectForm(true); return; }
    if (action === 'reject' && !feedback.trim()) { setError('Veuillez indiquer un retour au client avant de rejeter.'); return; }
    setLoading(true);
    setError('');
    try {
      await reviewDesign({ designId: design.id, action, feedback });
      onReviewed(action, feedback);
      setShowRejectForm(false);
      setFeedback('');
    } catch (err) {
      // Refus Brevo : la décision est enregistrée, seul l'email au client a échoué.
      if (err.reviewed) {
        onReviewed(action, feedback);
        setShowRejectForm(false);
        setFeedback('');
      }
      setError(err.message ?? 'Erreur lors de la validation');
    } finally {
      setLoading(false);
    }
  }

  if (!design) return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <h2 className="font-semibold text-gray-800 mb-4">Template du client</h2>
      <div className="text-center py-10 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">Aucun template soumis pour le moment.</p>
      </div>
    </Card>
  );

  return (
    <>
      <Card className="p-5 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Template du client</h2>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-4">
          {design.submitted_at && <span>Soumis le {new Date(design.submitted_at).toLocaleString('fr-FR')}</span>}
          {design.reviewed_at  && <span>Relu le {new Date(design.reviewed_at).toLocaleString('fr-FR')}</span>}
          {design.format       && <span>Format : {design.format}</span>}
        </div>
        {design.final_png_url && (
          <div className="relative mb-4 overflow-hidden rounded-xl border border-gray-100 bg-[#F0F0F0] cursor-zoom-in"
            style={{ backgroundImage: 'repeating-conic-gradient(#d4d4d4 0% 25%, #F0F0F0 0% 50%) 0 0 / 16px 16px' }}
            onClick={() => setLightbox(true)}>
            <img src={design.final_png_url} alt="Aperçu template" className="max-h-72 object-contain mx-auto block py-4 px-4" />
            <div className="absolute bottom-2 right-2 bg-black/40 text-white text-xs px-2 py-1 rounded-md backdrop-blur-sm">Cliquer pour agrandir</div>
          </div>
        )}
        {design.status === 'rejected' && design.review_feedback && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 mb-4">
            <p className="text-xs font-semibold text-destructive mb-1">Retour envoyé au client</p>
            <p className="text-sm text-destructive">{design.review_feedback}</p>
            <p className="text-xs text-gray-400 mt-2">Le client peut maintenant modifier et resoumettre son template.</p>
          </div>
        )}
        {design.status === 'submitted' && !showRejectForm && (
          <div className="flex gap-3">
            <Button onClick={() => handleReview('approve')} disabled={loading}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700">
              <Check className="w-4 h-4" />
              Approuver
            </Button>
            <Button variant="outline" onClick={() => handleReview('reject')} disabled={loading}
              className="flex-1 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10">
              <X className="w-4 h-4" />
              Refuser
            </Button>
          </div>
        )}
        {error && !(design.status === 'submitted' && showRejectForm) && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 mt-3">{error}</p>
        )}
        {design.status === 'submitted' && showRejectForm && (
          <div className="space-y-3">
            <Label>Retour au client <span className="text-destructive">*</span></Label>
            <Textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
              placeholder="Expliquez au client ce qu'il doit modifier…"
              className="min-h-0 resize-none" />
            {!event?.client_email && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">Aucun email client renseigné — le retour ne sera pas envoyé par email.</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-3">
              <Button variant="destructive" onClick={() => handleReview('reject')} disabled={loading} className="flex-1">
                {loading ? 'Envoi…' : 'Confirmer le refus'}
              </Button>
              <Button variant="outline" onClick={() => { setShowRejectForm(false); setFeedback(''); setError(''); }} disabled={loading}>Annuler</Button>
            </div>
          </div>
        )}
        {design.final_png_url && (
          <Button variant="outline" onClick={handleDownload} disabled={downloading} className="mt-4 w-full">
            <Download className="w-4 h-4" />
            {downloading ? 'Téléchargement…' : 'PNG haute résolution · zones transparentes'}
          </Button>
        )}
        {design.canvas_json && (
          <Button variant="outline" onClick={handleDownloadFondPlein} disabled={downloadingFond} className="mt-2 w-full">
            <Download className="w-4 h-4" />
            {downloadingFond ? 'Génération…' : 'PNG haute résolution · fond plein'}
          </Button>
        )}
        {canPromote && design.canvas_json && !showPromote && (
          <Button variant="outline" onClick={() => setShowPromote(true)}
            className="mt-3 w-full border-dashed border-primary text-primary bg-primary/10 hover:bg-primary/15 hover:text-primary">
            <Sparkles className="w-4 h-4" />
            Promouvoir en modèle
          </Button>
        )}
        {canPromote && showPromote && <PromoteToTemplateForm design={design} event={event} onDone={() => setShowPromote(false)} />}
      </Card>
      {lightbox && design.final_png_url && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightbox(false)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors" onClick={() => setLightbox(false)}>
            <X className="w-8 h-8" />
          </button>
          <img src={design.final_png_url} alt="Aperçu template" className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

// ── Historique impressions ────────────────────────────────────────────────────
function PrintHistorySection({ eventId }) {
  const [logs,    setLogs]    = useState(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEventPrintLogs(eventId).then(setLogs).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [eventId]);

  const totalCopies = logs ? logs.reduce((s, l) => s + l.copies, 0) : 0;

  function formatDate(iso) {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-800">Historique des impressions</h2>
          <p className="text-xs text-gray-400 mt-0.5">Chaque impression effectuée depuis le kiosk.</p>
        </div>
        {logs && logs.length > 0 && (
          <span className="text-sm font-medium text-violet-700 bg-violet-50 px-3 py-1 rounded-full">
            {totalCopies} impression{totalCopies > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {loading && <div className="flex justify-center py-6"><span className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && logs?.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Aucune impression enregistrée pour cet événement.</p>}
      {!loading && !error && logs && logs.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; heure</TableHead>
                <TableHead>Photo</TableHead>
                <TableHead className="text-center">Copies</TableHead>
                <TableHead>Machine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-gray-700 whitespace-nowrap">{formatDate(log.printed_at)}</TableCell>
                  <TableCell>
                    {log.composite_url ? (
                      <a href={log.composite_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary transition-colors">
                        <img src={log.composite_url} alt="" className="w-8 h-8 object-cover rounded border border-gray-200" />
                        <span className="text-xs">Voir</span>
                      </a>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-violet-50 text-violet-700 text-xs font-semibold">{log.copies}</span>
                  </TableCell>
                  <TableCell className="text-gray-400 text-xs font-mono">{log.machine_id ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ── Accueil personnalisé (LAB-250) ──────────────────────────────────────────
// La borne affiche « Bienvenue au photobooth de {nom} » et la date de l'événement.
function KioskWelcomeCard({ kioskCfg, setKiosk, eventName, rowCls, labelCls }) {
  const home = kioskCfg.home ?? {};
  const shownName = (home.display_name ?? '').trim() || eventName || 'l’événement';
  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <div className={rowCls}>
        <div className="min-w-0 pr-4">
          <p className={labelCls}>Personnaliser l'accueil au nom de l'événement</p>
          <p className="text-xs text-gray-400">
            {home.personalized
              ? `La borne affiche « Bienvenue au photobooth de ${shownName} » et la date de l'événement.`
              : 'Désactivé : accueil standard de la borne.'}
          </p>
        </div>
        <Toggle checked={home.personalized === true} onChange={v => setKiosk('home.personalized', v)} />
      </div>
      {home.personalized && (
        <div className="pt-3 space-y-1.5">
          <Label htmlFor="kiosk-display-name" className="text-sm text-gray-700">Nom affiché <span className="text-gray-400 font-normal">(facultatif)</span></Label>
          <Input
            id="kiosk-display-name"
            value={home.display_name ?? ''}
            maxLength={DISPLAY_NAME_MAX}
            placeholder={eventName || 'Camille & Thomas'}
            onChange={e => setKiosk('home.display_name', e.target.value)}
            className="max-w-sm"
          />
          <p className="text-xs text-gray-400">Vide = nom de l'événement. Ex. « Camille & Thomas » plutôt que « Mariage Camille et Thomas 14/06 ».</p>
        </div>
      )}
    </Card>
  );
}

// ── Barre de sauvegarde kiosk ─────────────────────────────────────────────────
// ── Formats de la borne (LAB-235) ───────────────────────────────────────────
// Onglet Accueil : formats proposés aux invités et texte de leur bouton.
function KioskFormatsCard({ kioskCfg, setKiosk, rowCls, labelCls }) {
  const buttons = kioskCfg.home?.buttons ?? {};
  const active = enabledFormats(kioskCfg);
  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Formats proposés</h2>
      <p className="text-xs text-gray-400 mb-3">
        Un seul format : la borne garde son écran d'accueil habituel. Plusieurs formats : un bouton par format sur l'écran d'accueil.
      </p>
      <div className="divide-y divide-gray-50">
        {KIOSK_FORMATS.map(f => {
          const b = buttons[f.key] ?? {};
          return (
            <div key={f.key} className={`${rowCls} gap-4`}>
              <div className="min-w-0">
                <p className={labelCls}>{f.label}</p>
                <p className="text-xs text-gray-400">{f.description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Input
                  value={b.label ?? ''}
                  maxLength={FORMAT_LABEL_MAX}
                  placeholder={f.label}
                  disabled={b.enabled !== true}
                  onChange={e => setKiosk(`home.buttons.${f.key}.label`, e.target.value)}
                  aria-label={`Texte du bouton ${f.label}`}
                  className="w-36 h-8 text-sm"
                />
                <Toggle checked={b.enabled === true} onChange={v => setKiosk(`home.buttons.${f.key}.enabled`, v)} />
              </div>
            </div>
          );
        })}
      </div>
      {active.length === 0 && <p className="text-xs text-destructive mt-3">{NO_FORMAT_ERROR}.</p>}
      {(buttons.gif?.enabled || buttons.boomerang?.enabled) && (
        <p className="text-xs text-gray-400 mt-3">Réglez le nombre de photos du GIF et la durée du boomerang dans l'onglet « Capture ».</p>
      )}
    </Card>
  );
}

const range = (min, max, step) => Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step);
const seconds = (ms) => `${(ms / 1000).toLocaleString('fr-FR')} s`;

function NumberSelect({ value, options, format, onChange, label }) {
  return (
    <Select value={String(value)} onValueChange={v => onChange(Number(v))}>
      <SelectTrigger className="w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o} value={String(o)}>{format(o)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// Onglet Capture : réglages du GIF et du boomerang (affichés même si le format n'est pas coché).
function KioskAnimatedCaptureCards({ kioskCfg, setKiosk, rowCls, labelCls }) {
  const gif = kioskCfg.capture?.gif ?? {};
  const boomerang = kioskCfg.capture?.boomerang ?? {};
  const buttons = kioskCfg.home?.buttons ?? {};
  const off = (key) => buttons[key]?.enabled !== true
    ? <p className="text-xs text-gray-400 mb-2">Format non proposé pour l'instant (à cocher dans l'onglet « Accueil »).</p>
    : null;
  return (
    <>
      <Card className="p-5 rounded-2xl shadow-sm">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">GIF</h2>
        {off('gif')}
        <div className="divide-y divide-gray-50">
          <div className={rowCls}>
            <div>
              <p className={labelCls}>Nombre de photos</p>
              <p className="text-xs text-gray-400">De {GIF_LIMITS.shots.min} à {GIF_LIMITS.shots.max} photos, jouées en boucle</p>
            </div>
            <NumberSelect label="Nombre de photos du GIF"
              value={gif.shots ?? GIF_LIMITS.shots.default}
              options={range(GIF_LIMITS.shots.min, GIF_LIMITS.shots.max, 1)}
              format={n => `${n} photos`}
              onChange={v => setKiosk('capture.gif.shots', v)} />
          </div>
          <div className={rowCls}>
            <div>
              <p className={labelCls}>Temps entre deux photos</p>
              <p className="text-xs text-gray-400">Laisse aux invités le temps de changer de pose</p>
            </div>
            <NumberSelect label="Temps entre deux photos du GIF"
              value={gif.interval_ms ?? GIF_LIMITS.interval_ms.default}
              options={range(GIF_LIMITS.interval_ms.min, GIF_LIMITS.interval_ms.max, 500)}
              format={seconds}
              onChange={v => setKiosk('capture.gif.interval_ms', v)} />
          </div>
        </div>
      </Card>

      <Card className="p-5 rounded-2xl shadow-sm">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Boomerang</h2>
        {off('boomerang')}
        <div className="divide-y divide-gray-50">
          <div className={rowCls}>
            <div>
              <p className={labelCls}>Durée de la prise</p>
              <p className="text-xs text-gray-400">Le clip est ensuite joué à l'endroit puis à l'envers</p>
            </div>
            <NumberSelect label="Durée du boomerang"
              value={boomerang.duration_ms ?? BOOMERANG_LIMITS.duration_ms.default}
              options={range(BOOMERANG_LIMITS.duration_ms.min, BOOMERANG_LIMITS.duration_ms.max, 500)}
              format={seconds}
              onChange={v => setKiosk('capture.boomerang.duration_ms', v)} />
          </div>
          <div className={rowCls}>
            <div>
              <p className={labelCls}>Imprimer une image</p>
              <p className="text-xs text-gray-400">Propose l'impression d'une image du boomerang dans le design</p>
            </div>
            <Toggle checked={boomerang.print_frame === true} onChange={v => setKiosk('capture.boomerang.print_frame', v)} />
          </div>
        </div>
      </Card>
    </>
  );
}

function KioskSaveBar({ saving, onSave }) {
  return (
    <div className="flex items-center justify-end gap-3 py-3 border-t border-gray-100 mt-2">
      <Button onClick={onSave} disabled={saving} className="rounded-xl">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
      </Button>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminEventDetail() {
  const { id }         = useParams();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const org            = useOrg();
  const companyName    = org.contact_company || org.name || BRAND.name;

  const { isAvailable } = useFeatures();
  // Onglets rattachés à une fonctionnalité activable (les autres font partie du socle).
  const TAB_FEATURES = { template: 'client_design', questionnaire: 'guest_form' };
  const tabAvailable = (tabId) => isAvailable(TAB_FEATURES[tabId] ?? 'core');

  const VALID_TABS = ['general', 'template', 'accueil', 'apparence', 'capture', 'questionnaire', 'impression', 'partage'];
  const initialTab = VALID_TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'general';

  const [event,     setEvent]     = useState(null);
  const [design,    setDesign]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [stats,     setStats]     = useState({ photosCount: 0, printCopies: 0 });

  // Info edit
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm,    setInfoForm]    = useState({});
  const [savingInfo,  setSavingInfo]  = useState(false);

  // Édition inline du nom (depuis le titre du header)
  const [editingName, setEditingName] = useState(false);
  const [nameInput,   setNameInput]   = useState('');
  const [savingName,  setSavingName]  = useState(false);
  const [nameErr,     setNameErr]     = useState('');
  const [codeCopied,  setCodeCopied]  = useState(false);

  const [copiedLink, setCopiedLink] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [deliverySending, setDeliverySending] = useState(false);
  const [deliveryMsg, setDeliveryMsg] = useState('');
  const [emailLogs, setEmailLogs] = useState([]);

  // Actions
  const [duplicating, setDuplicating] = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [exportMsg,   setExportMsg]   = useState('');
  const [exportError, setExportError] = useState('');

  // Photobooth
  const [photobooths,     setPhotobooths]     = useState([]);
  const [selectedPb,      setSelectedPb]      = useState('');
  const [savingPb,        setSavingPb]        = useState(false);

  // Kiosk config
  const [kioskCfg,    setKioskCfgState] = useState(null);
  const [kioskSaving, setKioskSaving]   = useState(false);
  const [bgUploading, setBgUploading] = useState(false);

  // Résumé des réponses invités, relu par GuestResponsesPanel (rappel d'export, LAB-224)
  const [guestSummary, setGuestSummary] = useState(null);


  useEffect(() => { load(); }, [id]);

  // Messages d'envoi (code d'accès, livraison) : un seul minuteur par message, annulé au clic
  // suivant (sinon l'ancien efface trop tôt le nouveau message) et au démontage.
  const msgTimers = useRef({});
  useEffect(() => () => Object.values(msgTimers.current).forEach(clearTimeout), []);
  function clearMsgLater(key, setMsg, ms) {
    clearTimeout(msgTimers.current[key]);
    msgTimers.current[key] = setTimeout(() => setMsg(''), ms);
  }

  async function load() {
    const [{ data: ev }, { data: ds }, logs] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('client_designs').select('*').eq('event_id', id).maybeSingle(),
      getEmailLogs(id).catch(() => []),
    ]);
    setEvent(ev);
    setDesign(ds);
    setEmailLogs(logs);
    setSelectedPb(ev?.photobooth_id ?? '');
    if (ev) {
      // Couleurs de la borne fixes (LAB-250) : un ancien form_config.kiosk.theme est effacé à l'enregistrement.
      const { theme: _theme, ...raw } = ev.form_config?.kiosk ?? {};
      const DEF  = buildDefaultKiosk(companyName);
      setKioskCfgState({
        ...DEF,
        ...raw,
        capture: withCaptureDefaults(raw.capture),
        effects: { ...DEF.effects, ...(raw.effects ?? {}) },
        rgpd:    { ...DEF.rgpd,    ...(raw.rgpd    ?? {}) },
        result:  {
          ...DEF.result, ...(raw.result ?? {}),
          share:   { ...DEF.result.share,   ...(raw.result?.share   ?? {}) },
          buttons: withResultButtonsDefaults(raw.result?.buttons),
        },
        email:   { ...DEF.email,   ...(raw.email   ?? {}) },
        home:    withHomeDefaults(raw.home),
        questionnaire: withQuestionnaireDefaults(raw.questionnaire),
      });
    }
    setLoading(false);
    refreshPhotobooths();
    getEventStats(id).then(setStats).catch(() => {});
  }

  // Bornes retirées comprises : une borne assignée puis retirée reste affichée dans le choix (LAB-245).
  function refreshPhotobooths() {
    fetchLicenses({ includeRetired: true }).then(setPhotobooths).catch(() => {});
  }

  function handleLicenseUpdate(licenseId, columns) {
    if (columns) setPhotobooths(list => list.map(pb => pb.id === licenseId ? { ...pb, ...columns } : pb));
  }

  function setKiosk(path, value) {
    setKioskCfgState(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] ??= {}; cur = cur[keys[i]]; }
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleKioskSave() {
    // Questionnaire désactivé : onglet masqué, sa config n'est ni affichée ni bloquante.
    const questionnaireErrors = isAvailable('guest_form') ? validateKioskQuestionnaire(kioskCfg.questionnaire) : [];
    if (questionnaireErrors.length) {
      toast.error(`Questionnaire : ${questionnaireErrors[0].message}`);
      setActiveTab('questionnaire');
      return;
    }
    const formatErrors = validateKioskFormats(kioskCfg);
    if (formatErrors.length) {
      toast.error(formatErrors[0].message);
      setActiveTab(formatErrors[0].tab);
      return;
    }
    setKioskSaving(true);
    try {
      const questionnaire = cleanQuestionnaire(kioskCfg.questionnaire);
      const cleaned = { ...cleanKioskFormats(kioskCfg), questionnaire };
      const updated = await saveKioskConfig(event.id, cleaned);
      setEvent(e => ({ ...e, form_config: updated }));
      setKioskCfgState(c => ({ ...c, questionnaire, home: cleaned.home, capture: cleaned.capture, result: cleaned.result }));
      toast.success('Configuration enregistrée');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setKioskSaving(false);
    }
  }

  async function handleBgUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgUploading(true);
    try {
      const url = await uploadKioskBackground(event.id, file);
      setKiosk('home.background_url', url);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBgUploading(false);
      e.target.value = '';
    }
  }

  async function handlePhotoboothChange(pbId) {
    setSelectedPb(pbId);
    setSavingPb(true);
    try {
      await updateEventPhotobooth(event.id, pbId || null);
      setEvent(e => ({ ...e, photobooth_id: pbId || null }));
      toast.success('Photobooth enregistré');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingPb(false);
    }
  }

  async function handleArchive() {
    if (!confirm('Archiver cet événement ? Le client ne pourra plus y accéder.')) return;
    await supabase.from('events').update({ status: 'archived' }).eq('id', id);
    setEvent(e => ({ ...e, status: 'archived' }));
  }

  async function handleDuplicate() {
    if (!confirm('Dupliquer cet événement ?')) return;
    setDuplicating(true);
    try {
      const created = await duplicateEvent(event.id);
      navigate(`/admin/events/${created.id}`);
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      setDuplicating(false);
    }
  }

  async function handleExportPola() {
    setExporting(true);
    setExportMsg('');
    setExportError('');
    try {
      const { fileName, warnings } = await exportPolaFile(event.id);
      setExportMsg(warnings.length ? `✓ ${fileName} — à noter : ${warnings.join(' ; ')}` : `✓ ${fileName}`);
      setTimeout(() => setExportMsg(''), warnings.length ? 8000 : 4000);
    } catch (err) {
      // Reste affiché : l'admin doit agir (approuver le design) avant de réessayer.
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function copyUrl(key, url) {
    navigator.clipboard.writeText(url);
    setCopiedLink(key);
    setTimeout(() => setCopiedLink(''), 2000);
  }

  async function handleResend() {
    setResending(true);
    setResendMsg('');
    let ok = false;
    try {
      await resendAccessEmail(event.id);
      ok = true;
      setResendMsg('ok');
    } catch (err) {
      setResendMsg(err.message ?? 'Erreur');
    } finally {
      setResending(false);
      // Un refus Brevo écrit aussi une ligne (statut « error ») dans « Emails envoyés ».
      getEmailLogs(id).then(setEmailLogs).catch(() => {});
      clearMsgLater('resend', setResendMsg, ok ? 4000 : 8000);
    }
  }

  async function handleSendDelivery() {
    setDeliverySending(true);
    setDeliveryMsg('');
    let ok = false;
    try {
      const res = await sendDeliveryEmailForEvent(event.id);
      ok = true;
      setDeliveryMsg(res?.skipped ? 'Livraison déjà envoyée' : 'ok');
    } catch (err) {
      setDeliveryMsg(err.message ?? 'Erreur');
    } finally {
      setDeliverySending(false);
      getEmailLogs(id).then(setEmailLogs).catch(() => {});
      clearMsgLater('delivery', setDeliveryMsg, ok ? 4000 : 8000);
    }
  }

  function startEditInfo() {
    setInfoForm({
      name:         event.name         ?? '',
      client_name:  event.client_name  ?? '',
      client_email: event.client_email ?? '',
      start_date:   event.start_date ? new Date(event.start_date).toISOString().slice(0, 16) : '',
      end_date:     event.end_date   ? new Date(event.end_date).toISOString().slice(0, 16)   : '',
      expires_at:   event.expires_at ? new Date(event.expires_at).toISOString().slice(0, 10) : '',
      photo_gallery_url: event.photo_gallery_url ?? '',
      delivery_attachment_url: event.delivery_attachment_url ?? '',
    });
    setEditingInfo(true);
  }

  async function saveEventInfo() {
    setSavingInfo(true);
    try {
      const updates = {
        name:         infoForm.name.trim(),
        client_name:  infoForm.client_name.trim()  || null,
        client_email: infoForm.client_email.trim() || null,
        start_date:   infoForm.start_date          || null,
        end_date:     infoForm.end_date            || infoForm.start_date || null,
        expires_at:   infoForm.expires_at          || null,
        photo_gallery_url: infoForm.photo_gallery_url?.trim() || null,
        delivery_attachment_url: infoForm.delivery_attachment_url?.trim() || null,
      };
      const { error } = await supabase.from('events').update(updates).eq('id', id);
      if (error) throw error;
      setEvent(e => ({ ...e, ...updates }));
      setEditingInfo(false);
      if (isAvailable('google_calendar')) syncEventToGoogleCalendar(id);
      toast.success('Informations enregistrées');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingInfo(false);
    }
  }

  function startEditName() {
    setNameInput(event.name ?? '');
    setNameErr('');
    setEditingName(true);
  }

  async function saveEventName() {
    const name = nameInput.trim();
    setSavingName(true);
    setNameErr('');
    try {
      const { error } = await supabase.from('events').update({ name }).eq('id', id);
      if (error) throw error;
      setEvent(e => ({ ...e, name }));
      setEditingName(false);
      if (isAvailable('google_calendar')) syncEventToGoogleCalendar(id);
    } catch (err) {
      setNameErr(err.message);
    } finally {
      setSavingName(false);
    }
  }

  function handleReviewed(action, feedback) {
    setDesign(d => ({ ...d, status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), review_feedback: action === 'reject' ? feedback : null }));
    if (action === 'reject') setEvent(e => ({ ...e, status: 'active' }));
    // La revue écrit une ligne design_approved / design_rejected (statut « error » si Brevo refuse).
    getEmailLogs(id).then(setEmailLogs).catch(() => {});
  }

  // ── Loading ──
  if (loading) return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-4 w-24 mb-6" />
      <Skeleton className="h-8 w-64 mb-3" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
      <Skeleton className="h-10 rounded-xl mb-6" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    </div>
  );

  if (!event) return (
    <div className="p-8 text-center text-gray-500">
      Événement introuvable.{' '}
      <button onClick={() => navigate(-1)} className="text-primary underline">Retour</button>
    </div>
  );

  const formEnabled  = event.form_config?.enabled === true;
  const currentPb    = photobooths.find(p => p.id === selectedPb);

  // Quota d'impressions : consommées / max autorisé pour l'événement (config kiosk)
  const printMax     = kioskCfg?.result?.max_prints_per_event ?? null;
  const printUsed    = stats.printCopies;
  const printPct     = printMax ? Math.min(100, Math.round((printUsed / printMax) * 100)) : 0;
  const printColor   = printPct >= 90 ? 'bg-red-500' : printPct >= 75 ? 'bg-amber-500' : 'bg-violet-500';

  // Machine en ligne si vue récemment (heartbeat kiosk toutes les 2 min → tolérance 5 min)
  const machineOnline = currentPb?.last_seen_at
    ? (Date.now() - new Date(currentPb.last_seen_at).getTime()) < 5 * 60 * 1000
    : false;
  const printerInfo   = currentPb ? (PRINTER_STATUS[currentPb.printer_status] ?? null) : null;
  const cameraInfo    = currentPb ? (CAMERA_STATUS[currentPb.camera_status] ?? null) : null;

  // Statut calculé depuis status + dates (active/archived uniquement côté DB)
  function computeEventStatus(ev) {
    if (ev.status === 'archived') {
      return { label: 'Archivé', color: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-400',    pulse: false };
    }
    const now   = new Date();
    const start = ev.start_date ? new Date(ev.start_date) : null;
    const end   = ev.end_date   ? new Date(ev.end_date)   : null;
    if (start && start > now) {
      return { label: 'À venir',  color: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-500',     pulse: false };
    }
    if (end && end < now) {
      return { label: 'Terminé',  color: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   pulse: false };
    }
    return   { label: 'En cours', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', pulse: true  };
  }
  const statusInfo = computeEventStatus(event);
  const mediaPurge = mediaPurgeInfo(event);

  function fmtDate(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Tab config
  const TABS = [
    {
      id: 'general',
      label: 'Général',
      icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    },
    {
      id: 'template',
      label: 'Template',
      icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    },
    {
      id: 'accueil',
      label: 'Accueil',
      icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    },
    {
      id: 'apparence',
      label: 'Apparence',
      icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01',
    },
    {
      id: 'capture',
      label: 'Capture',
      icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z',
    },
    {
      id: 'questionnaire',
      label: 'Questionnaire',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    },
    {
      id: 'impression',
      label: 'Impression',
      icon: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
    },
    {
      id: 'partage',
      label: 'Partage',
      icon: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
    },
  ];

  const visibleTabs = TABS.filter(tab => tabAvailable(tab.id));
  // Onglet d'une fonctionnalité désactivée (lien ?tab=…) : retour sur Général.
  const currentTab = tabAvailable(activeTab) ? activeTab : 'general';

  const inputCls = 'w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition bg-card';
  const rowCls   = 'flex items-center justify-between py-3 border-b border-gray-50 last:border-0';
  const labelCls = 'text-sm text-gray-700';

  return (
    <div className="min-h-full bg-muted/30">

      {/* ── Header ── */}
      <div className="bg-card border-b border-gray-200 px-4 sm:px-8 pt-4 sm:pt-6 pb-0">
        {/* Back + actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
          <button onClick={() => navigate('/admin/events')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronLeft className="w-4 h-4" />
            Événements
          </button>
          <div className="flex items-center gap-2">
            {event.status === 'active' && (
              <Button variant="outline" size="sm" onClick={handleArchive}>
                Archiver
              </Button>
            )}
            <Button size="sm" onClick={handleDuplicate} disabled={duplicating}>
              {duplicating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {duplicating ? 'Duplication…' : 'Dupliquer'}
            </Button>
          </div>
        </div>

        {/* Event name + status */}
        <div className="flex items-center gap-3 mb-5">
          {editingName ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEventName(); if (e.key === 'Escape') setEditingName(false); }}
                placeholder="Nom de l'événement"
                autoFocus
                className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-primary focus:border-primary outline-none px-0.5 min-w-[18rem]"
              />
              <Button size="sm" onClick={saveEventName} disabled={savingName}>
                {savingName && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {savingName ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingName(false)} disabled={savingName}>Annuler</Button>
              {nameErr && <span className="text-xs text-destructive">{nameErr}</span>}
            </div>
          ) : (
            <>
              <button onClick={startEditName} title="Modifier le nom"
                className="group flex items-center gap-2 text-left">
                <h1 className="text-2xl font-bold text-gray-900">{event.name || <span className="italic text-gray-400">Sans nom</span>}</h1>
                <Pencil className="w-4 h-4 text-gray-300 group-hover:text-primary transition-colors shrink-0" />
              </button>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${statusInfo.color}`}>
                <span className="relative flex h-1.5 w-1.5">
                  {statusInfo.pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${statusInfo.dot} opacity-60`} />}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusInfo.dot}`} />
                </span>
                {statusInfo.label}
              </span>
              {event.access_code && (
                <button
                  onClick={() => { navigator.clipboard?.writeText(event.access_code); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1500); }}
                  title="Copier le code d'accès"
                  className="group inline-flex items-center gap-1.5">
                  <code className="bg-primary/10 text-primary px-2 py-0.5 rounded font-mono text-xs font-bold tracking-widest group-hover:bg-primary/15 transition-colors">
                    {event.access_code}
                  </code>
                  <span className="text-[11px] text-gray-400 group-hover:text-primary transition-colors">
                    {codeCopied ? '✓ Copié' : 'Copier'}
                  </span>
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-0 -mx-4 sm:-mx-8 border-t border-gray-100">
          {/* Dates */}
          <div className="px-4 sm:px-8 py-4 flex items-start gap-3 border-r border-b lg:border-b-0 border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Dates</p>
              {event.start_date ? (
                <p className="text-sm font-semibold text-gray-800 leading-tight">
                  {fmtDate(event.start_date)}
                  {event.end_date && event.end_date !== event.start_date && <> → {fmtDate(event.end_date)}</>}
                </p>
              ) : <p className="text-sm text-gray-400 italic">Non définies</p>}
              <p className="text-xs text-gray-400 mt-0.5">
                {event.expires_at ? `Expire le ${fmtDate(event.expires_at)}` : 'Pas d\'expiration'}
              </p>
              {mediaPurge.purgedAt && (
                <p className="text-xs text-amber-700 mt-0.5">Fichiers supprimés le {fmtDate(mediaPurge.purgedAt)}</p>
              )}
            </div>
          </div>

          {/* Impressions */}
          <div className="px-4 sm:px-8 py-4 flex items-start gap-3 border-r border-b lg:border-b-0 border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Impressions</p>
              <p className="text-sm font-semibold text-gray-800 leading-tight">
                {printUsed}
                {printMax != null && <span className="text-gray-400 font-normal"> / {printMax}</span>}
              </p>
              {printMax != null ? (
                <div className="mt-1.5">
                  <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${printColor} transition-all`} style={{ width: `${printPct}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{Math.max(0, printMax - printUsed)} restantes</p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">Pas de quota défini</p>
              )}
            </div>
          </div>

          {/* Photos */}
          <div className="px-4 sm:px-8 py-4 flex items-start gap-3 border-r border-b lg:border-b-0 border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Photos</p>
              <p className="text-sm font-semibold text-gray-800 leading-tight">{stats.photosCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">capturées</p>
            </div>
          </div>

          {/* Machine */}
          <div className="px-4 sm:px-8 py-4 flex items-start gap-3 border-r border-b lg:border-b-0 border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Machine</p>
              {currentPb ? (
                <>
                  <p className="text-sm font-semibold text-gray-800 leading-tight flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: currentPb.color }} />
                    <span className="truncate">{currentPb.label ?? currentPb.machine_id}</span>
                  </p>
                  <p className="text-xs mt-0.5 flex items-center gap-1.5">
                    <span className="relative flex h-1.5 w-1.5">
                      {machineOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
                      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${machineOnline ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    </span>
                    <span className={machineOnline ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                      {machineOnline ? 'En ligne' : currentPb.last_seen_at ? `Vue ${timeAgo(currentPb.last_seen_at)}` : 'Jamais vue'}
                    </span>
                  </p>
                  {printerInfo && (
                    <p className="text-xs mt-1 flex items-center gap-1.5">
                      <svg className="w-3 h-3 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${printerInfo.dot}`} />
                      <span className={printerInfo.text}>Imprimante : {printerInfo.label}</span>
                    </p>
                  )}
                  {cameraInfo && (
                    <p className="text-xs mt-1 flex items-center gap-1.5">
                      <svg className="w-3 h-3 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cameraInfo.dot}`} />
                      <span className={cameraInfo.text}>Appareil photo : {cameraInfo.label}</span>
                    </p>
                  )}
                </>
              ) : <p className="text-sm text-gray-400 italic">Aucune</p>}
            </div>
          </div>

          {/* Liens */}
          <div className="px-4 sm:px-8 py-4 col-span-2 lg:col-span-1">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Liens d'accès</p>
            <div className="space-y-2">
              {[
                ...(isAvailable('client_design') ? [{
                  key: 'template',
                  label: 'Template',
                  url: `${APP_URL}/e/${event.access_code}`,
                  iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
                  iconColor: 'text-blue-500',
                }] : []),
                ...(isAvailable('gallery') ? [{
                  key: 'photos',
                  label: 'Photos',
                  url: `${APP_URL}/photos/${event.access_code}`,
                  iconPath: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z',
                  iconColor: 'text-emerald-500',
                }] : []),
                ...(event.form_config?.audio_enabled && isAvailable('audio_guestbook') ? [{
                  key: 'audio',
                  label: 'Livre d\'or',
                  url: `${APP_URL}/audio/${event.access_code}`,
                  iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
                  iconColor: 'text-amber-500',
                }] : []),
              ].map(({ key, label, url, iconPath, iconColor }) => (
                <div key={key} className="flex items-center gap-2">
                  <svg className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    {iconPath.split('M').filter(Boolean).map((d, i) => (
                      <path key={i} strokeLinecap="round" strokeLinejoin="round" d={`M${d}`} />
                    ))}
                  </svg>
                  <span className="text-xs font-medium text-gray-700 shrink-0">{label}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => copyUrl(key, url)} title="Copier le lien"
                      className="text-gray-400 hover:text-primary transition-colors">
                      {copiedLink === key ? (
                        <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <rect x="9" y="9" width="13" height="13" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      )}
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="text-gray-300 hover:text-primary transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tab nav ── */}
        <Tabs value={currentTab} onValueChange={setActiveTab}>
          <TabsList className="flex gap-0 -mx-4 sm:-mx-8 border-t border-gray-100 mt-0 overflow-x-auto justify-start h-auto p-0 bg-transparent rounded-none text-muted-foreground">
            {visibleTabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 border-transparent rounded-none shadow-none whitespace-nowrap text-gray-500 hover:text-gray-800 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  {tab.icon.split(' ').length > 1
                    ? tab.icon.split('M').filter(Boolean).map((d, i) => (
                      <path key={i} strokeLinecap="round" strokeLinejoin="round" d={`M${d}`} />
                    ))
                    : <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                  }
                </svg>
                {tab.label}
                {tab.id === 'template' && design?.status === 'submitted' && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* ── Tab content ── */}
      <div className="px-4 sm:px-8 py-6 space-y-4 max-w-4xl">

        {/* ════ GÉNÉRAL ════ */}
        {currentTab === 'general' && (
          <>
            {/* Feature toggles */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Options générales</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <FeatureCard
                  iconPath="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  label="Photo" descOn="Capture photo active" colorBg="bg-blue-100" colorIcon="text-blue-600" colorOn="bg-blue-500"
                  checked={true} onChange={() => {}} locked={false}
                />
                <FeatureCard
                  iconPath="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  label="Email" descOn="Envoi par email activé" descOff="Envoi par email désactivé"
                  colorBg="bg-violet-100" colorIcon="text-violet-600" colorOn="bg-violet-600"
                  checked={kioskCfg?.email?.enabled ?? false}
                  onChange={v => setKiosk('email.enabled', v)}
                />
                <FeatureCard
                  iconPath="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  label="QR Code" descOn="Partage QR activé" descOff="Partage QR désactivé"
                  colorBg="bg-primary/15" colorIcon="text-primary" colorOn="bg-primary"
                  checked={kioskCfg?.result?.share?.qr ?? true}
                  onChange={v => setKiosk('result.share.qr', v)}
                />
                {isAvailable('audio_guestbook') && <FeatureCard
                  iconPath="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  label="Livre d'or" descOn="Livre d'or audio activé" descOff="Livre d'or désactivé"
                  colorBg="bg-amber-100" colorIcon="text-amber-600" colorOn="bg-amber-500"
                  checked={event.form_config?.audio_enabled === true}
                  onChange={async v => {
                    try {
                      await updateEventFormConfig(event.id, { ...event.form_config, audio_enabled: v });
                      setEvent(e => ({ ...e, form_config: { ...e.form_config, audio_enabled: v } }));
                    } catch {}
                  }}
                />}
                <FeatureCard
                  iconPath="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  label="RGPD" descOn="Consentement demandé" descOff="Pas de consentement"
                  colorBg="bg-emerald-100" colorIcon="text-emerald-600" colorOn="bg-emerald-500"
                  checked={kioskCfg?.rgpd?.enabled ?? false}
                  onChange={v => setKiosk('rgpd.enabled', v)}
                />
              </div>
              {(kioskCfg?.email?.enabled !== (event.form_config?.kiosk?.email?.enabled ?? false)
                || kioskCfg?.result?.share?.qr !== (event.form_config?.kiosk?.result?.share?.qr ?? true)
                || kioskCfg?.rgpd?.enabled !== (event.form_config?.kiosk?.rgpd?.enabled ?? false)) && (
                <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />
              )}
            </div>

            {/* Galerie invités */}
            {isAvailable('gallery') && (
              <GallerySection
                event={event}
                onSaved={gallery => setEvent(e => ({ ...e, form_config: { ...e.form_config, gallery } }))}
              />
            )}

            {/* Facturation (module « invoicing ») */}
            <ModuleSlot
              name="event.billing"
              event={event}
              onSynced={amounts => setEvent(e => ({ ...e, ...amounts }))}
            />

            {/* Mise à disposition */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Mise à disposition</h2>
              <Card className="rounded-2xl shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-800">Informations de l'événement</span>
                  <div className="flex items-center gap-2">
                    {!editingInfo ? (
                      <Button variant="outline" size="sm" className="h-8" onClick={startEditInfo}>
                        <Pencil className="w-3.5 h-3.5" />
                        Modifier
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setEditingInfo(false)} disabled={savingInfo}>Annuler</Button>
                        <Button size="sm" className="h-8" onClick={saveEventInfo} disabled={savingInfo}>
                          {savingInfo && <Loader2 className="w-3 h-3 animate-spin" />}
                          {savingInfo ? 'Enregistrement…' : 'Enregistrer'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {editingInfo ? (
                  <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { key: 'name',         label: "Nom de l'événement", type: 'text',  placeholder: 'Ex : Mariage Marie & Pierre' },
                      { key: 'client_name',  label: 'Nom du client',      type: 'text',  placeholder: 'Marie & Pierre' },
                      { key: 'client_email', label: 'Email',              type: 'email', placeholder: 'client@example.com' },
                    ].map(({ key, label, type, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                        <input type={type} value={infoForm[key] ?? ''} onChange={e => setInfoForm(f => ({ ...f, [key]: e.target.value }))}
                          placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && saveEventInfo()} className={inputCls} />
                      </div>
                    ))}
                    <DateTimePicker label="Début de l'événement" value={infoForm.start_date ?? ''}
                      onChange={v => setInfoForm(f => {
                        const end = f.end_date && f.end_date < v ? v : f.end_date;
                        return { ...f, start_date: v, end_date: end, expires_at: f.expires_at || mediaExpiryDefault(end) };
                      })}
                      placeholder="Choisir une date de début" />
                    <DateTimePicker label="Fin de l'événement" value={infoForm.end_date ?? ''}
                      min={infoForm.start_date || undefined}
                      onChange={v => setInfoForm(f => ({ ...f, end_date: v, expires_at: f.expires_at || mediaExpiryDefault(v) }))}
                      placeholder="Choisir une date de fin" />
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Expiration des liens photos &amp; audio</label>
                      <DateTimePicker showTime={false} value={infoForm.expires_at ?? ''}
                        onChange={v => setInfoForm(f => ({ ...f, expires_at: v }))}
                        placeholder="Choisir une date d'expiration" />
                      <p className="text-[11px] text-gray-400 mt-1">
                        Défaut : fin d'événement + 2 mois. Le lien du modèle expire, lui, à la fin de l'événement.
                        Les photos et messages audio sont supprimés 30 jours après cette date.
                      </p>
                      {mediaPurge.purgedAt && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1.5">
                          Les photos et messages audio ont été supprimés le {fmtDate(mediaPurge.purgedAt)}.
                          Prolonger le lien ne les restaure pas : les galeries resteront vides.
                        </p>
                      )}
                    </div>
                    {isAvailable('delivery_email') && <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Galerie photos (livraison)</label>
                      <input type="url" value={infoForm.photo_gallery_url ?? ''} onChange={e => setInfoForm(f => ({ ...f, photo_gallery_url: e.target.value }))}
                        placeholder="https://…/galerie" onKeyDown={e => e.key === 'Enter' && saveEventInfo()} className={inputCls} />
                    </div>}
                    {isAvailable('delivery_email') && <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Pièce jointe de la livraison (PDF, ex. facture)</label>
                      <input type="url" value={infoForm.delivery_attachment_url ?? ''} onChange={e => setInfoForm(f => ({ ...f, delivery_attachment_url: e.target.value }))}
                        placeholder="https://…/facture.pdf" onKeyDown={e => e.key === 'Enter' && saveEventInfo()} className={inputCls} />
                    </div>}
                  </div>
                ) : (
                  <dl className="divide-y divide-gray-50">
                    {[
                      { label: "Nom", value: event.name || <span className="italic text-amber-500 text-xs">Non défini</span>, icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
                      { label: "Client", value: event.client_name ?? '—', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
                      { label: "Email", value: event.client_email ?? '—', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
                      { label: "Période", value: event.start_date
                          ? (event.end_date && event.end_date !== event.start_date
                              ? `${fmtDate(event.start_date)} → ${fmtDate(event.end_date)}`
                              : fmtDate(event.start_date))
                          : '—',
                        icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
                      { label: "Formats", value: (event.allowed_formats ?? []).join(', ') || '—', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z' },
                      { label: "Lien du modèle", value: event.end_date ? `Expire le ${fmtDate(event.end_date)} (fin d'événement)` : 'Sans expiration', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
                      { label: "Liens photos & audio",
                        value: (
                          <>
                            {event.expires_at ? `Expire le ${fmtDate(event.expires_at)}` : 'Aucune'}
                            {mediaPurge.purgedAt && (
                              <span className="block text-xs font-normal text-amber-700 mt-0.5">
                                Fichiers supprimés le {fmtDate(mediaPurge.purgedAt)}
                                {mediaPurge.extendedAfterPurge && ' · lien prolongé après la suppression : les fichiers supprimés ne sont pas restaurés'}
                              </span>
                            )}
                          </>
                        ),
                        icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
                      isAvailable('delivery_email') && { label: "Galerie photos",
                        value: event.photo_gallery_url
                          ? <a href={event.photo_gallery_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary hover:underline break-all">Ouvrir la galerie</a>
                          : '—',
                        icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                      isAvailable('delivery_email') && { label: "Pièce jointe",
                        value: event.delivery_attachment_url
                          ? <a href={event.delivery_attachment_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary hover:underline break-all">Ouvrir le document</a>
                          : '—',
                        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
                    ].filter(Boolean).map(({ label, value, icon }) => (
                      <div key={label} className="flex items-center gap-3 px-5 py-3">
                        <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                        </svg>
                        <dt className="text-xs font-medium text-gray-400 w-36 shrink-0 leading-tight">{label}</dt>
                        <dd className="text-sm text-gray-800 font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            </div>

            {/* Retrait / retour de la borne (LAB-72) */}
            <ModuleSlot name="event.logistics" eventId={event.id} />

            {/* Photobooth */}
            <div>
              <Card className="p-5 rounded-2xl shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Photobooth assigné</h3>
                    <p className="text-xs text-gray-400">Code couleur dans le planning</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentPb && <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: currentPb.color }} />}
                  <Select value={selectedPb || 'none'} onValueChange={v => handlePhotoboothChange(v === 'none' ? '' : v)} disabled={savingPb}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Aucun photobooth —</SelectItem>
                      {kioskChoices(photobooths, selectedPb).map(pb => <SelectItem key={pb.id} value={pb.id}>{pb.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </Card>
            </div>

            {/* Envoi de l'événement sur la borne (LAB-245) */}
            <EventKioskPushCard
              event={event}
              licenses={photobooths}
              designApproved={design?.status === 'approved'}
              onLicenseUpdate={handleLicenseUpdate}
              onRefresh={refreshPhotobooths}
            />

            {/* Export .pola */}
            <Card className="p-5 rounded-2xl shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Fichier hors-ligne (.pola)</h3>
                    <p className="text-xs text-gray-400">
                      {design?.status === 'approved'
                        ? 'Tout l’événement pour une borne sans réseau : réglages, design approuvé, fonds, contact.'
                        : 'Disponible une fois le design du client approuvé (sinon la borne imprimerait sans cadre).'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {exportMsg && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">{exportMsg}</span>}
                  <Button variant="outline" onClick={handleExportPola} disabled={exporting || design?.status !== 'approved'} className="rounded-xl">
                    {exporting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {exporting ? 'Génération…' : 'Télécharger .pola'}
                  </Button>
                </div>
              </div>
              {exportError && (
                <p className="mt-3 text-sm rounded-xl px-3 py-2 bg-red-50 text-red-700">{exportError}</p>
              )}
            </Card>

            {/* Livraison post-événement — photos, liens des fonctionnalités, avis, pièce jointe (L4) */}
            {isAvailable('delivery_email') && <Card className="p-5 rounded-2xl shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800">Email de livraison</h3>
                    <p className="text-xs text-gray-400 truncate">Galerie photos, liens ajoutés, avis et pièce jointe</p>
                  </div>
                </div>
                <Button onClick={handleSendDelivery} disabled={deliverySending || !event.client_email || !event.photo_gallery_url}
                  className="rounded-xl shrink-0">
                  {deliverySending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {deliverySending ? 'Envoi…' : 'Envoyer la livraison'}
                </Button>
              </div>
              {deliveryMsg === 'ok' && <p className="text-xs text-emerald-600 mt-2">✓ Livraison envoyée à {event.client_email}</p>}
              {deliveryMsg && deliveryMsg !== 'ok' && <p className="text-xs text-destructive mt-2">{deliveryMsg}</p>}
              {!event.client_email && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">Renseigne l'email du client pour pouvoir envoyer la livraison.</p>
              )}
              {event.client_email && !event.photo_gallery_url && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">Renseigne le lien de la galerie photos (ci-dessus) pour pouvoir envoyer la livraison.</p>
              )}
            </Card>}

            {/* Bilan client — page de bilan à envoyer (LAB-238) */}
            {isAvailable('event_report') && <EventReportCard event={event} org={org} appUrl={APP_URL} />}
          </>
        )}

        {/* ════ TEMPLATE ════ */}
        {currentTab === 'template' && (
          <>
            {/* Email de création du template — invitation client */}
            <Card className="p-5 rounded-2xl shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800">Email de création du template</h3>
                    <p className="text-xs text-gray-400 truncate">{event.client_email ?? 'Aucun email renseigné'}</p>
                  </div>
                </div>
                <Button variant="outline" onClick={handleResend} disabled={resending || !event.client_email}
                  className="rounded-xl shrink-0">
                  {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {resending ? 'Envoi…' : 'Envoyer le lien au client'}
                </Button>
              </div>
              {resendMsg === 'ok' && <p className="text-xs text-emerald-600 mt-2">✓ Envoyé à {event.client_email}</p>}
              {resendMsg && resendMsg !== 'ok' && <p className="text-xs text-destructive mt-2">{resendMsg}</p>}
              {!event.client_email && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">Renseigne l'email du client dans l'onglet Général pour pouvoir envoyer le lien.</p>
              )}
            </Card>

            {/* Emails envoyés — suivi Brevo de tous les emails de l'événement */}
            {emailLogs.length > 0 && (
              <Card className="p-5 rounded-2xl shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">
                  Emails envoyés <span className="text-gray-400 font-normal">({emailLogs.length})</span>
                </h3>
                <EmailLogList
                  logs={emailLogs}
                  onUpdated={(row) => setEmailLogs((prev) => prev.map((l) => (l.id === row.id ? row : l)))}
                />
              </Card>
            )}

            {/* Questionnaire avant l'édition : event_form_responses, rattaché à guest_form (spec open core). */}
            {isAvailable('guest_form') && (
              <>
                <FormToggle
                  event={event}
                  onSaved={enabled => setEvent(e => ({ ...e, form_config: { ...e.form_config, enabled } }))}
                />
                {formEnabled && <FormResponses eventId={event.id} />}
              </>
            )}
            <DesignSection design={design} event={event} onReviewed={handleReviewed} />
          </>
        )}

        {/* ════ ACCUEIL ════ */}
        {currentTab === 'accueil' && kioskCfg && (
          <>
            <Card className="p-5 rounded-2xl shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-800">Fond d'écran d'accueil</h2>
                  <p className="text-xs text-gray-400">Premier écran affiché sur le kiosk avant chaque session</p>
                </div>
              </div>
              <div className="flex items-center gap-5">
                <div className="w-32 h-20 rounded-xl border border-gray-200 overflow-hidden flex items-center justify-center shrink-0" style={{ background: KIOSK_CREAM }}>
                  {kioskCfg.home.background_url
                    ? <img src={kioskCfg.home.background_url} alt="Fond" className="w-full h-full object-cover" />
                    : <span className="text-xs text-gray-500 text-center leading-tight px-2">Fond crème<br/>par défaut</span>}
                </div>
                <div className="flex flex-col gap-2.5">
                  <label className="cursor-pointer">
                    <input type="file" accept={KIOSK_BG_ACCEPT} className="hidden" onChange={handleBgUpload} />
                    <span className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-input text-gray-700 hover:bg-accent hover:text-accent-foreground transition-colors ${bgUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                      {bgUploading
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Upload className="w-4 h-4" />}
                      {bgUploading ? 'Upload en cours…' : 'Choisir une image'}
                    </span>
                  </label>
                  {kioskCfg.home.background_url && (
                    <button onClick={() => setKiosk('home.background_url', null)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-destructive transition-colors">
                      <X className="w-3.5 h-3.5" />
                      Supprimer — garder le fond crème
                    </button>
                  )}
                  <p className="text-xs text-gray-400">Format recommandé : portrait 1080 × 1920 px · PNG ou JPG, 10 Mo au maximum</p>
                </div>
              </div>
            </Card>

            <KioskWelcomeCard kioskCfg={kioskCfg} setKiosk={setKiosk} eventName={event.name} rowCls={rowCls} labelCls={labelCls} />

            <KioskFormatsCard kioskCfg={kioskCfg} setKiosk={setKiosk} rowCls={rowCls} labelCls={labelCls} />

            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />
          </>
        )}

        {/* ════ APPARENCE ════ */}
        {currentTab === 'apparence' && kioskCfg && (
          <>
            {/* Boutons de l'écran de partage */}
            <Card className="p-5 rounded-2xl shadow-sm">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Boutons de l'écran de partage</h2>
              <p className="text-xs text-gray-400 mb-4">
                Boutons affichés sur l'écran de partage. Un bouton désactivé disparaît.
                Le bouton Email n'apparaît que si le partage par email est activé.
              </p>
              <div className="divide-y divide-gray-50">
                {RESULT_BUTTONS.map(btn => {
                  const b = kioskCfg.result?.buttons?.[btn.key] ?? {};
                  return (
                    <div key={btn.key} className={rowCls}>
                      <div className="flex-1 pr-4">
                        <p className={labelCls}>{btn.name}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Toggle
                          checked={b.enabled ?? true}
                          onChange={v => setKiosk(`result.buttons.${btn.key}.enabled`, v)}
                          colorOn="bg-violet-600" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
              La personnalisation de l'écran de saisie du code se configure dans{' '}
              <a href="/admin/settings" className="text-primary hover:underline font-medium">Paramètres globaux</a>
              {' '}— elle s'applique à tous les kiosks indépendamment de l'événement.
            </p>

            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />
          </>
        )}

        {/* ════ CAPTURE ════ */}
        {currentTab === 'capture' && kioskCfg && (
          <>
            <Card className="p-5 rounded-2xl shadow-sm">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Paramètres capture</h2>
              <div className="divide-y divide-gray-50">
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Effet miroir</p>
                    <p className="text-xs text-gray-400">Inverse l'image en temps réel (selfie)</p>
                  </div>
                  <Toggle checked={kioskCfg.capture.mirror} onChange={v => setKiosk('capture.mirror', v)} colorOn="bg-violet-600" />
                </div>
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Compte à rebours</p>
                    <p className="text-xs text-gray-400">Durée entre 1 et 10 secondes</p>
                  </div>
                  <Input type="number" min="1" max="10" value={kioskCfg.capture.countdown_seconds}
                    onChange={e => setKiosk('capture.countdown_seconds', Math.min(10, Math.max(1, Number(e.target.value))))}
                    className="w-24 text-center" />
                </div>
              </div>
            </Card>

            <KioskAnimatedCaptureCards kioskCfg={kioskCfg} setKiosk={setKiosk} rowCls={rowCls} labelCls={labelCls} />

            {/* ── Effets photo ── */}
            <Card className="p-5 rounded-2xl shadow-sm">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Effets photo</h2>
              <div className="divide-y divide-gray-50">
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Choix d'effet par l'invité</p>
                    <p className="text-xs text-gray-400">Affiche un écran de sélection après la capture</p>
                  </div>
                  <Toggle
                    checked={kioskCfg.effects?.user_can_choose ?? false}
                    onChange={v => setKiosk('effects.user_can_choose', v)}
                    colorOn="bg-violet-600"
                  />
                </div>
              </div>

              {(kioskCfg.effects?.user_can_choose) && (
                <div className="pt-4 border-t border-gray-50 mt-1">
                  <p className="text-xs font-medium text-gray-500 mb-3">Effets disponibles</p>
                  <div className="space-y-2">
                    {AVAILABLE_EFFECTS.map(effect => {
                      const current = kioskCfg.effects?.enabled_effects ?? ['none'];
                      const checked = current.includes(effect.id);
                      return (
                        <label key={effect.id} className="flex items-center gap-3 cursor-pointer py-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              const updated = e.target.checked
                                ? [...current.filter(x => x !== effect.id), effect.id]
                                : current.filter(x => x !== effect.id);
                              setKiosk('effects.enabled_effects', updated.length ? updated : ['none']);
                            }}
                            className="w-4 h-4 rounded accent-violet-600 cursor-pointer"
                          />
                          <span className="text-sm text-gray-700">{effect.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-5 rounded-2xl shadow-sm">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Consentement RGPD</h2>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Écran de consentement</p>
                  <p className="text-xs text-gray-400">Affiché avant chaque session photo</p>
                </div>
                <Toggle checked={kioskCfg.rgpd?.enabled ?? false} onChange={v => setKiosk('rgpd.enabled', v)} colorOn="bg-emerald-500" />
              </div>
              {kioskCfg.rgpd?.enabled && (
                <div className="pt-4">
                  <Label className="block text-xs text-gray-500 mb-2">Message affiché à l'invité</Label>
                  <Textarea value={kioskCfg.rgpd?.message ?? ''} onChange={e => setKiosk('rgpd.message', e.target.value)} rows={3}
                    className="resize-none"
                    placeholder="Texte de consentement RGPD..." />
                </div>
              )}
            </Card>

            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />

            <PhotoConsentsPanel event={event} licenses={photobooths} />
          </>
        )}

        {/* ════ IMPRESSION ════ */}
        {currentTab === 'impression' && kioskCfg && (
          <>
            <Card className="p-5 rounded-2xl shadow-sm">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Paramètres impression</h2>
              <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                <p className="text-xs text-amber-700">
                  Le nom de l'imprimante se configure dans <code className="font-mono bg-amber-100 px-1 rounded">appsettings.local.json</code> sur chaque PC kiosk. Le format papier est déduit automatiquement du template.
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Impression automatique</p>
                    <p className="text-xs text-gray-400">Lance l'impression dès la fin de la capture</p>
                  </div>
                  <Toggle checked={kioskCfg.result.auto_print} onChange={v => setKiosk('result.auto_print', v)} colorOn="bg-violet-600" />
                </div>
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Afficher le compteur restant</p>
                    <p className="text-xs text-gray-400">Visible sur l'écran résultat</p>
                  </div>
                  <Toggle checked={kioskCfg.result.show_remaining_prints} onChange={v => setKiosk('result.show_remaining_prints', v)} colorOn="bg-violet-600" />
                </div>
                <div className={rowCls}>
                  <p className={labelCls}>Max impressions / événement</p>
                  <Input type="number" min="1" value={kioskCfg.result.max_prints_per_event}
                    onChange={e => setKiosk('result.max_prints_per_event', Number(e.target.value))}
                    className="w-28 text-center" />
                </div>
                <div className={rowCls}>
                  <p className={labelCls}>Max impressions / photo</p>
                  <Input type="number" min="1" value={kioskCfg.result.max_prints_per_photo}
                    onChange={e => setKiosk('result.max_prints_per_photo', Number(e.target.value))}
                    className="w-28 text-center" />
                </div>
              </div>
            </Card>

            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />

            <PrintHistorySection eventId={event.id} />
          </>
        )}

        {/* ════ QUESTIONNAIRE ════ */}
        {currentTab === 'questionnaire' && kioskCfg && (
          <>
            <GuestExportReminderBanner reminder={guestSummary?.event_id === event.id ? guestExportReminder(guestSummary, event) : null} />
            <KioskQuestionnaireSettings
              questionnaire={kioskCfg.questionnaire}
              set={(path, value) => setKiosk(`questionnaire.${path}`, value)}
            />
            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />
            <GuestResponsesPanel
              event={event}
              onExported={(at) => setEvent((e) => ({ ...e, guest_responses_exported_at: at }))}
              onSummary={setGuestSummary}
            />
          </>
        )}

        {/* ════ PARTAGE ════ */}
        {currentTab === 'partage' && kioskCfg && (
          <>
            <Card className="p-5 rounded-2xl shadow-sm">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Partage kiosk</h2>
              <div className="divide-y divide-gray-50">
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>QR code galerie</p>
                    <p className="text-xs text-gray-400">Affiché sur l'écran résultat pour télécharger la photo</p>
                  </div>
                  <Toggle checked={kioskCfg.result.share?.qr ?? true} onChange={v => setKiosk('result.share.qr', v)} colorOn="bg-primary" />
                </div>
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Envoi par email</p>
                    <p className="text-xs text-gray-400">L'invité peut entrer son email pour recevoir la photo</p>
                  </div>
                  <Toggle checked={kioskCfg.email?.enabled ?? false} onChange={v => setKiosk('email.enabled', v)} colorOn="bg-violet-600" />
                </div>
                <div className={rowCls}>
                  <div>
                    <p className={labelCls}>Retour auto à l'accueil</p>
                    <p className="text-xs text-gray-400">Après cette durée sans interaction sur l'écran de partage, le kiosk revient à l'accueil (0 = désactivé)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input type="number" min="0" max="600" value={kioskCfg.result?.auto_return_seconds ?? 30}
                      onChange={e => setKiosk('result.auto_return_seconds', Math.min(600, Math.max(0, Number(e.target.value))))}
                      className="w-24 text-center" />
                    <span className="text-xs text-gray-400">sec</span>
                  </div>
                </div>
              </div>

              {kioskCfg.email?.enabled && (
                <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Configuration email</p>
                  <p className="text-xs text-gray-400">Variables : <code className="bg-gray-100 px-1 rounded">{'{event_name}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{photo_url}'}</code></p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Nom de l'expéditeur</label>
                      <input type="text" value={kioskCfg.email?.sender_name ?? ''} onChange={e => setKiosk('email.sender_name', e.target.value)}
                        placeholder={companyName} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email de l'expéditeur</label>
                      <input type="email" value={kioskCfg.email?.sender_email ?? ''} onChange={e => setKiosk('email.sender_email', e.target.value)}
                        placeholder="photos@exemple.fr" className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Objet</label>
                    <input type="text" value={kioskCfg.email?.subject ?? ''} onChange={e => setKiosk('email.subject', e.target.value)}
                      placeholder="Vos photos — {event_name}" className={inputCls} />
                  </div>
                  <div>
                    <Label className="block text-xs text-gray-600 mb-1">Message</Label>
                    <Textarea value={kioskCfg.email?.message ?? ''} onChange={e => setKiosk('email.message', e.target.value)} rows={4}
                      placeholder="Bonjour,&#10;&#10;Retrouvez votre photo en cliquant sur le lien ci-dessous."
                      className="resize-none" />
                  </div>
                </div>
              )}
            </Card>

            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />

            {/* Livre d'or audio (module « audio_guestbook ») */}
            <ModuleSlot
              name="event.audio"
              event={event}
              onSaved={audio_enabled => setEvent(e => ({ ...e, form_config: { ...e.form_config, audio_enabled } }))}
            />
          </>
        )}

      </div>
    </div>
  );
}
