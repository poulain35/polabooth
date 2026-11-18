// Onglet « Photos et livraison » de la fiche de l'événement (LAB-337, remplace AdminEventDelivery).
// Parties (`&partie=`) : photos (galerie des invités et photos, gallery), livre d'or (emplacements
// event.delivery et event.audio des modules), envoi (email de livraison et bilan client),
// questionnaire (réponses, statistiques et export des contacts, guest_form).
import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOrg } from '../AdminLayout';
import { useFeatures } from '../../../hooks/useFeatures';
import { getEmailLogs, sendDeliveryEmailForEvent, updateGalleryConfig } from '../../../lib/supabase';
import GuestResponsesPanel from '../../../components/admin/GuestResponsesPanel';
import GuestExportReminderBanner from '../../../components/admin/GuestExportReminderBanner';
import EventReportCard from '../../../components/admin/EventReportCard';
import QRCode from 'qrcode';
import { Check, Download, Image as ImageIcon, Loader2, Send } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Switch } from '../../../components/ui/switch';
import { Card, CardDescription, CardTitle } from '../../../components/ui/card';
import { CopyButton } from '../../../components/ui/copy-button';
import { Spinner } from '../../../components/ui/spinner';
import { toast } from 'sonner';
import { guestExportReminder } from '../../../lib/guestExportReminder';
import PageTabs from '../../../components/admin/PageTabs';
import { moduleSlot } from '../../../features/modules';
import { pickTab } from '../../../features/adminRoutes';
import { APP_URL } from './eventTabUtils';
import { CardHeading, Notice, Toggle } from './shared';
import { downloadUrl } from '../../../lib/download';

