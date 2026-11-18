import BrandLogo from '../../components/BrandLogo';
import { FORMATS } from '../../utils/formats';

// ── Format picker ─────────────────────────────────────────────────────────────

const FORMAT_VISUALS = {
  portrait:  { w: 48, h: 72, sections: 1 },
  landscape: { w: 72, h: 48, sections: 1 },
  stripV:    { w: 28, h: 72, sections: 3, vertical: true },
  stripH:    { w: 72, h: 28, sections: 3, vertical: false },
};

// embedded : choix du format d'un nouveau cadre, dans la page de l'éditeur (LAB-313).
export default function FormatPicker({ allowedFormats, onSelect, embedded = false, onCancel = null, onEditAnswers = null }) {
  const formats = allowedFormats.map((id) => FORMATS[id]).filter(Boolean);
  return (
    <div className={`${embedded ? 'h-full overflow-y-auto' : 'min-h-screen'} bg-pf-bg font-pola text-pf-text flex flex-col items-center justify-center p-6`}>
      {!embedded && <div className="mb-8"><BrandLogo variant="square" className="h-12 w-auto" /></div>}
      <h1 className="pola-pf-title text-[30px] md:text-[36px] mb-2 text-center">
        {embedded ? 'Format du nouveau cadre' : 'Choisissez votre format'}
      </h1>
      <p className="text-pf-muted text-base mb-10 text-center">Vous pourrez personnaliser votre cadre à l'étape suivante.</p>
      <div className={`grid gap-4 sm:gap-6 ${formats.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'} max-w-2xl w-full`}>
        {formats.map((fmt) => {
          const v = FORMAT_VISUALS[fmt.id] ?? { w: 48, h: 64, sections: 1 };
          return (
            <button key={fmt.id} onClick={() => onSelect(fmt)}
              className="group flex flex-col items-center gap-4 p-5 bg-white border-2 border-pf-line
                rounded-[24px] hover:border-pf-noyer transition-colors pola-pf-focus">
              <div className="flex items-center justify-center" style={{ width: 80, height: 80 }}>
                <div className="border-2 border-pf-line group-hover:border-pf-noyer bg-pf-bg
                  rounded transition-colors overflow-hidden flex"
                  style={{ width: v.w, height: v.h, flexDirection: v.vertical ? 'column' : 'row' }}>
                  {v.sections > 1
                    ? Array.from({ length: v.sections }).map((_, i) => (
                        <div key={i} className={`flex-1 bg-pf-surface group-hover:bg-pf-surface-2 transition-colors ${
                          v.vertical
                            ? i < v.sections - 1 ? 'border-b border-pf-line group-hover:border-pf-noyer' : ''
                            : i < v.sections - 1 ? 'border-r border-pf-line group-hover:border-pf-noyer' : ''
                        }`} />
                      ))
                    : <div className="flex-1 bg-pf-surface group-hover:bg-pf-surface-2 transition-colors rounded-sm" />}
                </div>
              </div>
              <div className="text-center">
                <p className="text-base font-medium text-pf-text group-hover:text-pf-noyer transition-colors">{fmt.label}</p>
                <p className="text-sm text-pf-muted mt-0.5">{fmt.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>
      {onCancel && (
        <button onClick={onCancel} className="mt-8 pola-pf-link">
          Annuler
        </button>
      )}
      {onEditAnswers && (
        <button onClick={onEditAnswers} className="mt-8 pola-pf-link">
          Modifier mes réponses
        </button>
      )}
    </div>
  );
}
