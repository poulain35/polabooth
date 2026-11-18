import { fabric } from 'fabric';
import { DEFAULT_BG_COLOR } from './canvasStyle';
import { applyGradientToCanvas } from './canvasState';

// Fond du modèle : couleur, type (uni ou dégradé), dégradé, fond généré (admin).
export function useBackgroundActions({
  currentFormat, setActivePanel, fabricRef, isSavingRef, bgColor, setBgColor, setBgType, bgGradient,
  setBgGradient, bgTypeRef, bgGradientRef, saveHistorySnapshot,
}) {
  // ── Background ───────────────────────────────────────────────────────────────
  function handleBgColorChange(color) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setBgColor(color);
    bgTypeRef.current = 'solid';
    bgGradientRef.current = null;
    canvas.backgroundColor = color === 'transparent' ? '' : color;
    canvas.renderAll();
    saveHistorySnapshot(canvas);
  }

  function handleBgTypeChange(type) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setBgType(type);
    bgTypeRef.current = type;
    if (type === 'solid') {
      bgGradientRef.current = null;
      canvas.backgroundColor = bgColor || DEFAULT_BG_COLOR;
      canvas.renderAll();
    } else {
      applyGradientToCanvas(canvas, bgGradient, { width: currentFormat.canvasWidth, height: currentFormat.canvasHeight });
    }
    saveHistorySnapshot(canvas);
  }

  function handleBgGradientChange(grad) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setBgGradient(grad);
    bgGradientRef.current = grad;
    bgTypeRef.current = 'gradient';
    applyGradientToCanvas(canvas, grad, { width: currentFormat.canvasWidth, height: currentFormat.canvasHeight });
    saveHistorySnapshot(canvas);
  }

  // ── AI Background ────────────────────────────────────────────────────────────
  function applyAIBackground(imageUrl) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    fabric.Image.fromURL(imageUrl, (img) => {
      const scaleX = currentFormat.canvasWidth  / img.width;
      const scaleY = currentFormat.canvasHeight / img.height;
      const scale  = Math.max(scaleX, scaleY);
      img.set({
        scaleX: scale,
        scaleY: scale,
        left:   (currentFormat.canvasWidth  - img.width  * scale) / 2,
        top:    (currentFormat.canvasHeight - img.height * scale) / 2,
        selectable:  false,
        evented:     false,
        hoverCursor: 'default',
        isAIBackground: true,
      });
      // Supprimer l'ancien fond IA s'il existe
      canvas.getObjects().filter((o) => o.isAIBackground).forEach((o) => canvas.remove(o));
      canvas.add(img);
      // sendToBack place img en index 0 — les zones photo (déjà en bas) remontent d'un cran, ce qui est correct
      canvas.sendToBack(img);
      canvas.renderAll();
      isSavingRef.current = false;
      saveHistorySnapshot(canvas);
      setActivePanel(null);
    }, { crossOrigin: 'anonymous' });
  }

  return {
    handleBgColorChange, handleBgTypeChange, handleBgGradientChange, applyAIBackground,
  };
}