const AdminPhotoEvent = lazy(() => import('../AdminPhotoEvent'));
const AdminStats = lazy(() => import('../AdminStats'));

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

  useEffect(() => {
    QRCode.toDataURL(guestUrl, { width: 512, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [guestUrl]);

  function downloadQr() {
    if (!qrDataUrl) return;
    downloadUrl(qrDataUrl, `qr-galerie-${event.access_code}.png`);
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
    <Card className="p-card">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <CardTitle as="h2">Galerie invités</CardTitle>
          <CardDescription className="mt-0.5">
            {enabled
              ? 'Les invités peuvent envoyer leurs photos depuis le lien galerie.'
              : 'Désactivée — seule la borne alimente la galerie.'}
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={() => save({ guest_upload_enabled: !enabled })} disabled={saving} />
        </div>
      </div>

      {enabled && (
        <div className="mt-4 space-y-5 border-t border-border pt-4">
          {/* Lien + QR code à partager aux invités */}
          <div className="flex flex-col items-center gap-4 rounded-xl bg-muted p-4 sm:flex-row">
            {qrDataUrl && (
              <img src={qrDataUrl} alt="QR code galerie invités" className="h-28 w-28 shrink-0 rounded-lg" />
            )}
            <div className="w-full min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Lien d'ajout de photos</p>
              <p className="mb-2 text-xs text-muted-foreground">À imprimer ou afficher : les invités scannent pour envoyer leurs photos.</p>
              <div className="flex items-center gap-2 rounded-control bg-card py-1.5 pl-3 pr-1.5">
                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{guestUrl}</span>
                <CopyButton value={guestUrl} className="shrink-0" />
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={downloadQr} disabled={!qrDataUrl}>
                <Download />
                Télécharger le QR
              </Button>
            </div>
          </div>

          {/* Palier */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Palier</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'essentiel', label: 'Essentiel', desc: 'Rétention 90 j · photos uniquement' },
                { id: 'premium',   label: 'Premium',   desc: 'Rétention 365 j · vidéos + diaporama' },
              ].map(p => (
                <button key={p.id} type="button" onClick={() => applyPlan(p.id)} aria-pressed={cfg.plan === p.id}
                  className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    cfg.plan === p.id ? 'border-primary bg-primary-soft' : 'border-border hover:border-input'
                  }`}>
                  <p className={`flex items-center justify-between gap-2 text-sm font-medium ${cfg.plan === p.id ? 'text-primary-ink' : 'text-foreground'}`}>
                    {p.label}
                    {cfg.plan === p.id && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{p.desc}</p>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Changer de palier applique ses valeurs par défaut ; vous pouvez ensuite ajuster finement ci-dessous.</p>
          </div>

          {/* Options fines */}
          <div className="space-y-1">
            <div className="flex items-center justify-between py-2.5 border-b border-border">
              <div>
                <p className="text-sm text-foreground">Modération</p>
                <p className="text-xs text-muted-foreground">Les photos invités restent en attente jusqu'à validation.</p>
              </div>
              <Toggle checked={cfg.moderation === true} onChange={v => set({ moderation: v })} />
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-border">
              <div>
                <p className="text-sm text-foreground">Vidéos autorisées</p>
                <p className="text-xs text-muted-foreground">Les invités peuvent envoyer des vidéos.</p>
              </div>
              <Toggle checked={cfg.allow_video === true} onChange={v => set({ allow_video: v })} />
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-border">
              <div>
                <p className="text-sm text-foreground">Diaporama</p>
                <p className="text-xs text-muted-foreground">Affichage en diaporama sur la galerie.</p>
              </div>
              <Toggle checked={cfg.slideshow_enabled === true} onChange={v => set({ slideshow_enabled: v })} />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rétention (jours)</Label>
                <Input type="number" min={1} value={cfg.retention_days ?? ''}
                  onChange={e => set({ retention_days: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Taille max par envoi (Mo)</Label>
                <Input type="number" min={1} value={cfg.max_upload_mb ?? ''}
                  onChange={e => set({ max_upload_mb: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
            </div>
            <div className="pt-3 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Texte d'accueil <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
              <Textarea rows={2} value={cfg.welcome_text ?? ''}
                onChange={e => set({ welcome_text: e.target.value })}
                placeholder="Message affiché aux invités sur la page d'envoi…"
                className="min-h-0 resize-none" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => save({})} disabled={saving} >
              {saving && <Loader2 className="animate-spin" />}
              {saving ? 'Enregistrement…' : 'Enregistrer la galerie'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Partie « Envoi » : email de livraison et bilan client ─────────────────────

function DeliveryPart({ event, org, onEmailLogs }) {
  const { isAvailable } = useFeatures();
  const [deliverySending, setDeliverySending] = useState(false);

  async function handleSendDelivery() {
    setDeliverySending(true);
    try {
      const res = await sendDeliveryEmailForEvent(event.id);
      if (res?.skipped) toast.info('Livraison déjà envoyée');
      else toast.success(`Livraison envoyée à ${event.client_email}`);
    } catch (err) {
      toast.error(err.message ?? 'Erreur');
    } finally {
      setDeliverySending(false);
      getEmailLogs(event.id).then(onEmailLogs).catch(() => {});
    }
  }

  return (
    <div className="space-y-5">
      {/* Livraison post-événement — photos, liens des fonctionnalités, avis, pièce jointe (L4) */}
      {isAvailable('delivery_email') && <Card className="p-card">
        <CardHeading
          icon={<ImageIcon />}
          tone="rose"
          title="Email de livraison"
          description="Galerie photos, liens ajoutés, avis et pièce jointe"
          actions={(
            <Button onClick={handleSendDelivery} disabled={deliverySending || !event.client_email || !event.photo_gallery_url}>
              {deliverySending ? <Loader2 className="animate-spin" /> : <Send />}
              {deliverySending ? 'Envoi…' : 'Envoyer la livraison'}
            </Button>
          )}
        />

        {!event.client_email && (
          <Notice tone="amber" className="mt-3">Renseigne l'email du client pour pouvoir envoyer la livraison.</Notice>
        )}
        {event.client_email && !event.photo_gallery_url && (
          <Notice tone="amber" className="mt-3">Renseigne le lien de la galerie photos (onglet Résumé, Mise à disposition) pour pouvoir envoyer la livraison.</Notice>
        )}
      </Card>}

      {/* Bilan client — page de bilan à envoyer (LAB-238) */}
      {isAvailable('event_report') && <EventReportCard event={event} org={org} appUrl={APP_URL} />}
    </div>
  );
}

// ── Partie « Questionnaire » : réponses, statistiques et export des contacts ──

function QuestionnairePart({ event, setEvent }) {
  // Résumé des réponses invités, relu par GuestResponsesPanel (rappel d'export, LAB-224)
  const [guestSummary, setGuestSummary] = useState(null);
  return (
    <div className="space-y-5">
      <GuestExportReminderBanner reminder={guestSummary?.event_id === event.id ? guestExportReminder(guestSummary, event) : null} />
      <GuestResponsesPanel
        event={event}
        onExported={(at) => setEvent((e) => ({ ...e, guest_responses_exported_at: at }))}
        onSummary={setGuestSummary}
      />
      <AdminStats eventId={event.id} embedded />
    </div>
  );
}

// ── Onglet Photos et livraison ────────────────────────────────────────────────

export default function LivraisonTab({ event, setEvent, onEmailLogs }) {
  const org = useOrg();
  const [searchParams] = useSearchParams();
  const { isAvailable } = useFeatures();

  // Livre d'or : la partie event.delivery d'un module, avec au-dessus ses réglages (event.audio).
  const moduleParts = moduleSlot('event.delivery').map((item) => ({
    ...item,
    id: item.id ?? item.feature,
    settings: moduleSlot('event.audio').filter((s) => s.feature === item.feature),
  }));
  const parts = [
    { id: 'photos', label: 'Photos', available: isAvailable('gallery') },
    ...moduleParts.map((part) => ({ ...part, available: isAvailable(part.feature) })),
    { id: 'envoi', label: 'Livraison', available: isAvailable('delivery_email') || isAvailable('event_report') },
    { id: 'questionnaire', label: 'Questionnaire', available: isAvailable('guest_form') },
  ].filter((part) => part.available);
  const active = pickTab(searchParams.get('partie'), parts.map((part) => part.id));
  const current = parts.find((part) => part.id === active);

  function renderPart(part) {
    if (part.id === 'photos') {
      return (
        <div className="space-y-5">
          <GallerySection
            event={event}
            onSaved={gallery => setEvent(e => ({ ...e, form_config: { ...e.form_config, gallery } }))}
          />
          <AdminPhotoEvent embedded />
        </div>
      );
    }
    if (part.id === 'envoi') return <DeliveryPart event={event} org={org} onEmailLogs={onEmailLogs} />;
    if (part.id === 'questionnaire') return <QuestionnairePart event={event} setEvent={setEvent} />;
    return (
      <div className="space-y-5">
        {part.settings.map(({ Component: Settings }, i) => (
          <Settings
            key={i}
            event={event}
            onSaved={audio_enabled => setEvent(e => ({ ...e, form_config: { ...e.form_config, audio_enabled } }))}
          />
        ))}
        <part.Component />
      </div>
    );
  }

  if (!current) return <p className="py-8 text-sm text-muted-foreground">Rien à livrer pour cet événement.</p>;
  return (
    <div className="space-y-5">
      {parts.length > 1 && (
        <PageTabs
          label="Photos et livraison"
          active={active}
          tabs={parts.map((part) => ({ id: part.id, label: part.label, to: `?tab=livraison&partie=${part.id}` }))}
        />
      )}
      <Suspense fallback={
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      }>
        <div key={current.id}>{renderPart(current)}</div>
      </Suspense>
    </div>
  );
}
