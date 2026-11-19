import { useLayoutEffect, useRef, useState } from 'react';
import { Separator } from '../ui/separator';

// ─── Floating object toolbar (mobile, Canva-style) ────────────────────────────

function FTBtn({ d, label, onClick, danger, active }) {
  return (
    <button onClick={onClick} title={label}
      className={`w-10 h-10 flex items-center justify-center rounded-editor-tool transition-colors
        ${danger ? 'text-destructive/70 hover:bg-destructive/10 hover:text-destructive'
        : active ? 'text-editor-warning-fg bg-editor-warning'
        :          'text-editor-ink hover:bg-editor-item-hover hover:text-editor-item-hover-fg'}`}>
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </button>
  );
}

export default function FloatingObjectToolbar({ obj, version, cssZoom, canvasDivRef, onDelete, onDuplicate, onToggleLock, onOpenProperties }) {
  const ref = useRef(null);
  const [style, setStyle] = useState({ visibility: 'hidden', position: 'fixed', zIndex: 55 });

  useLayoutEffect(() => {
    const hidden = { visibility: 'hidden', position: 'fixed', zIndex: 55 };
    if (!obj || !canvasDivRef.current) { setStyle(hidden); return; }
    if ((obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') && obj.isEditing) { setStyle(hidden); return; }

    // canvasDivRef pointe sur le div CSS-transform (scale(cssZoom), transform-origin: top left)
    // Sa BCR donne le coin haut-gauche en coordonnées viewport après le scale
    const cr = canvasDivRef.current.getBoundingClientRect();

    const br = obj.getBoundingRect(); // coordonnées canvas (Fabric zoom = 1)

    const centerX = cr.left + (br.left + br.width  / 2) * cssZoom;
    const topY    = cr.top  +  br.top                   * cssZoom;
    const botY    = cr.top  + (br.top + br.height)      * cssZoom;

    const toolbarH = ref.current?.offsetHeight ?? 48;
    const toolbarW = ref.current?.offsetWidth  ?? 220;
    // 56px = padding Fabric (6) + demi-coin (5) + rotatingPointOffset (40) + marge visuelle (5)
    const MARGIN   = 56;

    let top = topY - toolbarH - MARGIN;
    if (top < 56) top = botY + MARGIN;

    const left = Math.max(toolbarW / 2 + 4, Math.min(window.innerWidth - toolbarW / 2 - 4, centerX));

    setStyle({ visibility: 'visible', position: 'fixed', zIndex: 55, top, left, transform: 'translateX(-50%)' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, version, cssZoom]);

  if (!obj) return null;

  return (
    <div
      ref={ref}
      style={style}
      className="md:hidden flex items-center bg-card border border-editor-line rounded-editor-popover shadow-editor-float px-1 py-1 gap-0.5"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <FTBtn
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        label="Modifier" onClick={onOpenProperties}
      />
      <Separator orientation="vertical" className="h-6 mx-0.5" />
      {!obj.isPhotoZone && (
        <FTBtn
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          label="Dupliquer" onClick={onDuplicate}
        />
      )}
      <FTBtn
        d={obj.locked
          ? 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
          : 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z'}
        label={obj.locked ? 'Déverrouiller' : 'Verrouiller'}
        onClick={onToggleLock}
        active={!!obj.locked}
      />
      <Separator orientation="vertical" className="h-6 mx-0.5" />
      <FTBtn
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        label="Supprimer" onClick={onDelete} danger
      />
    </div>
  );
}
