import { SHEET_VH } from './useEditorZoom';

// Feuille des propriétés en bas de l'écran du téléphone ; le panneau arrive en enfant.
export default function MobilePropertiesSheet({ onClose, children }) {
  return (
    <div
      className="md:hidden fixed inset-x-0 z-[60] bg-card border-t border-editor-line rounded-t-2xl shadow-editor-float flex flex-col"
      style={{ bottom: 58, maxHeight: `${SHEET_VH * 100}vh` }}
    >
      {/* Handle + close */}
      <div className="shrink-0 flex items-center px-4 py-2 border-b border-editor-line-soft">
        <div className="flex-1 flex justify-center">
          <div className="w-8 h-1 bg-editor-line-strong rounded-full" />
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer les propriétés"
          className="p-1.5 rounded-full text-editor-faint hover:bg-editor-hover hover:text-editor-fg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {/* Contenu scrollable */}
      <div className="overflow-y-auto flex-1">
            {children}
      </div>
    </div>
  );
}
