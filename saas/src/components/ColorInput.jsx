import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';

// Couleur « transparent » : petit damier (classe .checkerboard) sur le fond du panneau.
const TRANSPARENT_CLASS = 'checkerboard';
const TRANSPARENT_STYLE = {
  '--checker-size': '8px',
  '--checker-dark': 'hsl(var(--editor-line-strong))',
  '--checker-light': 'transparent',
};

const HAS_EYE_DROPPER = typeof window !== 'undefined' && 'EyeDropper' in window;

export default function ColorInput({ label, value, onChange, showTransparent = true }) {
  const [open, setOpen] = useState(false);
  const [hexField, setHexField] = useState('');
  const wrapRef = useRef(null);
  const popRef  = useRef(null);
  const [popPos, setPopPos] = useState({ top: -9999, left: -9999 });

  const isTransparent = !value || value === 'transparent';
  const safeHex = isTransparent ? '#aaaaaa' : value;

  useEffect(() => {
    if (!isTransparent) setHexField(value.replace('#', '').toUpperCase());
  }, [value, isTransparent]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !popRef.current) return;
    const wr = wrapRef.current.getBoundingClientRect();
    const pr = popRef.current.getBoundingClientRect();
    let top  = wr.bottom + 8;
    let left = wr.right - pr.width;
    if (top + pr.height > window.innerHeight - 8) top = wr.top - pr.height - 8;
    if (left < 8) left = 8;
    setPopPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!popRef.current?.contains(e.target) && !wrapRef.current?.contains(e.target))
        setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  function handlePickerChange(hex) {
    onChange(hex);
    setHexField(hex.replace('#', '').toUpperCase());
  }

  function handleHexInput(raw) {
    const clean = raw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, 6);
    setHexField(clean);
    if (clean.length === 6) onChange('#' + clean);
  }

  async function handleEyeDropper() {
    try {
      const result = await new window.EyeDropper().open();
      handlePickerChange(result.sRGBHex);
    } catch (_) {}
  }

  return (
    <div className="flex items-center justify-between" ref={wrapRef}>
      {label && (
        <label className="text-[12px] font-editor-strong text-editor-fg block mb-1.5">{label}</label>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-7 h-7 rounded-full border-2 border-editor-panel shadow-md ring-1 ring-editor-line
          transition-transform hover:scale-110 shrink-0 focus:outline-none ${isTransparent ? TRANSPARENT_CLASS : ''}`}
        style={isTransparent ? TRANSPARENT_STYLE : { background: value }}
        title={isTransparent ? 'Transparent' : value}
      />

      {open && (
        <div
          ref={popRef}
          className="fixed z-[70] bg-card rounded-editor-popover shadow-editor-float border border-editor-line-soft p-3 w-[220px]"
          style={{ top: popPos.top, left: popPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <HexColorPicker
            color={safeHex}
            onChange={handlePickerChange}
            style={{ width: '100%', height: '160px' }}
          />

          <div className="flex items-center gap-2 mt-3">
            <div
              className={`w-8 h-8 rounded-lg border border-editor-line shrink-0 ${isTransparent ? TRANSPARENT_CLASS : ''}`}
              style={isTransparent ? TRANSPARENT_STYLE : { background: value }}
            />
            <div className="flex-1 flex items-center border border-editor-line rounded-lg overflow-hidden
              focus-within:border-primary transition-colors">
              <span className="pl-2.5 text-xs text-editor-faint font-mono select-none">#</span>
              <input
                type="text"
                value={hexField}
                onChange={(e) => handleHexInput(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  handleHexInput(e.clipboardData.getData('text'));
                }}
                maxLength={7}
                placeholder="000000"
                className="flex-1 px-1 py-2 text-xs font-mono focus:outline-none uppercase tracking-widest bg-transparent"
              />
            </div>
            {HAS_EYE_DROPPER && (
              <button
                onClick={handleEyeDropper}
                title="Pipette — choisir une couleur à l'écran"
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-editor-line
                  text-editor-muted hover:bg-editor-hover hover:text-editor-accent-fg transition-colors shrink-0"
              >
                {/* Eyedropper / colorize icon */}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.71 5.63l-2.34-2.34a1 1 0 00-1.41 0l-3.12 3.12-1.41-1.42-1.42 1.42 1.41 1.41-6.6 6.6A2 2 0 005 16v3h3a2 2 0 001.42-.59l6.6-6.6 1.41 1.42 1.42-1.42-1.42-1.41 3.12-3.12a1 1 0 000-1.41zM6 19l-1-.98V17h1l.98 1L6 19z" />
                </svg>
              </button>
            )}
          </div>

          {showTransparent && (
            <button
              onClick={() => { onChange('transparent'); setOpen(false); }}
              className={`flex items-center gap-2.5 w-full px-2 py-2 mt-2 rounded-xl text-xs font-medium transition-colors
                ${isTransparent ? 'bg-editor-selected text-editor-accent-fg' : 'text-editor-muted hover:bg-editor-hover'}`}
            >
              <div className={`w-5 h-5 rounded-md border border-editor-line shrink-0 ${TRANSPARENT_CLASS}`} style={TRANSPARENT_STYLE} />
              Transparent
            </button>
          )}
        </div>
      )}
    </div>
  );
}
