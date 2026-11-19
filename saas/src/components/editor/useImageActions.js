import { FabricImage } from '../../lib/fabric.js';
import { svgToBitmap, tintElement, tintGroup } from './imageTools';

// Stickers (ajout et teinte) et suppression de l'arrière-plan d'une image. `removeBackground` : détourage
// fourni par le module privé « ai_visuals » (hook 'editor.removeBackground', LAB-422), null sans lui.
export function useImageActions({
  eventCode, currentFormat, isRemovingBg, setIsRemovingBg, setRemoveBgError, fabricRef, addObjectToCanvas,
  handleObjectChange, removeBackground = null,
}) {
  // ── Sticker ──────────────────────────────────────────────────────────────────
  async function addSticker(srcOrSvg) {
    const canvas = fabricRef.current;
    if (!canvas || !srcOrSvg) return;

    const isPng = typeof srcOrSvg === 'string'
      && /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(srcOrSvg)
      && !/\.svg(\?|$)/i.test(srcOrSvg);

    if (isPng) {
      addStickerImage(srcOrSvg, { crossOrigin: 'anonymous' });
      return;
    }

    let svgString = srcOrSvg;

    // If it's a URL (starts with / or http), fetch the SVG text first
    if (srcOrSvg.startsWith('/') || srcOrSvg.startsWith('http')) {
      try {
        const res = await fetch(srcOrSvg);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        svgString = await res.text();
      } catch (err) {
        console.warn('Sticker fetch failed:', err);
        return;
      }
    }

    // Rasteriser à la résolution d'export pour conserver la netteté à l'agrandissement
    const exportRes = Math.max(currentFormat.exportWidth, currentFormat.exportHeight);
    const dataUrl = await svgToBitmap(svgString, exportRes);
    if (dataUrl) await addStickerImage(dataUrl);
  }

  // Image du sticker centrée, 80 px au plus. Fabric 7 rejette si l'image ne se charge pas.
  async function addStickerImage(url, options) {
    let img;
    try {
      img = await FabricImage.fromURL(url, options);
    } catch (err) {
      console.warn('Sticker introuvable :', err);
      return;
    }
    const maxDim = Math.max(img.width || 80, img.height || 80);
    const scale  = Math.min(80, currentFormat.canvasWidth * 0.25) / maxDim;
    img.scale(scale);
    img.set({ left: currentFormat.canvasWidth / 2, top: currentFormat.canvasHeight / 2, originX: 'center', originY: 'center' });
    img.isSticker = true;
    img.setCoords();
    addObjectToCanvas(img);
  }

  // ── Couleur de sticker ───────────────────────────────────────────────────────

  function applyStickerColor(targetObj, color) {
    const canvas = fabricRef.current;
    if (!targetObj?.isSticker || !canvas) return;

    const isTransparent = !color || color === 'transparent';

    if (targetObj.type === 'image') {
      const el = targetObj.getElement();
      // Mémoriser le src original (data URL) avant la première teinte
      if (!targetObj._origSrc) targetObj._origSrc = el.src || el.currentSrc;

      const srcToApply = isTransparent ? targetObj._origSrc : (() => {
        const w   = el.naturalWidth  || el.width  || 300;
        const h   = el.naturalHeight || el.height || 300;
        const oc  = document.createElement('canvas');
        oc.width  = w;
        oc.height = h;
        const ctx = oc.getContext('2d');
        // Remplir avec la couleur, puis masquer par l'alpha de l'image (destination-in)
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(el, 0, 0, w, h);
        return oc.toDataURL('image/png');
      })();

      // crossOrigin : le src d'origine peut être une adresse du stockage (LAB-348) ; sans lui,
      // l'image rechargée « salirait » le canvas et l'export PNG échouerait.
      targetObj.setSrc(srcToApply, { crossOrigin: 'anonymous' }).then(() => {
        targetObj.stickerTintColor = isTransparent ? null : color;
        canvas.renderAll();
        handleObjectChange();
      }, (err) => console.warn('Teinte du sticker impossible :', err));
      return; // handleObjectChange appelé une fois l'image rechargée
    } else if (targetObj.type === 'group') {
      tintGroup(targetObj, color, isTransparent);
    } else {
      // SVG à élément unique (path, rect, etc.)
      tintElement(targetObj, color, isTransparent);
    }

    targetObj.stickerTintColor = isTransparent ? null : color;
    canvas.renderAll();
    handleObjectChange();
  }

  // ── Suppression d'arrière-plan (admin) ────────────────────────────────────────
  async function handleRemoveBackground() {
    const canvas = fabricRef.current;
    if (!canvas || isRemovingBg || !removeBackground) return;
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'image') return;

    setIsRemovingBg(true);
    setRemoveBgError('');
    try {
      await removeBackground({ canvas, obj, eventCode });
      handleObjectChange();
    } catch (err) {
      setRemoveBgError(err.message ?? 'Erreur inconnue');
      setTimeout(() => setRemoveBgError(''), 3000);
    } finally {
      setIsRemovingBg(false);
    }
  }

  return {
    addSticker, applyStickerColor, handleRemoveBackground,
  };
}
