import { useCallback } from 'react';
import { designImageStore } from '../../lib/supabase';
import { DEFAULT_BG_COLOR } from './canvasStyle';
import { restoreFromJSON, serializeState } from './canvasState';
import { liveImageSources } from './imageTools';

// Historique (annuler / rétablir) et envoi différé des images. Refs et setters viennent de l'éditeur :
// les dépendances de undo / redo restent celles d'origine (format et dégradé par défaut).
export function useEditorHistory({
  eventCode, defaultBgGradient, currentFormat, storesImages, imagePrefetchTimerRef, fabricRef, historyRef,
  historyIdxRef, isSavingRef, onChangeRef, setSelectedObject, setBgColor, setBgType, setBgGradient, bgTypeRef,
  bgGradientRef, setCanUndo, setCanRedo, markDirty,
}) {
  // ── History ──────────────────────────────────────────────────────────────────
  // Envoi des nouvelles images 1,5 s après la dernière modification : seules celles restées dans le
  // modèle partent (une teinte essayée puis changée n'est pas envoyée). La sauvegarde attend ces envois.
  function scheduleImagePrefetch() {
    if (!storesImages) return;
    clearTimeout(imagePrefetchTimerRef.current);
    imagePrefetchTimerRef.current = setTimeout(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const sources = liveImageSources(canvas.getObjects());
      if (sources.size) designImageStore(eventCode).prefetch(sources);
    }, 1500);
  }

  function saveHistorySnapshot(canvas) {
    if (isSavingRef.current) return;
    scheduleImagePrefetch();
    const json = serializeState(canvas, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current });
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(json);
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
    markDirty();
    onChangeRef.current?.();
  }

  const undo = useCallback(async () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    isSavingRef.current = true;
    const meta = await restoreFromJSON(fabricRef.current, currentFormat, historyRef.current[historyIdxRef.current]);
    isSavingRef.current = false;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
    setSelectedObject(null);
    setBgColor(meta.bgColor || DEFAULT_BG_COLOR);
    setBgType(meta.bgType || 'solid');
    setBgGradient(meta.bgGradient || defaultBgGradient);
    bgTypeRef.current = meta.bgType || 'solid';
    bgGradientRef.current = meta.bgGradient || null;
    onChangeRef.current?.();
  // Refs et setters stables reçus de l'éditeur : mêmes dépendances qu'avant le découpage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat, defaultBgGradient]);

  const redo = useCallback(async () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    isSavingRef.current = true;
    const meta = await restoreFromJSON(fabricRef.current, currentFormat, historyRef.current[historyIdxRef.current]);
    isSavingRef.current = false;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
    setSelectedObject(null);
    setBgColor(meta.bgColor || DEFAULT_BG_COLOR);
    setBgType(meta.bgType || 'solid');
    setBgGradient(meta.bgGradient || defaultBgGradient);
    bgTypeRef.current = meta.bgType || 'solid';
    bgGradientRef.current = meta.bgGradient || null;
    onChangeRef.current?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat, defaultBgGradient]);

  return {
    saveHistorySnapshot, undo, redo,
  };
}
