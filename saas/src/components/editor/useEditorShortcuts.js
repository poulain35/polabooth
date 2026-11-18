import { useEffect } from 'react';

// Raccourcis clavier : annuler, rétablir, copier, coller, dupliquer, grouper, zoom.
export function useEditorShortcuts({
  undo, redo, copyObject, pasteObject, duplicateObject, groupSelected, ungroupSelected, resetCanvasZoom,
  zoomIn, zoomOut,
}) {
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey)                    { e.preventDefault(); undo(); }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))){ e.preventDefault(); redo(); }
      if (mod && e.key === 'c')                                    { e.preventDefault(); copyObject(); }
      if (mod && e.key === 'v')                                    { e.preventDefault(); pasteObject(); }
      if (mod && e.key === 'd')                                    { e.preventDefault(); duplicateObject(); }
      if (mod && e.key === 'g' && !e.shiftKey)                    { e.preventDefault(); groupSelected(); }
      if (mod && e.key === 'g' && e.shiftKey)                     { e.preventDefault(); ungroupSelected(); }
      if (mod && e.key === '0')                                    { e.preventDefault(); resetCanvasZoom(); }
      if (mod && (e.key === '=' || e.key === '+'))                 { e.preventDefault(); zoomIn(); }
      if (mod && e.key === '-')                                    { e.preventDefault(); zoomOut(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo]);
}
