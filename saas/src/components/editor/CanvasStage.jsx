import { BLEED_COLOR, CANVAS_OVERFLOW_PAD, CANVAS_WORKSPACE } from './canvasStyle';
import { HomeScreenOverlay, KioskScreenOverlay } from './CanvasOverlays';

// ─── Snap guide dimension label ──────────────────────────────────────────────

function DimPill({ x, y, value }) {
  const text = String(value);
  const w = Math.max(26, text.length * 5.5 + 12);
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-8} width={w} height={16} rx={4} style={{ fill: 'var(--editor-accent, hsl(var(--primary)))' }} />
      <text
        textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={9} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >{text}</text>
    </g>
  );
}

// Zone de travail : canvas agrandi (zoom CSS), fond perdu, repères de la borne et du magnétisme.
export default function CanvasStage({
  formatBleedOverrides, currentFormat, currentTemplate, homeMode, kioskMode, canvasElRef, cssZoom,
  canvasAreaRef, canvasInnerDivRef, snapGuides, handleCanvasContextMenu, handleCanvasTouchStart,
  handleCanvasTouchMove, handleCanvasTouchEnd, transparentKioskBg,
}) {
  // Canvas area
  return (
    <div
      ref={canvasAreaRef}
      className="flex-1 flex overflow-auto p-2 md:p-8"
      style={{ background: CANVAS_WORKSPACE }}
    >
      {/* Outer div : (W+2P)×(H+2P) scaled — contient le canvas agrandi et l'ombre du template */}
      <div style={{
        width:      (currentFormat.canvasWidth  + CANVAS_OVERFLOW_PAD * 2) * cssZoom,
        height:     (currentFormat.canvasHeight + CANVAS_OVERFLOW_PAD * 2) * cssZoom,
        flexShrink: 0,
        margin:     'auto',
        position:   'relative',
      }}>
        {/* Ombre du template — positionnée au-dessus du padding, taille W×H */}
        <div className={`canvas-shadow${transparentKioskBg ? ' checkerboard' : ''}`} style={{
          position:      'absolute',
          left:          CANVAS_OVERFLOW_PAD * cssZoom,
          top:           CANVAS_OVERFLOW_PAD * cssZoom,
          width:         currentFormat.canvasWidth  * cssZoom,
          height:        currentFormat.canvasHeight * cssZoom,
          pointerEvents: 'none',
          // Écran de la borne à fond transparent : damier sous le canvas (jamais exporté).
          ...(transparentKioskBg ? { '--checker-size': `${16 * cssZoom}px` } : null),
        }} />
        {/* Inner div : canvas agrandi (W+2P)×(H+2P), CSS transform scale */}
        <div
          ref={canvasInnerDivRef}
          key={`${currentFormat.id}-${currentTemplate.id}`}
          className="relative touch-none"
          style={{
            width:           currentFormat.canvasWidth  + CANVAS_OVERFLOW_PAD * 2,
            height:          currentFormat.canvasHeight + CANVAS_OVERFLOW_PAD * 2,
            transform:       `scale(${cssZoom})`,
            transformOrigin: 'top left',
            overflow:        'visible',
          }}
          onContextMenu={handleCanvasContextMenu}
          onTouchStart={handleCanvasTouchStart}
          onTouchMove={handleCanvasTouchMove}
          onTouchEnd={handleCanvasTouchEnd}
        >
          <canvas ref={canvasElRef} />

          {/* Bleed guide overlay — affiché dans l'éditeur, absent de l'export PNG */}
          {!homeMode && !kioskMode && (() => {
            const bleedMm = formatBleedOverrides?.[currentFormat.id] ?? currentFormat.bleedMm ?? 3;
            const bleedPx = Math.round(bleedMm * (currentFormat.pxPerMm ?? 4));
            if (bleedPx <= 0) return null;
            const W = currentFormat.canvasWidth;
            const H = currentFormat.canvasHeight;
            return (
              <svg
                style={{
                  position:      'absolute',
                  left:          CANVAS_OVERFLOW_PAD,
                  top:           CANVAS_OVERFLOW_PAD,
                  pointerEvents: 'none',
                }}
                width={W}
                height={H}
              >
                {/* 4 lignes de fond de coupe */}
                <line x1={bleedPx} y1={0} x2={bleedPx} y2={H} stroke={BLEED_COLOR} strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                <line x1={W - bleedPx} y1={0} x2={W - bleedPx} y2={H} stroke={BLEED_COLOR} strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                <line x1={0} y1={bleedPx} x2={W} y2={bleedPx} stroke={BLEED_COLOR} strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                <line x1={0} y1={H - bleedPx} x2={W} y2={H - bleedPx} stroke={BLEED_COLOR} strokeWidth={1} strokeDasharray="5 3" opacity={0.75} />
                {/* Labels dans les angles */}
                <text x={bleedPx + 3} y={bleedPx - 3} fontSize={7} fill={BLEED_COLOR} fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600" opacity={0.9}>Zone perdue</text>
                <text x={W - bleedPx - 3} y={H - bleedPx + 9} fontSize={7} fill={BLEED_COLOR} fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600" textAnchor="end" opacity={0.9}>Zone perdue</text>
              </svg>
            );
          })()}

          {/* Écran d'accueil : zone de sécurité 16:10 et pastille de la borne, absentes de l'export */}
          {homeMode && <HomeScreenOverlay format={currentFormat} />}

          {/* Écrans de la borne composés par l'admin : zone 16:10 et cadenas, absents de l'export */}
          {kioskMode && <KioskScreenOverlay format={currentFormat} />}

          {/* Smart alignment guides overlay — positionnés dans la zone template */}
          {snapGuides.length > 0 && (
            <svg
              style={{
                position:      'absolute',
                left:          CANVAS_OVERFLOW_PAD,
                top:           CANVAS_OVERFLOW_PAD,
                pointerEvents: 'none',
              }}
              width={currentFormat.canvasWidth}
              height={currentFormat.canvasHeight}
            >
              {snapGuides.map((g, i) => {
                const cw = currentFormat.canvasWidth;
                const ch = currentFormat.canvasHeight;
                if (g.type === 'v') {
                  const d1 = Math.round(g.pos);
                  const d2 = Math.round(cw - g.pos);
                  return (
                    <g key={i}>
                      <line x1={g.pos} y1={0} x2={g.pos} y2={ch}
                        style={{ stroke: 'var(--editor-accent, hsl(var(--primary)))' }} strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />
                      {d1 > 24 && <DimPill x={g.pos / 2}      y={ch / 2} value={d1} />}
                      {d2 > 24 && <DimPill x={g.pos + d2 / 2} y={ch / 2} value={d2} />}
                    </g>
                  );
                } else {
                  const d1 = Math.round(g.pos);
                  const d2 = Math.round(ch - g.pos);
                  return (
                    <g key={i}>
                      <line x1={0} y1={g.pos} x2={cw} y2={g.pos}
                        style={{ stroke: 'var(--editor-accent, hsl(var(--primary)))' }} strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />
                      {d1 > 24 && <DimPill x={cw / 2} y={g.pos / 2}      value={d1} />}
                      {d2 > 24 && <DimPill x={cw / 2} y={g.pos + d2 / 2} value={d2} />}
                    </g>
                  );
                }
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
