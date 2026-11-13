import { useEffect, useState } from 'react';
import { X, Plus, Upload, Loader2 } from 'lucide-react';
import { supabase, updateGlobalFormConfig, updateFormatBleed, saveBusinessProfile, getKioskSetupConfig, saveKioskSetupConfig, uploadKioskGlobalSetupBackground, uploadOrgLogo, removeOrgLogo } from '../../lib/supabase';
import { FORMAT_LIST } from '../../utils/formats';
import { normalizeSetupConfig, setupConfigToSave, SETUP_BG_CREAM, SETUP_BG_IMAGE, KIOSK_CREAM } from '../../lib/kioskSetupScreen';
import ModuleSlot from '../../components/ModuleSlot';
import PasswordSettingsCard from '../../components/admin/PasswordSettingsCard';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Card } from '../../components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { isChoiceType } from '../../utils/formQuestions';
import QuestionListEditor from '../../components/QuestionListEditor';
import { BOOKING_BANNER_SETTING, isBookingBannerEnabled } from '../../lib/galleryBanner';
import { businessProfileForm, profilePatch } from '../../lib/businessProfile';
import { identityErrors, identityForm, identitySave } from '../../lib/orgIdentity';
import { clientEmailsSave, clientEmailsSummary, designRemindersForm } from '../../lib/clientEmails';
import { DEFAULT_FOR_OPTIONS } from '../../lib/eventReportAdmin';
import { useFeatures } from '../../hooks/useFeatures';
import { useAppAdmin } from '../../hooks/useAppAdmin';
import { KIOSK_BG_ACCEPT } from '../../lib/kioskBackground';
import { toast } from 'sonner';
import { BRAND } from '../../lib/instanceBrand';

const DEFAULT_QUESTIONS = [
  { id: 'q1', label: `Comment avez-vous connu ${BRAND.name} ?`, type: 'select', required: false, options: [
    'Instagram',
    'Facebook',
    'Google / recherche web',
    'Bouche-à-oreille',
    'Recommandation d\'un professionnel (traiteur, wedding planner…)',
    'Déjà vu à un événement',
    'Autre',
  ] },
  { id: 'q_event_type', label: 'Quel type d\'événement ?', type: 'select', required: false, options: [
    'Mariage',
    'Anniversaire',
    'Baptême / communion',
    'Soirée entreprise / séminaire',
    'Soirée privée',
    'Autre',
  ] },
  { id: 'q2', label: 'Qui est votre photographe ? (Cela nous permet d\'avoir des photos de nos photobooth pour notre communication.)',        type: 'text', required: false },
  { id: 'q3', label: 'Merci de préciser le lieu exact de l\'évènement',                                                                       type: 'text', required: true  },
  { id: 'q4', label: 'Un numéro de téléphone pour vous joindre le jour J',                                                                    type: 'tel',  required: false },
];

function FormConfigSection({ org }) {
  const initCfg   = org.form_config ?? { enabled: false, questions: DEFAULT_QUESTIONS };
  const [enabled,   setEnabled]   = useState(initCfg.enabled ?? false);
  const [questions, setQuestions] = useState(
    initCfg.questions?.length ? initCfg.questions : DEFAULT_QUESTIONS
  );
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const cleaned = questions.map((q) =>
        isChoiceType(q.type)
          ? { ...q, options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) }
          : q
      );
      await updateGlobalFormConfig(org.id, { enabled, questions: cleaned });
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-800">Formulaire pré-édition</h2>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {enabled
          ? 'Le formulaire sera affiché au client avant d\'accéder à l\'éditeur.'
          : 'Désactivé — le client accède directement à l\'éditeur sans questions.'}
      </p>

      {enabled && <QuestionListEditor questions={questions} onChange={setQuestions} />}

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

