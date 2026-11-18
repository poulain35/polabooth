import { useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '../ui/button';
import KioskPreview from '../KioskPreview';
import { prepareStoredDesignPreview } from '../../lib/kioskPreview';
import { kioskPreviewBlock, previewContext } from '../../lib/kioskPreviewContext';
import { getPublishedKioskScreen } from '../../lib/supabase';

/**
 * Aperçu sur la borne depuis la fiche de l'événement (LAB-308, spec apercu-borne D6 et D7) : le PNG
 * envoyé par le client, celui que la borne reçoit, avec les valeurs de l'événement (nom, date,
 * formats, tirages). `kind` : 'print' (modèle photo) ou 'home'. Le modèle
 * photo se voit aussi dans l'écran de partage publié par l'organisation (LAB-309).
 * Sans PNG final, pas de bouton.
 */
export default function EventKioskPreviewButton({ kind, design, event }) {
  const [preview, setPreview] = useState(null);
  const runRef = useRef(0);

  if (!design?.final_png_url) return null;

  async function open() {
    if (runRef.current) return;
    const run = Date.now();
    runRef.current = run;
    let context = previewContext({ event, block: kioskPreviewBlock(event?.form_config) });
    setPreview({ status: 'preparing', source: null, context });
    try {
      if (kind === 'print' && event?.org_id) {
        const resultScreen = await getPublishedKioskScreen('result', event.org_id).catch((err) => {
          console.warn('Écran de partage publié :', err);
          return null;
        });
        context = previewContext({ event, block: kioskPreviewBlock(event?.form_config, resultScreen) });
      }
      const source = await prepareStoredDesignPreview({
        kind, format: design.format, finalPngUrl: design.final_png_url, canvasJson: design.canvas_json,
      });
      if (runRef.current === run) setPreview({ status: 'ready', source, context });
    } catch (err) {
      console.error('Aperçu sur la borne :', err);
      if (runRef.current === run) setPreview({ status: 'error', source: null, context });
    }
  }

  function close() {
    runRef.current = 0;
    setPreview(null);
  }

  return (
    <>
      <Button variant="outline" onClick={open} disabled={Boolean(preview)} className="w-full mb-3">
        <Monitor className="w-4 h-4" />
        Aperçu sur la borne
      </Button>
      {preview && (
        <KioskPreview status={preview.status} source={preview.source} context={preview.context} onClose={close}
          showCutFunctions />
      )}
    </>
  );
}
