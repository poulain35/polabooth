// Onglet Code de la page Bornes (/admin/bornes?tab=code, LAB-338) : écran de saisie du code
// événement, commun à toutes les bornes. Déplacé de Paramètres sans changer l'enregistrement.
// Réservé à l'admin de la plateforme (LAB-282) : l'onglet n'est montré qu'à lui (AdminBornes).
import { useEffect, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { getKioskSetupConfig, saveKioskSetupConfig, uploadKioskGlobalSetupBackground } from '../../../lib/supabase';
import { normalizeSetupConfig, setupConfigToSave, SETUP_BG_CREAM, SETUP_BG_IMAGE, KIOSK_CREAM } from '../../../lib/kioskSetupScreen';
import { KIOSK_BG_ACCEPT } from '../../../lib/kioskBackground';
import { Button } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { cn } from '../../../lib/utils';
import { toast } from 'sonner';

const BACKGROUND_OPTIONS = [
  { value: SETUP_BG_CREAM, label: 'Fond crème' },
  { value: SETUP_BG_IMAGE, label: 'Image' },
];

function SetupScreenSection() {
  // LAB-253 : couleurs de la borne fixes (LAB-249) ; seul reste le choix fond crème ou image.
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
    <Card className="p-card">
      <CardTitle as="h2">Écran de saisie du code</CardTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        Arrière-plan de l'écran où les invités entrent leur code événement. S'applique à toutes les bornes.
        Les couleurs de la borne sont celles de l'application.
      </p>

      <SegmentedControl
        aria-label="Arrière-plan de l'écran de saisie"
        className="mt-5"
        value={bgType}
        onValueChange={(value) => set('bg_type', value)}
        options={BACKGROUND_OPTIONS}
      />

      {/* Aperçus : la couleur est celle de la borne (KIOSK_CREAM), pas celle du thème de l'admin. */}
      {bgType === SETUP_BG_CREAM && (
        <div className="light-island mt-4 h-14 w-24 rounded-xl border" style={{ background: KIOSK_CREAM }}/>
      )}

      {bgType === SETUP_BG_IMAGE && (
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <div className="light-island h-24 w-16 shrink-0 overflow-hidden rounded-xl border" style={{ background: KIOSK_CREAM }}>
            {cfg.bg_image_url
              ? <img src={cfg.bg_image_url} alt="Fond saisie" className="h-full w-full object-cover"/>
              : <span className="flex h-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">Aucune image</span>}
          </div>
          <div className="flex min-w-0 flex-1 basis-48 flex-col items-start gap-2">
            <Button asChild>
              <label className={cn(
                'relative cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                uploading && 'pointer-events-none opacity-50',
              )}>
                <input type="file" accept={KIOSK_BG_ACCEPT} className="sr-only" onChange={handleImageUpload} disabled={uploading}/>
                {uploading ? <Loader2 className="animate-spin"/> : <Upload />}
                {uploading ? 'Upload…' : cfg.bg_image_url ? 'Remplacer' : 'Choisir une image'}
              </label>
            </Button>
            {cfg.bg_image_url && (
              <button type="button" onClick={() => set('bg_image_url', null)}
                className="rounded-md text-[13px] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Supprimer l'image
              </button>
            )}
            <p className="text-[13px] text-muted-foreground">PNG ou JPG, 10 Mo au maximum. Sans image, la borne affiche le fond crème.</p>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-3 border-t pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="animate-spin"/>}
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

export default function CodeScreenTab() {
  return (
    <div>
      <SetupScreenSection />
    </div>
  );
}
