// Onglet « Réglages de la borne » de la fiche de l'événement (?tab=borne, LAB-337) : une seule page avec
// un sommaire. Sections (ancres) : accueil
// (fond, accueil personnalisé, formats), capture (prise de vue), effets, questionnaire (questionnaire et
// consentement RGPD), impression, partage (boutons de l'écran de partage `#apparence`, partage, habillage,
// email). À partir de 1024 px, le sommaire reste affiché dans une colonne à gauche.
import { useLocation, Link } from 'react-router-dom';
import { useFeatures } from '../../../hooks/useFeatures';
import KioskQuestionnaireSettings from '../../../components/admin/KioskQuestionnaireSettings';
import PhotoConsentsPanel from '../../../components/admin/PhotoConsentsPanel';
import EventBrandingCard from '../../../components/admin/EventBrandingCard';
import KioskEmailCard from '../../../components/admin/KioskEmailCard';
import { KIOSK_CREAM } from '../../../lib/kioskSetupScreen';
import { Loader2, Monitor, X, Upload } from 'lucide-react';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import EventKioskPreviewButton from '../../../components/admin/EventKioskPreviewButton';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { Card, CardTitle } from '../../../components/ui/card';
import { BOOMERANG_LIMITS, DISPLAY_NAME_MAX, enabledFormats, FORMAT_LABEL_MAX, GIF_LIMITS, KIOSK_FORMATS, NO_FORMAT_ERROR } from '../../../lib/kioskFormats';
import { KIOSK_BG_ACCEPT } from '../../../lib/kioskBackground';
import { previewDraft } from '../../../lib/eventBrandingAdmin';
import { rowCls, labelCls, useHashScroll } from './eventTabUtils';
import { CardHeading, KioskSaveBar, Notice, Toggle } from './shared';

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

// ── Accueil personnalisé (LAB-250) ──────────────────────────────────────────
// La borne affiche « Bienvenue au photobooth de {nom} » et la date de l'événement.
function KioskWelcomeCard({ kioskCfg, setKiosk, eventName, rowCls, labelCls, canClientDesign }) {
  const home = kioskCfg.home ?? {};
  const shownName = (home.display_name ?? '').trim() || eventName || 'l’événement';
  return (
    <Card className="p-card">
      <div className={rowCls}>
        <div className="min-w-0 pr-4">
          <p className={labelCls}>Personnaliser l'accueil au nom de l'événement</p>
          <p className="text-xs text-muted-foreground">
            {home.personalized
              ? `La borne affiche « Bienvenue au photobooth de ${shownName} » et la date de l'événement.`
              : 'Désactivé : accueil standard de la borne.'}
          </p>
        </div>
        <Toggle checked={home.personalized === true} onChange={v => setKiosk('home.personalized', v)} />
      </div>
      {home.personalized && (
        <div className="pt-3 space-y-1.5">
          <Label htmlFor="kiosk-display-name" className="text-sm text-foreground">Nom affiché <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
          <Input
            id="kiosk-display-name"
            value={home.display_name ?? ''}
            maxLength={DISPLAY_NAME_MAX}
            placeholder={eventName || 'Camille & Thomas'}
            onChange={e => setKiosk('home.display_name', e.target.value)}
            className="max-w-sm"
          />
          <p className="text-xs text-muted-foreground">Vide = nom de l'événement. Ex. « Camille & Thomas » plutôt que « Mariage Camille et Thomas 14/06 ».</p>
        </div>
      )}
      {home.personalized && canClientDesign && (
        <div className={`${rowCls} mt-3 border-t border-border`}>
          <div className="min-w-0 pr-4">
            <p className={labelCls}>Le client crée son écran d’accueil (1920×1080)</p>
            <p className="text-xs text-muted-foreground">
              {home.client_design
                ? 'Le client dessine son écran dans l’éditeur (onglet « Mon écran d’accueil »). Une fois validé, il remplace l’accueil ci-dessus.'
                : 'Désactivé : la borne affiche l’accueil au nom de l’événement.'}
            </p>
          </div>
          <Toggle checked={home.client_design === true} onChange={v => setKiosk('home.client_design', v)} />
        </div>
      )}
    </Card>
  );
}


