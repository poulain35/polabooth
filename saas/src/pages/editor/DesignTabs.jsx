// Onglets modèle photo / écran d'accueil de l'éditeur du client (LAB-289).

const DESIGN_TABS = [
  { kind: 'print', label: 'Mon modèle photo' },
  { kind: 'home',  label: 'Mon écran d\'accueil' },
];

export default function DesignTabs({ active, onChange }) {
  return (
    <div className="shrink-0 bg-editor-panel border-b border-editor-line px-2 md:px-4 flex items-center gap-1" role="tablist">
      {DESIGN_TABS.map(({ kind, label }) => (
        <button
          key={kind}
          role="tab"
          aria-selected={active === kind}
          onClick={() => onChange(kind)}
          className={`px-3 md:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
            ${active === kind
              ? 'border-primary text-primary'
              : 'border-transparent text-editor-muted hover:text-editor-fg'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
