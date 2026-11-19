// Carte « Habillage de l'événement » de l'onglet Partage (LAB-302, spec email-galerie-couleurs) :
// couleur (contrôle du contraste D7), logo de l'événement (enregistré dès l'envoi, D8) et texte
// d'accueil de la galerie (D11). Couleur et texte sont enregistrés par « Enregistrer la configuration ».
import { useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { removeEventBrandLogo, uploadEventBrandLogo } from '../../lib/supabase';
import { KIOSK_BG_ACCEPT } from '../../lib/kioskBackground';
import { isHexColor, TEXT_LIMITS } from '../../lib/eventBranding';
import { colorStatus, normalizeColor } from '../../lib/eventBrandingAdmin';
import { buttonVariants } from '../ui/button';
import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';

// Le texte porte l'état de la couleur ; la teinte ne fait que l'appuyer.
const STATUS_CLS = {
  empty: 'text-muted-foreground',
  ok: 'text-state-green-fg',
  error: 'text-destructive',
};

export default function EventBrandingCard({ eventId, eventName, branding, onChange, onLogoSaved, showGalleryText }) {
  const [logoBusy, setLogoBusy] = useState(false);
  const color = normalizeColor(branding.color);
  const status = colorStatus(branding.color);
  const galleryLength = Array.from(branding.gallery_text ?? '').length;

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    try {
      const { logoUrl, formConfig } = await uploadEventBrandLogo(eventId, file);
      onLogoSaved(logoUrl, formConfig);
      toast.success('Logo enregistré');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLogoBusy(false);
      e.target.value = '';
    }
  }

  async function handleLogoRemove() {
    setLogoBusy(true);
    try {
      const formConfig = await removeEventBrandLogo(eventId);
      onLogoSaved(null, formConfig);
      toast.success('Logo supprimé');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <Card className="p-card">
      <CardHeading
        className="mb-5"
        tone="navy"
        icon={(
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        )}
        title="Habillage de l'événement"
        description="Couleur et logo de l'email envoyé par la borne et de la galerie des invités"
      />

      <div className="space-y-5">
        {/* Couleur */}
        <div>
          <label htmlFor="branding-color" className="block text-xs font-medium text-muted-foreground mb-1">Couleur</label>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="color" aria-label="Choisir la couleur" value={isHexColor(color) ? color.toLowerCase() : '#000000'}
              onChange={e => onChange({ color: e.target.value.toUpperCase() })}
              className="h-10 w-10 cursor-pointer rounded-control border border-input bg-card p-0.5" />
            <Input id="branding-color" type="text" value={branding.color} maxLength={7} placeholder="#1F4E79"
              onChange={e => onChange({ color: e.target.value })}
              className="w-32 font-mono uppercase" />
            {status.theme && (
              <span className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: status.theme.accent, color: status.theme.accentText }}>
                Voir ma photo
              </span>
            )}
            {color && (
              <button type="button" onClick={() => onChange({ color: '' })}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3.5 h-3.5" />
                Retirer la couleur
              </button>
            )}
          </div>
          <p className={`text-xs mt-1.5 ${STATUS_CLS[status.tone]}`} role={status.tone === 'error' ? 'alert' : undefined}>{status.text}</p>
        </div>

        {/* Logo */}
        <div>
          <p className="block text-xs font-medium text-muted-foreground mb-1">Logo de l'événement</p>
          <div className="flex items-center gap-5 flex-wrap">
            <div className="light-island w-40 h-16 rounded-xl border border-border overflow-hidden flex items-center justify-center shrink-0 bg-background">
              {branding.logo_url
                ? <img src={branding.logo_url} alt={eventName || 'Logo'} className="max-w-full max-h-full object-contain" />
                : <span className="text-xs text-muted-foreground text-center leading-tight px-2">Logo du loueur<br />par défaut</span>}
            </div>
            <div className="flex flex-col gap-2.5">
              <label className="cursor-pointer">
                <input type="file" accept={KIOSK_BG_ACCEPT} className="hidden" onChange={handleLogoUpload} disabled={logoBusy} />
                <span className={`${buttonVariants({ variant: 'outline' })} ${logoBusy ? 'pointer-events-none opacity-60' : ''}`}>
                  {logoBusy ? <Loader2 className="animate-spin" /> : <Upload />}
                  {logoBusy ? 'Envoi en cours…' : branding.logo_url ? 'Remplacer' : 'Envoyer un logo'}
                </span>
              </label>
              {branding.logo_url && (
                <button type="button" onClick={handleLogoRemove} disabled={logoBusy}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors">
                  <X className="w-3.5 h-3.5" />
                  Supprimer — garder le logo du loueur
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">PNG ou JPG, 2 Mo au maximum. Enregistré dès l'envoi.</p>
          <Notice tone="amber" className="mt-2">
            Conseil : préférez un logo sur fond blanc. Un logo foncé sur fond transparent peut disparaître quand la messagerie de l'invité est en mode sombre.
          </Notice>
        </div>

        {/* Texte de la galerie */}
        {showGalleryText && (
          <div>
            <label htmlFor="branding-gallery-text" className="block text-xs font-medium text-muted-foreground mb-1">Texte d'accueil de la galerie</label>
            <Textarea id="branding-gallery-text" value={branding.gallery_text} rows={3} maxLength={TEXT_LIMITS.gallery_text.input}
              onChange={e => onChange({ gallery_text: e.target.value })}
              placeholder="Retrouvez toutes les photos de la soirée. Merci d'être venus !"
              className="resize-none" />
            <div className="flex justify-between gap-3 mt-1">
              <p className="text-xs text-muted-foreground">Affiché sous le nom de l'événement, sur la galerie des invités. Sans variable.</p>
              <p className={`text-xs shrink-0 ${galleryLength > TEXT_LIMITS.gallery_text.input ? 'text-destructive' : 'text-muted-foreground'}`}>
                {galleryLength}/{TEXT_LIMITS.gallery_text.input}
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
