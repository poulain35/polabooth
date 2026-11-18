import { useLayoutEffect, useRef, useState } from 'react';
import { Separator } from '../ui/separator';

// ─── Context menu ─────────────────────────────────────────────────────────────

function CMenuItem({ label, icon, onClick, danger, kbd }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`flex items-center justify-between gap-2 w-full px-3 py-1.5 text-sm transition-colors rounded-editor-item
        ${danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-editor-ink hover:bg-editor-item-hover hover:text-editor-item-hover-fg'}`}
    >
      <span className="flex items-center gap-2.5">
        {icon && (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        )}
        {label}
      </span>
      {kbd && <span className="text-[10px] text-editor-muted shrink-0">{kbd}</span>}
    </button>
  );
}

function CMSubmenu({ label, icon, children }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  function show() { clearTimeout(timerRef.current); setOpen(true); }
  function scheduleHide() { timerRef.current = setTimeout(() => setOpen(false), 250); }

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors rounded-editor-item
          text-editor-ink hover:bg-editor-item-hover hover:text-editor-item-hover-fg"
      >
        <span className="flex items-center gap-2.5">
          {icon && (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
          )}
          {label}
        </span>
        <svg className="w-3 h-3 text-editor-faint shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-full top-0 -ml-px bg-card border border-editor-line
            rounded-xl shadow-editor-float py-1.5 min-w-[190px] z-10"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function CMDivider() { return <Separator className="my-1" />; }

export default function ContextMenu({ pos: initialPos, onClose, actions }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999 }); // hidden until measured

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    let x = initialPos.x;
    let y = initialPos.y;
    if (x + width  > window.innerWidth)  x = Math.max(0, x - width);
    if (y + height > window.innerHeight) y = Math.max(0, y - height);
    setPos({ x, y });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { onCopy, onPaste, hasPaste, isPhotoZone,
          onDuplicate, onToggleLock, isLocked,
          onBringToFront, onBringForward, onSendBackward, onSendToBack,
          onAlignLeft, onAlignCenterH, onAlignRight,
          onAlignTop,  onAlignCenterV, onAlignBottom,
          onDelete } = actions;

  function run(fn) { fn?.(); onClose(); }

  return (
    <div
      ref={menuRef}
      className="fixed z-[60] bg-card border border-editor-line rounded-xl shadow-editor-float p-1.5 min-w-[210px]"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!isPhotoZone && (
        <CMenuItem label="Copier"    icon="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" kbd="Ctrl+C" onClick={() => run(onCopy)} />
      )}
      <CMenuItem label="Coller"    icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" kbd="Ctrl+V" onClick={() => run(onPaste)} danger={!hasPaste} />
      {!isPhotoZone && (
        <CMenuItem label="Dupliquer" icon="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" kbd="Ctrl+D" onClick={() => run(onDuplicate)} />
      )}

      <CMDivider />

      <CMenuItem
        label={isLocked ? 'Déverrouiller' : 'Verrouiller'}
        icon={isLocked
          ? 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
          : 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z'}
        onClick={() => run(onToggleLock)}
      />

      <CMDivider />

      <CMSubmenu label="Calques" icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10">
        <CMenuItem label="Premier plan"        icon="M5 11l7-7 7 7M5 19l7-7 7 7" onClick={() => run(onBringToFront)} />
        <CMenuItem label="Avancer d'un niveau" icon="M5 15l7-7 7 7"              onClick={() => run(onBringForward)} />
        <CMenuItem label="Reculer d'un niveau" icon="M19 9l-7 7-7-7"             onClick={() => run(onSendBackward)} />
        <CMenuItem label="Arrière-plan"        icon="M19 9l-7 7-7-7M19 17l-7 7-7-7" onClick={() => run(onSendToBack)} />
      </CMSubmenu>

      <CMSubmenu label="Aligner" icon="M4 6h16M4 12h16M4 18h16">
        <p className="px-3 pt-1 pb-0.5 text-editor-xs font-editor-strong text-editor-muted editor-overline">Horizontal</p>
        <CMenuItem label="Gauche"  icon="M4 6h16M4 12h8M4 18h12"  onClick={() => run(onAlignLeft)} />
        <CMenuItem label="Centre"  icon="M4 6h16M8 12h8M6 18h12"  onClick={() => run(onAlignCenterH)} />
        <CMenuItem label="Droite"  icon="M4 6h16M12 12h8M8 18h12" onClick={() => run(onAlignRight)} />
        <CMDivider />
        <p className="px-3 pt-0.5 pb-0.5 text-editor-xs font-editor-strong text-editor-muted editor-overline">Vertical</p>
        <CMenuItem label="Haut"    icon="M5 3h14M12 21V7"          onClick={() => run(onAlignTop)} />
        <CMenuItem label="Centre"  icon="M12 3v18M3 12h18"         onClick={() => run(onAlignCenterV)} />
        <CMenuItem label="Bas"     icon="M5 21h14M12 3v14"         onClick={() => run(onAlignBottom)} />
      </CMSubmenu>

      <CMDivider />

      <CMenuItem label="Effacer" danger
        icon="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        onClick={() => run(onDelete)} />
    </div>
  );
}
