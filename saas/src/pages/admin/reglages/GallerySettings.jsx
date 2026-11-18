// Section « Galerie et bilan » de la page Réglages (/admin/reglages#galerie, LAB-338) : bandeau des
// galeries des invités et bilan client, déplacés d'AdminSettings sans changer l'enregistrement.
// Affichée seulement si l'un des deux réglages existe (galleryCardFlags, sectionFlags.js).
import { useState } from 'react';
import { saveBusinessProfile } from '../../../lib/supabase';
import { Button } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { BOOKING_BANNER_SETTING, isBookingBannerEnabled } from '../../../lib/galleryBanner';
import { businessProfileForm, profilePatch } from '../../../lib/businessProfile';
import { DEFAULT_FOR_OPTIONS } from '../../../lib/eventReportAdmin';
import { toast } from 'sonner';
import MiniToggle from './MiniToggle';

export default function GallerySettings({ org, showBanner, showReport }) {
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
    <Card className="p-card">
      <CardTitle as="h2">Galeries et bilan client</CardTitle>
      <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
        Bandeau des galeries des invités et bilan envoyé au client après l'événement.
      </p>

      {/* Bandeau réservation sur les galeries publiques (LAB-130) */}
      {showBanner && <div className="mb-2 flex items-center gap-3 rounded-xl bg-muted p-3.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Bandeau « Vous organisez un événement ? »</p>
          <p className="text-xs text-muted-foreground mt-0.5">Affiché sur les galeries photo et audio des invités, avec un lien vers les disponibilités du site. Jamais dans le diaporama.</p>
        </div>
        <MiniToggle checked={isBookingBannerEnabled(cfg[BOOKING_BANNER_SETTING])} onChange={v => set(BOOKING_BANNER_SETTING, v)} />
      </div>}

      {/* Bilan client (LAB-238) : à qui la carte de la fiche événement est proposée d'office */}
      {showReport && <div className="mb-5 flex flex-col gap-3 rounded-xl bg-muted p-3.5 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Bilan client proposé d'office</p>
          <p className="text-xs text-muted-foreground mt-0.5">Page de bilan envoyée au client après l'événement (séances, impressions, photos choisies). Toujours possible à la main depuis la fiche de l'événement.</p>
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

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}