// ── Formats de la borne (LAB-235) ───────────────────────────────────────────
// Onglet Accueil : formats proposés aux invités et texte de leur bouton.
function KioskFormatsCard({ kioskCfg, setKiosk, rowCls, labelCls }) {
  const buttons = kioskCfg.home?.buttons ?? {};
  const active = enabledFormats(kioskCfg);
  return (
    <Card className="p-card">
      <CardTitle as="h2" className="mb-1">Formats proposés</CardTitle>
      <p className="text-xs text-muted-foreground mb-3">
        Un seul format : la borne garde son écran d'accueil habituel. Plusieurs formats : un bouton par format sur l'écran d'accueil.
      </p>
      <div>
        {KIOSK_FORMATS.map(f => {
          const b = buttons[f.key] ?? {};
          return (
            <div key={f.key} className={`${rowCls} gap-4`}>
              <div className="min-w-0">
                <p className={labelCls}>{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.description}</p>
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
      {active.length === 0 && <Notice tone="red" className="mt-3">{NO_FORMAT_ERROR}.</Notice>}
      {(buttons.gif?.enabled || buttons.boomerang?.enabled) && (
        <p className="text-xs text-muted-foreground mt-3">Réglez le nombre de photos du GIF et la durée du boomerang dans la section « Prise de vue ».</p>
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
    ? <p className="text-xs text-muted-foreground mb-2">Format non proposé pour l'instant (à cocher dans la section « Écran d’accueil »).</p>
    : null;
  return (
    <>
      <Card className="p-card">
        <CardTitle as="h2" className="mb-3">GIF</CardTitle>
        {off('gif')}
        <div>
          <div className={rowCls}>
            <div>
              <p className={labelCls}>Nombre de photos</p>
              <p className="text-xs text-muted-foreground">De {GIF_LIMITS.shots.min} à {GIF_LIMITS.shots.max} photos, jouées en boucle</p>
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
              <p className="text-xs text-muted-foreground">Laisse aux invités le temps de changer de pose</p>
            </div>
            <NumberSelect label="Temps entre deux photos du GIF"
              value={gif.interval_ms ?? GIF_LIMITS.interval_ms.default}
              options={range(GIF_LIMITS.interval_ms.min, GIF_LIMITS.interval_ms.max, 500)}
              format={seconds}
              onChange={v => setKiosk('capture.gif.interval_ms', v)} />
          </div>
        </div>
      </Card>

      <Card className="p-card">
        <CardTitle as="h2" className="mb-3">Boomerang</CardTitle>
        {off('boomerang')}
        <div>
          <div className={rowCls}>
            <div>
              <p className={labelCls}>Durée de la prise</p>
              <p className="text-xs text-muted-foreground">Le clip est ensuite joué à l'endroit puis à l'envers</p>
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
              <p className="text-xs text-muted-foreground">Propose l'impression d'une image du boomerang dans le cadre photo</p>
            </div>
            <Toggle checked={boomerang.print_frame === true} onChange={v => setKiosk('capture.boomerang.print_frame', v)} />
          </div>
        </div>
      </Card>
    </>
  );
}


/** Section du sommaire, repérée par son ancre. */
function BorneSection({ id, children }) {
  return <section id={id} className="scroll-mt-4 space-y-5">{children}</section>;
}

export default function BorneTab({ event, setEvent, design, kiosk, photobooths, companyName }) {
  const { isAvailable } = useFeatures();
  const { search } = useLocation();
  const { kioskCfg, kioskSaving, bgUploading, branding, setBranding, setKiosk, handleKioskSave, handleBgUpload } = kiosk;
  useHashScroll(Boolean(kioskCfg));
  if (!kioskCfg) return null;

  const sections = [
    { id: 'accueil', label: 'Écran d’accueil' },
    { id: 'capture', label: 'Prise de vue' },
    { id: 'effets', label: 'Effets photo' },
    { id: 'questionnaire', label: isAvailable('guest_form') ? 'Questionnaire et RGPD' : 'Consentement RGPD' },
    { id: 'impression', label: 'Impression' },
    { id: 'partage', label: 'Écran de partage' },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start">
      <Card role="navigation" aria-label="Sommaire des réglages de la borne" className="p-card lg:sticky lg:top-5">
        <CardTitle as="p">Sommaire</CardTitle>
        {/* Téléphone : une ligne qui défile à l'horizontale ; à partir de 640 px, retour à la ligne ; à partir de 1024 px, une colonne. */}
        <ul className="-mx-card mt-3 flex gap-1.5 overflow-x-auto overscroll-x-contain px-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 lg:flex-col lg:flex-nowrap lg:gap-0.5">
          {sections.map(section => (
            <li key={section.id} className="shrink-0">
              <Link to={{ search, hash: `#${section.id}` }} replace
                className="inline-flex h-8 items-center whitespace-nowrap rounded-full bg-muted px-3.5 text-[13px] text-ink transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex lg:rounded-control lg:bg-transparent lg:px-3 lg:hover:bg-muted">
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 w-full empty:hidden sm:w-56 lg:w-full">
          <EventKioskPreviewButton kind="print" design={design} event={event} />
        </div>
      </Card>

      <div className="min-w-0 space-y-8">
        {/* ════ ÉCRAN D'ACCUEIL ════ */}
        <BorneSection id="accueil">
          <Card className="p-card">
            <CardHeading
              className="mb-5"
              icon={<Monitor />}
              tone="lilac"
              title="Fond d'écran d'accueil"
              description="Premier écran affiché sur la borne avant chaque session"
            />
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
              <div className="light-island w-32 h-20 rounded-xl border border-border overflow-hidden flex items-center justify-center shrink-0" style={{ background: KIOSK_CREAM }}>
                {kioskCfg.home.background_url
                  ? <img src={kioskCfg.home.background_url} alt="Fond" className="w-full h-full object-cover" />
                  : <span className="text-xs text-muted-foreground text-center leading-tight px-2">Fond crème<br/>par défaut</span>}
              </div>
              <div className="flex min-w-0 flex-col gap-2.5">
                <label className="cursor-pointer">
                  <input type="file" accept={KIOSK_BG_ACCEPT} className="hidden" onChange={handleBgUpload} />
                  <span className={cn(buttonVariants({ variant: 'outline' }), bgUploading && 'pointer-events-none opacity-60')}>
                    {bgUploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    {bgUploading ? 'Upload en cours…' : 'Choisir une image'}
                  </span>
                </label>
                {kioskCfg.home.background_url && (
                  <button onClick={() => setKiosk('home.background_url', null)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-3.5 h-3.5" />
                    Supprimer — garder le fond crème
                  </button>
                )}
                <p className="text-xs text-muted-foreground">Format recommandé : portrait 1080 × 1920 px · PNG ou JPG, 10 Mo au maximum</p>
              </div>
            </div>
          </Card>

          <KioskWelcomeCard kioskCfg={kioskCfg} setKiosk={setKiosk} eventName={event.name} rowCls={rowCls} labelCls={labelCls}
            canClientDesign={isAvailable('client_design')} />

          <div id="formats" className="scroll-mt-4">
            <KioskFormatsCard kioskCfg={kioskCfg} setKiosk={setKiosk} rowCls={rowCls} labelCls={labelCls} />
          </div>
        </BorneSection>

        {/* ════ PRISE DE VUE ════ */}
        <BorneSection id="capture">
          <Card className="p-card">
            <CardTitle as="h2" className="mb-3">Paramètres capture</CardTitle>
            <div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Effet miroir</p>
                  <p className="text-xs text-muted-foreground">Inverse l'image en temps réel (selfie)</p>
                </div>
                <Toggle checked={kioskCfg.capture.mirror} onChange={v => setKiosk('capture.mirror', v)} />
              </div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Compte à rebours</p>
                  <p className="text-xs text-muted-foreground">Durée entre 1 et 10 secondes</p>
                </div>
                <Input type="number" min="1" max="10" value={kioskCfg.capture.countdown_seconds}
                  onChange={e => setKiosk('capture.countdown_seconds', Math.min(10, Math.max(1, Number(e.target.value))))}
                  className="w-24 text-center" />
              </div>
            </div>
          </Card>

          <KioskAnimatedCaptureCards kioskCfg={kioskCfg} setKiosk={setKiosk} rowCls={rowCls} labelCls={labelCls} />
        </BorneSection>

        {/* ════ EFFETS PHOTO ════ */}
        <BorneSection id="effets">
          <Card className="p-card">
            <CardTitle as="h2" className="mb-3">Effets photo</CardTitle>
            <div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Choix d'effet par l'invité</p>
                  <p className="text-xs text-muted-foreground">Affiche un écran de sélection après la capture</p>
                </div>
                <Toggle
                  checked={kioskCfg.effects?.user_can_choose ?? false}
                  onChange={v => setKiosk('effects.user_can_choose', v)}
                />
              </div>
            </div>

            {(kioskCfg.effects?.user_can_choose) && (
              <div className="pt-4 border-t border-border mt-1">
                <p className="text-xs font-medium text-muted-foreground mb-3">Effets disponibles</p>
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
                          className="h-4 w-4 cursor-pointer rounded accent-primary"
                        />
                        <span className="text-sm text-foreground">{effect.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </BorneSection>

        {/* ════ QUESTIONNAIRE ET RGPD ════ */}
        <BorneSection id="questionnaire">
          {isAvailable('guest_form') && (
            <KioskQuestionnaireSettings
              questionnaire={kioskCfg.questionnaire}
              set={(path, value) => setKiosk(`questionnaire.${path}`, value)}
            />
          )}
          <Card className="p-card">
            <CardTitle as="h2" className="mb-3">Consentement RGPD</CardTitle>
            <div className={rowCls}>
              <div>
                <p className={labelCls}>Écran de consentement</p>
                <p className="text-xs text-muted-foreground">Affiché avant chaque session photo</p>
              </div>
              <Toggle checked={kioskCfg.rgpd?.enabled ?? false} onChange={v => setKiosk('rgpd.enabled', v)} />
            </div>
            {kioskCfg.rgpd?.enabled && (
              <div className="pt-4">
                <Label className="block text-xs text-muted-foreground mb-2">Message affiché à l'invité</Label>
                <Textarea value={kioskCfg.rgpd?.message ?? ''} onChange={e => setKiosk('rgpd.message', e.target.value)} rows={3}
                  className="resize-none"
                  placeholder="Texte de consentement RGPD..." />
              </div>
            )}
          </Card>

          <PhotoConsentsPanel event={event} licenses={photobooths} />
        </BorneSection>

        {/* ════ IMPRESSION ════ */}
        <BorneSection id="impression">
          <Card className="p-card">
            <CardTitle as="h2" className="mb-3">Paramètres impression</CardTitle>
            <Notice tone="amber" className="mb-4">
              Le nom de l'imprimante se configure dans <code className="font-mono">appsettings.local.json</code> sur chaque PC de borne. Le format papier est déduit automatiquement du cadre photo.
            </Notice>
            <div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Impression automatique</p>
                  <p className="text-xs text-muted-foreground">Lance l'impression dès la fin de la capture</p>
                </div>
                <Toggle checked={kioskCfg.result.auto_print} onChange={v => setKiosk('result.auto_print', v)} />
              </div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Afficher le compteur restant</p>
                  <p className="text-xs text-muted-foreground">Visible sur l'écran résultat</p>
                </div>
                <Toggle checked={kioskCfg.result.show_remaining_prints} onChange={v => setKiosk('result.show_remaining_prints', v)} />
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
        </BorneSection>

        {/* ════ ÉCRAN DE PARTAGE ════ */}
        <BorneSection id="partage">
          <div id="apparence" className="scroll-mt-4">
            <Card className="p-card">
              <CardTitle as="h2" className="mb-1">Boutons de l'écran de partage</CardTitle>
              <p className="text-xs text-muted-foreground mb-4">
                Boutons affichés sur l'écran de partage. Un bouton désactivé disparaît.
                Le bouton Email n'apparaît que si le partage par email est activé.
              </p>
              <div>
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
                          onChange={v => setKiosk(`result.buttons.${btn.key}.enabled`, v)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <Notice tone="gray">
            La personnalisation de l'écran de saisie du code se configure dans{' '}
            <a href="/admin/bornes?tab=code" className="font-medium text-primary-ink underline">Bornes, onglet Code</a>
            {' '}— elle s'applique à toutes les bornes indépendamment de l'événement.
          </Notice>

          <Card className="p-card">
            <CardTitle as="h2" className="mb-3">Partage sur la borne</CardTitle>
            <div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>QR code galerie</p>
                  <p className="text-xs text-muted-foreground">Affiché sur l'écran résultat pour télécharger la photo</p>
                </div>
                <Toggle checked={kioskCfg.result.share?.qr ?? true} onChange={v => setKiosk('result.share.qr', v)} />
              </div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Envoi par email</p>
                  <p className="text-xs text-muted-foreground">L'invité peut entrer son email pour recevoir la photo</p>
                </div>
                <Toggle checked={kioskCfg.email?.enabled ?? false} onChange={v => setKiosk('email.enabled', v)} />
              </div>
              <div className={rowCls}>
                <div>
                  <p className={labelCls}>Retour auto à l'accueil</p>
                  <p className="text-xs text-muted-foreground">Après cette durée sans interaction sur l'écran de partage, la borne revient à l'accueil (0 = désactivé)</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" max="600" value={kioskCfg.result?.auto_return_seconds ?? 30}
                    onChange={e => setKiosk('result.auto_return_seconds', Math.min(600, Math.max(0, Number(e.target.value))))}
                    className="w-24 text-center" />
                  <span className="text-xs text-muted-foreground">sec</span>
                </div>
              </div>
            </div>
          </Card>

          {branding && (
            <EventBrandingCard
              eventId={event.id}
              eventName={event.name}
              branding={branding}
              onChange={patch => setBranding(b => ({ ...b, ...patch }))}
              onLogoSaved={(logoUrl, formConfig) => {
                setBranding(b => ({ ...b, logo_url: logoUrl }));
                setEvent(e => ({ ...e, form_config: formConfig }));
              }}
              showGalleryText={isAvailable('gallery')}
            />
          )}

          {kioskCfg.email?.enabled && branding && (
            <KioskEmailCard
              eventId={event.id}
              event={event}
              email={kioskCfg.email}
              setEmail={(key, value) => setKiosk(`email.${key}`, value)}
              companyName={companyName}
              previewDraft={previewDraft(kioskCfg.email, branding)}
            />
          )}
        </BorneSection>

        {/* Une seule barre pour toute la page, toujours visible. Le fond de page sous la barre
            masque le contenu qui défile derrière (rien ne dépasse sous son bord). */}
        <div className="sticky bottom-0 z-10 bg-background pb-3">
          <div className="rounded-card bg-card px-card py-3 shadow-float">
            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} className="" />
          </div>
        </div>
      </div>
    </div>
  );
}
