import { useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '../ui/button';
import KioskPreview from '../KioskPreview';
import { screenSourceFromPlan } from '../../lib/kioskDesignedScreen';
import { screenStatus } from '../../lib/kioskScreensPublish';
import { kioskScreenTemplate } from '../../lib/kioskScreenTemplates';
import { renderScreenSource } from '../../utils/renderDesign';

/**
 * Aperçu sur la borne d'un écran composé depuis sa carte (LAB-309, spec apercu-borne D11) : la
 * version publiée, celle que les bornes affichent ; sans publication, le brouillon (ou le modèle
 * d'origine) découpé comme à la publication. Valeurs d'exemple, cases « Fonction coupée ».
 */
export default function KioskScreenPreviewButton({ kind, row }) {
  const [preview, setPreview] = useState(null);
  const runRef = useRef(0);

  async function open() {
    if (runRef.current) return;
    const run = Date.now();
    runRef.current = run;
    setPreview({ status: 'preparing', source: null });
    try {
      const status = screenStatus(row);
      let source = status.published ? screenSourceFromPlan(row.published) : null;
      let note;
      if (source) {
        note = status.unpublishedChanges
          ? 'Version publiée : vos dernières modifications ne sont pas encore publiées.'
          : 'Version publiée, telle que les bornes l’affichent.';
      } else {
        source = await renderScreenSource(row?.draft_json ?? kioskScreenTemplate(kind), kind);
        note = row?.draft_json
          ? 'Brouillon, pas encore publié : les bornes affichent encore leur écran standard.'
          : 'Modèle d’origine, pas encore publié.';
      }
      if (!source) throw new Error("Plan de l'écran refusé par la borne.");
      if (runRef.current === run) setPreview({ status: 'ready', source: { ...source, note } });
    } catch (err) {
      console.error('Aperçu sur la borne :', err);
      if (runRef.current === run) setPreview({ status: 'error', source: null });
    }
  }

  function close() {
    runRef.current = 0;
    setPreview(null);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={open} disabled={Boolean(preview)}>
        <Monitor className="w-4 h-4" />
        Aperçu
      </Button>
      {preview && (
        <KioskPreview status={preview.status} source={preview.source} onClose={close} showCutFunctions />
      )}
    </>
  );
}
