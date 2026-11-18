// Écran de statut du design (envoyé, validé) et sa coche de réussite.

// Coche de réussite : cercle sauge plein (palette F, LAB-355).
export function SuccessIcon() {
  return (
    <div className="w-14 h-14 bg-pf-sage text-white rounded-full flex items-center justify-center mx-auto mb-4">
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

export function DesignStatusPanel({ title, message, previewUrl }) {
  return (
    <div className="h-full overflow-y-auto flex items-center justify-center bg-pf-bg font-pola text-pf-text p-4">
      <div className="pola-pf-card p-8 max-w-lg text-center">
        <SuccessIcon />
        <h2 className="pola-pf-title text-[28px] mb-2">{title}</h2>
        <p className="text-pf-muted text-base">{message}</p>
        {previewUrl && (
          <img src={previewUrl} alt="Aperçu" className="mt-6 w-full rounded-2xl border border-pf-line" />
        )}
      </div>
    </div>
  );
}
