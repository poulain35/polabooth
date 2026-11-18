import { FORMATS } from '../../utils/formats';
import { exportAsHighResPNG } from '../../utils/export';
import { downloadUrl } from '../../lib/download';
import { submitDesign, storeDesignImages } from '../../lib/supabase';
import { DEFAULT_BG_COLOR } from './canvasStyle';
import { serializeState } from './canvasState';

// Sorties de l'éditeur : sauvegardes (modèle, client, fonds générés), envoi du client, export PNG.
export function useEditorOutput({
  eventCode, onSubmitSuccess, onSaveTemplate, onSaveRequest, currentFormat, homeMode, storesImages,
  isSubmitting, setIsSubmitting, setSubmitError, setIsSavingTemplate, isSavingClient, setIsSavingClient,
  isDirty, fabricRef, bgTypeRef, bgGradientRef, isExporting, setIsExporting, setExportProgress,
  setExportMenuOpen,
}) {
  // ── Save template for all 4 formats (admin, AI backgrounds) ─────────────────
  async function handleSaveAllFormats(templateName, backgrounds) {
    if (!onSaveTemplate) return;

    // Dimensions de génération (doivent correspondre à celles de l'edge function)
    const GEN_DIMS = {
      portrait:  { imgW: 832,  imgH: 1248 },
      landscape: { imgW: 1248, imgH: 832  },
      stripV:    { imgW: 512,  imgH: 1536 },
      stripH:    { imgW: 1536, imgH: 512  },
    };

    for (const [fmtId, bgUrl] of Object.entries(backgrounds)) {
      const fmt = FORMATS[fmtId];
      if (!fmt || !bgUrl) continue;

      const { imgW, imgH } = GEN_DIMS[fmtId];
      const scale = Math.max(fmt.canvasWidth / imgW, fmt.canvasHeight / imgH);
      const left  = (fmt.canvasWidth  - imgW * scale) / 2;
      const top   = (fmt.canvasHeight - imgH * scale) / 2;

      const canvasJson = {
        bg:         DEFAULT_BG_COLOR,
        bgType:     'solid',
        bgGradient: null,
        objects: [
          {
            type: 'image', version: '5.3.0',
            originX: 'left', originY: 'top',
            left, top,
            width: imgW, height: imgH,
            scaleX: scale, scaleY: scale,
            src: bgUrl,
            selectable: false, evented: false,
            hoverCursor: 'default',
            isAIBackground: true,
          },
          ...fmt.photoZones.map((zone) => ({
            type: 'rect', version: '5.3.0',
            originX: 'left', originY: 'top',
            left: zone.x, top: zone.y,
            width: zone.w, height: zone.h,
            fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
            isPhotoZone: true, lockRotation: true,
            selectable: true, evented: true,
          })),
        ],
      };

      // LAB-348 : l'adresse Replicate expire ; le fond est rangé dans le stockage (repli : inchangé).
      const stored = await storeDesignImages(canvasJson, null);
      await onSaveTemplate({
        name:       `${templateName} · ${fmt.label}`,
        canvasJson: stored,
        previewUrl: stored.objects[0].src,
        formatId:   fmtId,
      });
    }
  }

  // ── Save (client) ────────────────────────────────────────────────────────────
  async function handleClientSave() {
    if (!isDirty || !onSaveRequest || isSavingClient) return;
    setIsSavingClient(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      await onSaveRequest();
    } finally {
      setIsSavingClient(false);
    }
  }

  // ── Save as template (admin) ─────────────────────────────────────────────────
  async function handleSaveTemplateClick() {
    if (!onSaveTemplate) return;
    setIsSavingTemplate(true);
    // Laisser React peindre le spinner avant les opérations bloquantes (toDataURL est synchrone)
    await new Promise((r) => setTimeout(r, 50));
    try {
      const canvas = fabricRef.current;
      const canvasJson = JSON.parse(serializeState(canvas, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current }));
      // canvas.toDataURL() échoue silencieusement si une image externe (Supabase Storage)
      // n'a pas les headers CORS — on attrape l'erreur et on laisse l'appelant gérer le fallback.
      let previewUrl = null;
      try {
        const origW = canvas.width;
        const origH = canvas.height;
        const origVT = canvas.viewportTransform.slice();
        const needsReset = origW !== currentFormat.canvasWidth || origH !== currentFormat.canvasHeight;
        if (needsReset) {
          canvas._exportMode = true;
          canvas.setWidth(currentFormat.canvasWidth);
          canvas.setHeight(currentFormat.canvasHeight);
          canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
          canvas.renderAll();
        }
        previewUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.75, multiplier: 0.5 });
        if (needsReset) {
          canvas.setWidth(origW);
          canvas.setHeight(origH);
          canvas.setViewportTransform(origVT);
          canvas._exportMode = false;
          canvas.renderAll();
        }
      } catch (e) {
        console.warn('toDataURL bloqué (canvas tainted) — preview non régénérée', e.message);
      }
      const savedJson = storesImages ? await storeDesignImages(canvasJson, null) : canvasJson;
      await onSaveTemplate({ canvasJson: savedJson, previewUrl, formatId: currentFormat.id });
    } catch (err) {
      console.error('Sauvegarde échouée :', err);
    } finally {
      setIsSavingTemplate(false);
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!fabricRef.current || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const pngBase64  = await exportAsHighResPNG(fabricRef.current, currentFormat);
      const canvasJson = await storeDesignImages(
        JSON.parse(serializeState(fabricRef.current, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current })),
        eventCode,
      );
      await submitDesign({ code: eventCode, canvasJson, format: currentFormat.id, pngBase64, kind: homeMode ? 'home' : 'print' });
      onSubmitSuccess?.();
    } catch (err) {
      setSubmitError(err.message ?? 'Erreur lors de la soumission');
      setIsSubmitting(false);
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  async function handleExport(punchZones = true) {
    if (!fabricRef.current || isExporting) return;
    setExportMenuOpen(false);
    setIsExporting(true);
    setExportProgress(`Génération ${currentFormat.exportWidth}×${currentFormat.exportHeight}px…`);
    try {
      const dataURL = await exportAsHighResPNG(fabricRef.current, currentFormat, { punchZones });
      const suffix = punchZones ? '' : '-fond-plein';
      downloadUrl(dataURL, `template-photobooth-${currentFormat.id}${suffix}.png`);
      setExportProgress('');
    } catch (err) {
      console.error('Export failed:', err);
      setExportProgress('Erreur export');
    } finally {
      setIsExporting(false);
    }
  }

  return {
    handleSaveAllFormats, handleClientSave, handleSaveTemplateClick, handleSubmit, handleExport,
  };
}
