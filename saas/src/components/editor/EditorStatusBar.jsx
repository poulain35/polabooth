// Barre d'état (grand écran) et barre de zoom (téléphone). `fitScale` : zoom d'ajustement, plancher du dézoom.
export function EditorStatusBar({
  currentFormat, selectedObject, cssZoom, resetCanvasZoom, zoomIn, zoomOut, fitScale,
}) {
  // Status bar — cachée sur mobile (remplacée par la Toolbar fixe)
  return (
    <div className="hidden md:flex h-8 bg-editor-soft border-t border-editor-line items-center px-4 shrink-0 gap-3">
      <span className="text-[11px] text-editor-faint flex-1 select-none">
        {currentFormat.exportWidth}×{currentFormat.exportHeight} px
        {selectedObject && (
          <span className="ml-3 text-editor-accent-fg">
            {(selectedObject.type === 'i-text' || selectedObject.type === 'text' || selectedObject.type === 'textbox')
              ? '· double-clic pour éditer'
              : '· clic droit pour options'}
          </span>
        )}
      </span>

      {/* Contrôles de zoom desktop */}
      <div className="flex items-center bg-card border border-editor-line rounded-editor-item shadow-editor-subtle overflow-hidden">
        <button
          onClick={zoomOut}
          disabled={cssZoom <= fitScale + 0.02}
          title="Dézoomer (Ctrl+−)"
          aria-label="Zoom arrière"
          className="w-7 h-7 flex items-center justify-center text-editor-ink text-base font-medium
            hover:bg-editor-hover disabled:opacity-25 transition-colors border-r border-editor-line"
        >−</button>
        <button
          onClick={resetCanvasZoom}
          title="Ajuster à l'écran (Ctrl+0)"
          className="px-2.5 h-7 text-[11px] font-editor-strong text-editor-ink tabular-nums
            hover:bg-editor-hover transition-colors min-w-[48px] text-center border-r border-editor-line"
        >{Math.round(cssZoom * 100)}%</button>
        <button
          onClick={zoomIn}
          disabled={cssZoom >= 4}
          title="Zoomer (Ctrl+=)"
          aria-label="Zoom avant"
          className="w-7 h-7 flex items-center justify-center text-editor-ink text-base font-medium
            hover:bg-editor-hover disabled:opacity-25 transition-colors"
        >+</button>
      </div>
    </div>
  );
}

export function MobileZoomBar({
  activePanel, cssZoom, resetCanvasZoom, zoomIn, zoomOut, fitScale,
}) {
  // Barre de zoom mobile (masquée sous un panneau plein écran, LAB-353)
  return (
    <div className={`${activePanel ? 'hidden' : 'md:hidden'} fixed bottom-[68px] right-3 z-40 flex items-center
      bg-card/95 backdrop-blur-sm border border-editor-line rounded-full shadow-editor-raised px-1 py-1 gap-0.5`}>
      {cssZoom > fitScale + 0.02 && (
        <>
          <button onClick={zoomOut} aria-label="Zoom arrière"
            className="w-8 h-8 flex items-center justify-center rounded-full text-editor-ink
              hover:bg-editor-hover transition-colors text-lg font-medium">−</button>
          <button onClick={resetCanvasZoom}
            className="px-2 min-w-[46px] text-center text-xs font-editor-strong text-editor-ink
              hover:text-editor-accent-fg transition-colors"
            title="Ajuster à l'écran"
          >{Math.round(cssZoom * 100)}%</button>
        </>
      )}
      <button onClick={zoomIn} disabled={cssZoom >= 4} aria-label="Zoom avant"
        className="w-8 h-8 flex items-center justify-center rounded-full text-editor-ink
          hover:bg-editor-hover disabled:opacity-30 transition-colors text-lg font-medium">+</button>
    </div>
  );
}