function BleedSection({ org }) {
  const initBleed = org.format_bleed ?? {};
  const [bleed,    setBleed]    = useState(
    () => Object.fromEntries(FORMAT_LIST.map((f) => [f.id, initBleed[f.id] ?? f.bleedMm ?? 3]))
  );
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateFormatBleed(org.id, bleed);
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Zones perdues (fond de coupe)</h2>
      <p className="text-sm text-gray-500 mb-5">
        Définissez la largeur de la zone perdue en mm pour chaque format.
        Un guide rouge délimite cette zone dans l'éditeur — le contenu important doit rester à l'intérieur.
      </p>

      <div className="space-y-3 mb-4">
        {FORMAT_LIST.map((fmt) => (
          <div key={fmt.id} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-800">{fmt.label}</p>
              <p className="text-xs text-gray-400">{fmt.subtitle}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={bleed[fmt.id] ?? fmt.bleedMm ?? 3}
                onChange={(e) => setBleed((prev) => ({ ...prev, [fmt.id]: parseFloat(e.target.value) || 0 }))}
                className="w-20 h-9 text-center"
              />
              <span className="text-sm text-gray-400">mm</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

const daysInputCls = 'w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center outline-none focus:border-primary';

/** Un email automatique : titre, explication, interrupteur, puis ses réglages quand il est actif. */
function ClientEmailRow({ step, title, help, checked, onChange, children, footer }) {
  return (
    <div className="p-3 sm:p-4 rounded-xl border border-gray-200">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-muted text-gray-600 text-xs font-semibold flex items-center justify-center mt-0.5">{step}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{help}</p>
        </div>
        <MiniToggle checked={checked} onChange={onChange} />
      </div>
      {checked && children && <div className="mt-3 pl-9 space-y-3">{children}</div>}
      {footer && <div className="mt-3 pl-9">{footer}</div>}
    </div>
  );
}

/** Numéro du modèle d'email Brevo, avec ses variables repliées. */
function BrevoTemplateField({ id, label, value, onChange, help, variables }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" min={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder="vide = email intégré à l'app" className="sm:w-64" />
      <p className="text-xs text-gray-400">{help}</p>
      <details className="text-xs text-gray-400">
        <summary className="cursor-pointer select-none">Variables disponibles dans Brevo</summary>
        <p className="mt-1 break-words">{variables.map((v) => `{{ params.${v} }}`).join(', ')}</p>
      </details>
    </div>
  );
}

// LAB-262 : les emails envoyés au client sans action de l'admin, dans l'ordre de son parcours,
// chacun avec son délai et son modèle Brevo (avant : éparpillés dans trois cartes).
function ClientEmailsSection({ org }) {
  const [profile,   setProfile]   = useState(() => businessProfileForm(org.business_profile));
  const [accessTpl, setAccessTpl] = useState(org.brevo_access_template_id ?? '');
  const [reminders, setReminders] = useState(() => designRemindersForm(org.design_reminders));
  const [saving,    setSaving]    = useState(false);

  const setAuto = (key, field) => (value) => setProfile((p) => ({ ...p, [key]: { ...p[key], [field]: value } }));
  const setReminder = (field, value) => setReminders((r) => ({ ...r, [field]: value }));
  const updateMilestone = (idx, value) => setReminder('milestones', reminders.milestones.map((m, i) => (i === idx ? value : m)));
  const summary = clientEmailsSummary({ profile, reminders });

  async function handleSave() {
    setSaving(true);
    try {
      const { businessPatch, columns } = clientEmailsSave({ profile, accessTemplateId: accessTpl, reminders });
      await saveBusinessProfile(org.id, businessPatch, columns);
      setReminders(designRemindersForm(columns.design_reminders));
      setAccessTpl(columns.brevo_access_template_id ?? '');
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Emails automatiques au client</h2>
      <p className="text-sm text-gray-500 mb-3">
        Envoyés par l'app chaque matin, selon la date de l'événement, à l'email client de la fiche.
        Un client ne reçoit jamais deux fois le même email.
      </p>
      <div className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-gray-700 mb-5">
        {summary.length ? (
          <ul className="space-y-0.5">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
        ) : "Aucun email automatique : tout s'envoie à la main depuis la fiche de l'événement."}
      </div>

      <div className="space-y-3 mb-5">
        <ClientEmailRow
          step={1}
          title="Avant l'événement : lien de l'éditeur du template"
          help="Le client reçoit son code d'accès et le lien pour créer son template. S'il l'a déjà reçu depuis la fiche (« Envoyer le lien au client »), il n'est pas renvoyé. Réservation faite après J-n : envoyé le lendemain matin."
          checked={profile.access_email_auto.enabled}
          onChange={setAuto('access_email_auto', 'enabled')}
          footer={(
            <BrevoTemplateField
              id="access-template" label="Modèle d'email Brevo (n°)" value={accessTpl} onChange={setAccessTpl}
              help="Sert aussi à l'envoi manuel depuis la fiche de l'événement."
              variables={['CLIENT_NAME', 'EVENT_NAME', 'ACCESS_CODE', 'EDITOR_URL', 'EXPIRES_DATE']}
            />
          )}
        >
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            Envoyer à J-
            <input type="number" min={1} max={365} value={profile.access_email_auto.days_before}
              onChange={(e) => setAuto('access_email_auto', 'days_before')(e.target.value)} className={daysInputCls} />
            avant l'événement
          </label>
        </ClientEmailRow>

        <ClientEmailRow
          step={2}
          title="Relances tant que le template n'est pas soumis"
          help="Rappel avec le lien de l'éditeur, aux jalons choisis avant l'événement. Rien ne part si le template est soumis ou validé."
          checked={reminders.enabled}
          onChange={(v) => setReminder('enabled', v)}
        >
          <div className="flex flex-wrap items-center gap-2">
            {reminders.milestones.map((m, idx) => (
              <div key={idx} className="flex items-center gap-1 bg-muted/60 rounded-lg px-2 py-1">
                <span className="text-xs text-gray-400">J-</span>
                <Input type="number" min={1} max={365} value={m} onChange={(e) => updateMilestone(idx, e.target.value)}
                  className="w-16 h-8 text-center" aria-label={`Jalon de relance ${idx + 1}`} />
                <button type="button" onClick={() => setReminder('milestones', reminders.milestones.filter((_, i) => i !== idx))}
                  className="p-1 text-gray-300 hover:text-destructive transition-colors" aria-label="Retirer ce jalon">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setReminder('milestones', [...reminders.milestones, 5])}
              className="flex items-center gap-1 text-sm text-primary font-medium">
              <Plus className="w-4 h-4" />Ajouter une relance
            </button>
          </div>
          <BrevoTemplateField
            id="reminder-template" label="Modèle d'email Brevo (n°)" value={reminders.brevo_template_id}
            onChange={(v) => setReminder('brevo_template_id', v)}
            help="Le même modèle pour toutes les relances."
            variables={['CLIENT_NAME', 'EVENT_NAME', 'ACCESS_CODE', 'EDITOR_URL', 'DAYS_LEFT']}
          />
        </ClientEmailRow>

        <ClientEmailRow
          step={3}
          title="Après l'événement : lien des photos"
          help="Lien de la galerie (et du livre d'or audio s'il est activé), invitation à laisser un avis Google, facture jointe si elle est sur la fiche. Seulement si le lien de la galerie est renseigné sur la fiche de l'événement."
          checked={profile.delivery_auto.enabled}
          onChange={setAuto('delivery_auto', 'enabled')}
        >
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            Envoyer à J+
            <input type="number" min={0} max={365} value={profile.delivery_auto.days_after}
              onChange={(e) => setAuto('delivery_auto', 'days_after')(e.target.value)} className={daysInputCls} />
            après l'événement
          </label>
        </ClientEmailRow>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

function SetupScreenSection() {
  // LAB-253 : couleurs de la borne fixes (LAB-249) ; seul reste le choix fond Pola ou image.
  const [cfg,       setCfg]       = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    getKioskSetupConfig()
      .then(c => setCfg(normalizeSetupConfig(c)))
      .finally(() => setLoading(false));
  }, []);

  function set(key, val) { setCfg(prev => ({ ...prev, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await saveKioskSetupConfig(setupConfigToSave(cfg));
      toast.success('Sauvegardé !');
    } catch (e) {
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadKioskGlobalSetupBackground(file);
      set('bg_image_url', url);
    } catch (e) {
      toast.error(e.message);
    } finally { setUploading(false); e.target.value = ''; }
  }

  if (loading || !cfg) return null;

  const bgType = cfg.bg_type;

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Écran de saisie du code</h2>
      <p className="text-sm text-gray-500 mb-5">
        Arrière-plan de l'écran où les invités entrent leur code événement. S'applique à toutes les bornes.
        Les couleurs de la borne sont celles de l'application.
      </p>

      <div className="flex gap-2 mb-5">
        {[{ v: SETUP_BG_CREAM, l: 'Fond Pola (crème)' }, { v: SETUP_BG_IMAGE, l: 'Image' }].map(opt => (
          <button key={opt.v} onClick={() => set('bg_type', opt.v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              bgType === opt.v ? 'bg-primary/10 border-primary/40 text-primary' : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>{opt.l}</button>
        ))}
      </div>

      {bgType === SETUP_BG_CREAM && (
        <div className="w-24 h-14 rounded-xl border border-gray-200" style={{ background: KIOSK_CREAM }}/>
      )}

      {bgType === SETUP_BG_IMAGE && (
        <div className="flex items-center gap-5">
          <div className="w-16 h-24 rounded-lg overflow-hidden border border-gray-200 shrink-0" style={{ background: KIOSK_CREAM }}>
            {cfg.bg_image_url
              ? <img src={cfg.bg_image_url} alt="Fond saisie" className="w-full h-full object-cover"/>
              : <span className="text-[10px] text-gray-400 flex items-center justify-center h-full text-center px-1">Aucune image</span>}
          </div>
          <div className="flex flex-col gap-2">
            <label className={`cursor-pointer inline-flex items-center gap-2 h-10 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
              <input type="file" accept={KIOSK_BG_ACCEPT} className="hidden" onChange={handleImageUpload} disabled={uploading}/>
              {uploading
                ? <Loader2 className="w-4 h-4 animate-spin"/>
                : <Upload className="w-4 h-4"/>}
              {uploading ? 'Upload…' : cfg.bg_image_url ? 'Remplacer' : 'Choisir une image'}
            </label>
            {cfg.bg_image_url && (
              <button onClick={() => set('bg_image_url', null)} className="text-xs text-gray-400 hover:text-destructive transition-colors">
                Supprimer l'image
              </button>
            )}
            <p className="text-xs text-gray-400">PNG ou JPG, 10 Mo au maximum. Sans image, la borne affiche le fond Pola.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

// ── Alertes monitoring parc ────────────────────────────────────────────────────
const ALERT_DEFAULT = {
  enabled: false,
  recipient_email: '',
  machine_offline:  { enabled: false, after_minutes: 10 },
  printer_problem:  { enabled: false },
  camera_problem:   { enabled: false },
  print_quota_near: { enabled: false, threshold_pct: 90 },
  paper_low:        { enabled: false, threshold_pct: 10 },
};

function MiniToggle({ checked, onChange, color }) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      className={color === 'bg-amber-500' ? 'data-[state=checked]:bg-amber-500' : undefined}
    />
  );
}

function AlertsSection({ org }) {
  const init = { ...ALERT_DEFAULT, ...(org.alert_config ?? {}),
    machine_offline:  { ...ALERT_DEFAULT.machine_offline,  ...(org.alert_config?.machine_offline  ?? {}) },
    printer_problem:  { ...ALERT_DEFAULT.printer_problem,  ...(org.alert_config?.printer_problem  ?? {}) },
    camera_problem:   { ...ALERT_DEFAULT.camera_problem,   ...(org.alert_config?.camera_problem   ?? {}) },
    print_quota_near: { ...ALERT_DEFAULT.print_quota_near, ...(org.alert_config?.print_quota_near ?? {}) },
    paper_low:        { ...ALERT_DEFAULT.paper_low,        ...(org.alert_config?.paper_low        ?? {}) },
  };
  const [cfg,    setCfg]    = useState(init);
  const [saving, setSaving] = useState(false);

  function set(path, value) {
    setCfg(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase.from('organizations').update({ alert_config: cfg }).eq('id', org.id);
      if (error) throw error;
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  const rows = [
    {
      key: 'machine_offline',
      label: 'Machine hors ligne',
      desc: 'Quand une machine assignée à un événement en cours ne donne plus de signe de vie.',
      param: (
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          après
          <input type="number" min={2} max={120} value={cfg.machine_offline.after_minutes}
            onChange={e => set('machine_offline.after_minutes', Math.max(2, Number(e.target.value) || 10))}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center outline-none focus:border-primary" />
          min
        </span>
      ),
    },
    {
      key: 'printer_problem',
      label: 'Problème imprimante',
      desc: 'Plus de papier, bourrage, erreur ou imprimante hors ligne.',
      param: null,
    },
    {
      key: 'camera_problem',
      label: 'Appareil photo débranché',
      desc: 'Quand la borne ne détecte plus son appareil photo : les invités ne peuvent plus prendre de photo.',
      param: null,
    },
    {
      key: 'print_quota_near',
      label: 'Quota d\'impressions',
      desc: 'Quand le nombre de tirages approche du maximum défini pour l\'événement.',
      param: (
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          à
          <input type="number" min={50} max={100} value={cfg.print_quota_near.threshold_pct}
            onChange={e => set('print_quota_near.threshold_pct', Math.min(100, Math.max(50, Number(e.target.value) || 90)))}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center outline-none focus:border-primary" />
          %
        </span>
      ),
    },
    {
      key: 'paper_low',
      label: 'Papier bientôt vide',
      desc: 'Estimation du stock de papier restant (capacité du rouleau définie dans Kiosks).',
      param: (
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          à
          <input type="number" min={2} max={50} value={cfg.paper_low.threshold_pct}
            onChange={e => set('paper_low.threshold_pct', Math.min(50, Math.max(2, Number(e.target.value) || 10)))}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center outline-none focus:border-primary" />
          % restant
        </span>
      ),
    },
  ];

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-800">Alertes parc kiosk</h2>
        <MiniToggle checked={cfg.enabled} onChange={v => set('enabled', v)} color="bg-amber-500" />
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {cfg.enabled
          ? 'Recevez un email quand une machine en prestation rencontre un problème. Choisissez les alertes ci-dessous.'
          : 'Désactivé — aucune alerte ne sera envoyée.'}
      </p>

      {cfg.enabled && (
        <>
          {/* Destinataire */}
          <div className="mb-5">
            <Label className="block mb-1">Email destinataire</Label>
            <Input type="email" value={cfg.recipient_email}
              onChange={e => set('recipient_email', e.target.value)}
              placeholder={org.notify_email || 'admin@exemple.fr'} />
            <p className="text-xs text-gray-400 mt-1">
              Laissez vide pour utiliser l'email de notification de l'organisation{org.notify_email ? ` (${org.notify_email})` : ''}.
            </p>
          </div>

          {/* Types d'alertes */}
          <div className="space-y-2">
            {rows.map(r => {
              const on = cfg[r.key].enabled;
              return (
                <div key={r.key} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${on ? 'bg-card border-gray-200' : 'bg-gray-50 border-gray-100'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{r.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{r.desc}</p>
                  </div>
                  {on && r.param}
                  <MiniToggle checked={on} onChange={v => set(`${r.key}.enabled`, v)} color="bg-amber-500" />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100 mt-5">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

// Logo de la société (LAB-257) : enregistré dès l'envoi, affiché sur l'accueil de la borne
// (48 px de haut, 280 px de large au maximum) à la place de l'icône et du nom.
function OrgLogoField({ org, onChange }) {
  const [busy, setBusy] = useState(false);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange('logo_url', await uploadOrgLogo(org.id, file));
      toast.success('Logo enregistré. Les bornes le prendront à leur prochaine synchronisation.');
    } catch (err) {
      toast.error(err.message || 'Envoi du logo impossible.');
    } finally { setBusy(false); }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await removeOrgLogo(org.id);
      onChange('logo_url', null);
      toast.success("Logo supprimé. Les bornes afficheront le nom de l'entreprise.");
    } catch (err) {
      toast.error(err.message || 'Suppression du logo impossible.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1.5">
      <Label>Logo</Label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-16 w-[296px] max-w-full rounded-lg border border-gray-200 px-2 flex items-center shrink-0"
          style={{ background: KIOSK_CREAM }}>
          {org.logo_url
            ? <img src={org.logo_url} alt="Logo de la société" className="max-h-12 max-w-full object-contain"/>
            : <span className="text-xs text-gray-400">Aucun logo : la borne affiche le nom de l'entreprise.</span>}
        </div>
        <div className="flex flex-col items-start gap-2">
          <label className={`cursor-pointer inline-flex items-center gap-2 h-10 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleUpload} disabled={busy}/>
            {busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
            {busy ? 'Envoi…' : org.logo_url ? 'Remplacer' : 'Choisir un logo'}
          </label>
          {org.logo_url && (
            <button type="button" onClick={handleRemove} disabled={busy}
              className="text-xs text-gray-400 hover:text-destructive transition-colors">
              Supprimer
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-400">
        PNG ou JPG, 2 Mo au maximum (pas de SVG). Un PNG à fond transparent est recommandé.
        Affiché en haut à gauche de l'accueil de la borne, à la place du nom de l'entreprise.
      </p>
    </div>
  );
}

// Carte « Entreprise » (open core L5) : identité de l'entreprise réunie en un seul endroit.
// Colonnes d'organizations et des clés de business_profile (src/lib/orgIdentity.js), enregistrées
// ensemble par saveBusinessProfile (fusion : les clés posées par les autres cartes sont gardées).
function CompanySection({ org, onOrgChange }) {
  const [form,   setForm]   = useState(() => identityForm(org));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  async function handleSave() {
    const found = identityErrors(form);
    setErrors(found);
    if (Object.keys(found).length) { toast.error(Object.values(found)[0]); return; }
    setSaving(true);
    try {
      const { columns, businessPatch } = identitySave(form);
      const businessProfile = await saveBusinessProfile(org.id, businessPatch, columns);
      onOrgChange({ ...columns, business_profile: businessProfile });
      toast.success('Enregistré !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  const field = (key, label, { type = 'text', placeholder, help } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`company-${key}`}>{label}</Label>
      <Input
        id={`company-${key}`}
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        aria-invalid={errors[key] ? true : undefined}
        className={errors[key] ? 'border-destructive' : undefined}
      />
      {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
      {help && <p className="text-xs text-gray-400">{help}</p>}
    </div>
  );

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Entreprise</h2>
      <p className="text-sm text-gray-500 mb-5">
        L'identité de votre entreprise, reprise sur la borne, dans les galeries des invités et dans les emails.
        Un champ laissé vide garde la valeur par défaut.
      </p>
      <div className="space-y-4">
        {field('contact_company', "Nom de l'entreprise", {
          placeholder: 'Nom de votre entreprise',
          help: "Affiché dans la barre latérale de l'admin, les galeries publiques et sur la borne.",
        })}
        <OrgLogoField org={org} onChange={(key, val) => onOrgChange({ [key]: val })}/>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('contact_phone', 'Téléphone', {
            type: 'tel', placeholder: '06 12 34 56 78', help: "Affiché avec un bouton d'appel sur la borne.",
          })}
          {field('contact_email', 'Email de contact', { type: 'email', placeholder: 'contact@exemple.fr' })}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company-contact_address">Adresse postale</Label>
          <Textarea
            id="company-contact_address"
            rows={3}
            value={form.contact_address}
            onChange={e => set('contact_address', e.target.value)}
            placeholder={"12 rue de l'Exemple\n35000 Rennes"}
          />
          <p className="text-xs text-gray-400">Plusieurs lignes possibles. Affichée en pied des emails envoyés aux clients, pas sur la borne.</p>
        </div>
        {field('google_review_url', "Lien d'avis Google", {
          type: 'url', placeholder: 'https://g.page/r/…/review',
          help: 'Ajouté aux emails de livraison pour inviter le client à laisser un avis.',
        })}
      </div>

      <div className="mt-6 pt-5 border-t border-gray-100 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Emails</h3>
          <p className="text-xs text-gray-400 mt-0.5">Expéditeur et signature des emails envoyés par l'application.</p>
        </div>
        {field('company_name', 'Nom dans le texte des emails', {
          placeholder: 'Nom de votre entreprise',
          help: 'Repris dans les emails de livraison et du bilan client.',
        })}
        <div className="space-y-1.5">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('email_sender_name', "Nom de l'expéditeur", { placeholder: 'Nom de votre entreprise' })}
            {field('email_sender_email', "Adresse de l'expéditeur", { type: 'email', placeholder: 'contact@exemple.fr' })}
          </div>
          <p className="text-xs text-gray-400">
            L'adresse doit être un expéditeur validé dans Brevo, sinon les emails partent avec l'expéditeur par défaut.
          </p>
        </div>
        <div className="pt-2">
          <h4 className="text-sm font-medium text-gray-800">Marque des emails</h4>
          <p className="text-xs text-gray-400 mt-0.5">
            En-tête et pied de page de tous les emails. Un champ vide retire son bloc ; sans logo, le nom de l'entreprise est écrit en titre.
          </p>
        </div>
        {field('email_logo_url', "Logo des emails (adresse de l'image)", {
          type: 'url', placeholder: 'https://…/logo.png',
          help: "Image hébergée en ligne, environ 600 px de large. Vide : le logo de l'entreprise ci-dessus.",
        })}
        {field('website_url', 'Site web', {
          type: 'url', placeholder: 'https://www.exemple.fr', help: 'Lien du logo dans les emails.',
        })}
        {field('email_reviews_text', 'Phrase des avis', {
          placeholder: '**120 avis** Google · note 5/5',
          help: 'Sous les étoiles, en pied des emails clients. **texte** pour du gras.',
        })}
        <div className="grid gap-4 sm:grid-cols-3">
          {field('social_facebook_url', 'Facebook', { type: 'url', placeholder: 'https://facebook.com/…' })}
          {field('social_instagram_url', 'Instagram', { type: 'url', placeholder: 'https://instagram.com/…' })}
          {field('social_linkedin_url', 'LinkedIn', { type: 'url', placeholder: 'https://linkedin.com/company/…' })}
        </div>
        {field('email_legal_footer', 'Mentions légales', {
          placeholder: 'Raison sociale – forme juridique – SIREN – adresse',
          help: "Dernière ligne de chaque email. Vide : le nom de l'entreprise.",
        })}
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100 mt-5">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

function BusinessProfileSection({ org, showBanner, showReport }) {
  const [cfg,    setCfg]    = useState(() => businessProfileForm(org.business_profile));
  const [saving, setSaving] = useState(false);

  function set(path, value) {
    setCfg(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveBusinessProfile(org.id, profilePatch(cfg));
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Galeries et bilan client</h2>
      <p className="text-sm text-gray-500 mb-5">
        Bandeau des galeries des invités et bilan envoyé au client après l'événement.
      </p>

      {/* Bandeau réservation sur les galeries publiques (LAB-130) */}
      {showBanner && <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">Bandeau « Vous organisez un événement ? »</p>
          <p className="text-xs text-gray-400 mt-0.5">Affiché sur les galeries photo et audio des invités, avec un lien vers les disponibilités du site. Jamais dans le diaporama.</p>
        </div>
        <MiniToggle checked={isBookingBannerEnabled(cfg[BOOKING_BANNER_SETTING])} onChange={v => set(BOOKING_BANNER_SETTING, v)} />
      </div>}

      {/* Bilan client (LAB-238) : à qui la carte de la fiche événement est proposée d'office */}
      {showReport && <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-gray-200 mb-5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">Bilan client proposé d'office</p>
          <p className="text-xs text-gray-400 mt-0.5">Page de bilan envoyée au client après l'événement (séances, impressions, photos choisies). Toujours possible à la main depuis la fiche de l'événement.</p>
        </div>
        <Select value={cfg.event_report.default_for} onValueChange={v => set('event_report.default_for', v)}>
          <SelectTrigger className="sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEFAULT_FOR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>}

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

export default function AdminSettings() {
  const [org, setOrg]         = useState(null);
  const [saving, setSaving]   = useState(false);
  const { isAvailable } = useFeatures();
  const { isAdmin: isAppAdmin } = useAppAdmin();
  const showBanner = isAvailable('gallery') && isAvailable('booking');
  const showReport = isAvailable('event_report');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', session.session.user.id)
      .maybeSingle();

    setOrg(orgData);
  }

  async function saveOrg(e) {
    e.preventDefault();
    setSaving(true);
    await supabase.from('organizations').update({
      name:                       org.name,
      webhook_url:                org.webhook_url,
      notify_email:               org.notify_email,
    }).eq('id', org.id);
    setSaving(false);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>

      {/* Entreprise : identité, logo, expéditeur des emails (open core L5) */}
      {org && <CompanySection org={org} onOrgChange={patch => setOrg(o => ({ ...o, ...patch }))} />}

      {/* Galeries et bilan client */}
      {org && (showBanner || showReport) && <BusinessProfileSection org={org} showBanner={showBanner} showReport={showReport} />}

      {/* Emails automatiques au client (LAB-262) */}
      {org && (isAvailable('client_design') || isAvailable('delivery_email')) && <ClientEmailsSection org={org} />}

      {/* Formulaire pré-édition */}
      {org && isAvailable('client_design') && <FormConfigSection org={org} />}

      {/* Sections des modules installés (ex. réservation en ligne + catalogue, LAB-61) */}
      {org && <ModuleSlot name="settings.sections" org={org} />}

      {/* Zones perdues */}
      {org && <BleedSection org={org} />}

      {/* Organisation */}
      {org && (
        <Card className="p-4 sm:p-6">
          <h2 className="font-semibold text-gray-800 mb-5">Organisation</h2>
          <form onSubmit={saveOrg} className="space-y-4">
            {[
              { label: 'Nom', key: 'name', type: 'text', placeholder: 'Nom de votre entreprise' },
              { label: 'Email de notification', key: 'notify_email', type: 'email', placeholder: 'admin@exemple.fr', help: 'Reçoit un email à chaque template soumis.' },
              { label: 'URL Webhook (optionnel)', key: 'webhook_url', type: 'url', placeholder: 'https://exemple.com/webhook', help: 'Reçoit un POST JSON à chaque soumission.' },
            ].filter(({ key }) => key === 'name' || isAvailable('client_design')).map(({ label, key, type, placeholder, help }) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={type}
                  value={org[key] ?? ''}
                  onChange={(e) => setOrg({ ...org, [key]: e.target.value })}
                  placeholder={placeholder}
                />
                {help && <p className="text-xs text-gray-400">{help}</p>}
              </div>
            ))}
            <Button type="submit" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </form>
        </Card>
      )}

      {/* Alertes parc kiosk */}
      {org && isAvailable('kiosk_alerts') && <AlertsSection org={org} />}

      {/* Écran de saisie du code : commun à toutes les bornes, admin plateforme seulement (LAB-282) */}
      {isAppAdmin && <SetupScreenSection />}

      {/* Mot de passe de l'admin connecté (LAB-268) */}
      <PasswordSettingsCard />
    </div>
  );
}
