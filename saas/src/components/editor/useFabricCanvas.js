import { useEffect } from 'react';
import { fabric } from 'fabric';
import { isKioskFormat } from '../../utils/formats';
import { ensureKioskFonts } from '../../utils/kioskFonts';
import { fitZoom } from '../../lib/editorFit';
import { registerCustomFonts } from '../../lib/supabase';
import { CANVAS_OVERFLOW_PAD, DEFAULT_BG_COLOR, addPhotoZones } from './canvasStyle';
import { restoreFromJSON } from './canvasState';
import { attachKioskEditing, attachSnapping, createCanvasKeyHandler, installCanvasRendering } from './canvasBehaviors';

// Canvas Fabric recréé à chaque changement de format ou de modèle : rendu, événements, magnétisme, clavier,
// puis contenu (design du client, modèle de la base ou page vierge) et zoom d'ajustement.
export function useFabricCanvas({
  initialCanvasJson, onReady, defaultBgGradient, currentFormat, currentTemplate, neutralPreviewRef,
  setShowPropertiesSheet, setButtonTextFocus, canvasElRef, fabricRef, historyRef, historyIdxRef, isSavingRef,
  initialLoadedRef, setSelectedObject, setObjectVersion, setBgColor, setBgType, setBgGradient, bgTypeRef,
  bgGradientRef, setCanUndo, setCanRedo, setCssZoom, cssZoomRef, fitScaleRef, canvasAreaRef, setSnapGuides,
  snapGridRef, saveHistorySnapshot, applyFitZoom,
}) {
  // ── Canvas initialization ────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasElRef.current) return;

    const fmt = currentFormat;
    const tpl = currentTemplate;

    // Canvas agrandi : (W+2P)×(H+2P) + viewportTransform [1,0,0,1,P,P]
    // → les objets en coordonnées template (0..W, 0..H) s'affichent au centre
    // → les poignées dépassant du template restent visibles dans le gris
    const P = CANVAS_OVERFLOW_PAD;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width:  fmt.canvasWidth  + P * 2,
      height: fmt.canvasHeight + P * 2,
      backgroundColor: tpl?.bgColor || DEFAULT_BG_COLOR,
      preserveObjectStacking: true,
      selection: true,
    });
    fabricRef.current = canvas;

    // Décaler le rendu de P unités → (0,0) template = pixel (P,P) sur le canvas
    canvas.setViewportTransform([1, 0, 0, 1, P, P]);

    installCanvasRendering(canvas, fmt, neutralPreviewRef);

    setBgColor(tpl?.bgColor || DEFAULT_BG_COLOR);

    historyRef.current   = [];
    historyIdxRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setSelectedObject(null);
    setSnapGuides([]);

    // ── Selection events ──
    canvas.on('selection:created', () => setSelectedObject(canvas.getActiveObject() ?? null));
    canvas.on('selection:updated', () => setSelectedObject(canvas.getActiveObject() ?? null));
    canvas.on('selection:cleared', () => { setSelectedObject(null); setShowPropertiesSheet(false); });
    canvas.on('object:modified', () => saveHistorySnapshot(canvas));
    canvas.on('text:changed',    () => saveHistorySnapshot(canvas));
    canvas.on('text:editing:entered', () => setObjectVersion((v) => v + 1));
    canvas.on('text:editing:exited',  () => setObjectVersion((v) => v + 1));

    // Écrans de la borne : biais interdit, double-clic sur un bouton (canvasBehaviors.js).
    if (fmt.kiosk) attachKioskEditing(canvas, { setButtonTextFocus, setShowPropertiesSheet });

    // ── Snap to grid + smart alignment guides ──
    attachSnapping(canvas, fmt, snapGridRef, setSnapGuides);

    // ── Delete + Arrow keys ──
    const handleKey = createCanvasKeyHandler(canvas, { setSelectedObject, setObjectVersion, saveHistorySnapshot });
    window.addEventListener('keydown', handleKey);

    // ── Canvas content init (async for DB templates) ──
    let active = true;
    isSavingRef.current = true;

    async function initContent() {
      // Pré-charger les polices custom AVANT de restaurer le JSON pour éviter
      // que Fabric rende le texte avec la police de secours du navigateur.
      await registerCustomFonts().catch(() => {});
      if (isKioskFormat(fmt)) await ensureKioskFonts();
      if (!active) return;

      // Priorité 1 : design sauvegardé du client (1er chargement uniquement)
      const savedJson = !initialLoadedRef.current && initialCanvasJson
        ? (typeof initialCanvasJson === 'string' ? initialCanvasJson : JSON.stringify(initialCanvasJson))
        : null;

      if (savedJson) {
        initialLoadedRef.current = true;
        const meta = await restoreFromJSON(canvas, fmt, savedJson);
        if (active) {
          setBgColor(meta.bgColor || DEFAULT_BG_COLOR);
          setBgType(meta.bgType || 'solid');
          setBgGradient(meta.bgGradient || defaultBgGradient);
          bgTypeRef.current = meta.bgType || 'solid';
          bgGradientRef.current = meta.bgGradient || null;
        }
      } else if (tpl?.canvas_json) {
        // Priorité 2 : template admin (DB)
        initialLoadedRef.current = true;
        const jsonStr = typeof tpl.canvas_json === 'string'
          ? tpl.canvas_json
          : JSON.stringify(tpl.canvas_json);
        const meta = await restoreFromJSON(canvas, fmt, jsonStr);
        if (active) {
          setBgColor(meta.bgColor || DEFAULT_BG_COLOR);
          setBgType(meta.bgType || 'solid');
          setBgGradient(meta.bgGradient || defaultBgGradient);
          bgTypeRef.current = meta.bgType || 'solid';
          bgGradientRef.current = meta.bgGradient || null;
        }
      } else {
        // Priorité 3 : canvas vierge avec zones photo
        if (tpl?.apply) tpl.apply(canvas, fmt, fabric);
        addPhotoZones(canvas, fmt);
        canvas.renderAll();
      }
      if (!active) return;
      // Auto-fit via CSS transform (Fabric zoom reste à 1 → coordonnées exactes)
      if (canvasAreaRef.current) {
        const isMobile = window.innerWidth < 768;
        const PAD = isMobile ? 8 : 32; // p-2 mobile / p-8 desktop
        const areaW = canvasAreaRef.current.clientWidth  - PAD * 2;
        const areaH = canvasAreaRef.current.clientHeight - PAD * 2;
        applyFitZoom(fitZoom({ areaW, areaH, canvasWidth: fmt.canvasWidth, canvasHeight: fmt.canvasHeight }));
      } else {
        fitScaleRef.current = 1;
        cssZoomRef.current  = 1;
        setCssZoom(1);
      }
      isSavingRef.current = false;
      saveHistorySnapshot(canvas);
      // Polices chargées : l'appelant peut exporter le canvas (publication d'un écran de la borne).
      await document.fonts.ready;
      if (active) onReady?.();
    }
    initContent();

    return () => {
      active = false;
      window.removeEventListener('keydown', handleKey);
      canvas.dispose();
      fabricRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat.id, currentTemplate.id]);
}
