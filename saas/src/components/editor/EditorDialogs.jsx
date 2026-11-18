import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

// ─── Modals ───────────────────────────────────────────────────────────────────

// `adminMode` : l'admin parle de « cadre photo » ; le client garde « modèle » (ses textes ne changent pas).
export function ConfirmModal({ pending, onConfirm, onCancel, adminMode = false }) {
  if (!pending) return null;
  const { template, format } = pending;
  // Fermer la fenêtre (Échap, clic à côté, croix) revient à « Annuler ».
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xs gap-0">
        <DialogTitle className="text-base mb-2 pr-6">{adminMode ? 'Remplacer le cadre photo ?' : 'Remplacer le modèle ?'}</DialogTitle>
        <DialogDescription className="mb-5">
          Votre mise en page actuelle sera écrasée par le {adminMode ? 'cadre photo' : 'modèle'}{' '}
          <span className="font-medium text-editor-fg">« {template.name} »</span>.
          {format.id !== pending.currentFormatId && (
            <> Le format passera à <span className="font-medium text-editor-fg">{format.label}</span>.</>
          )}
        </DialogDescription>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
          <Button onClick={onConfirm} className="flex-1">
            Oui, remplacer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Confirmation d'envoi (client) : pas de fermeture pendant l'envoi.
export function SubmitConfirmDialog({
  homeMode, isSubmitting, submitError, setSubmitError, showSubmitConfirm, setShowSubmitConfirm, handleSubmit,
}) {
  return (
    <Dialog open={showSubmitConfirm} onOpenChange={(open) => { if (!open && !isSubmitting) setShowSubmitConfirm(false); }}>
      <DialogContent
        aria-labelledby="submit-confirm-title"
        className="w-[22rem] max-w-[calc(100%-2rem)] gap-0 border-0 rounded-[28px] sm:rounded-[28px] shadow-editor-float font-pola"
      >
        <DialogTitle id="submit-confirm-title" className="font-pf-serif font-normal text-[24px] leading-tight tracking-normal text-pf-text mb-2 pr-6">
          {homeMode ? "Envoyer votre écran d'accueil ?" : 'Valider votre design ?'}
        </DialogTitle>
        <DialogDescription className="text-[15px] text-pf-muted mb-5">
          {homeMode
            ? "Votre écran d'accueil sera envoyé pour validation. Une fois validé, il ne pourra plus être modifié."
            : "Votre design sera envoyé définitivement. Vous ne pourrez plus le modifier après l'envoi."}
        </DialogDescription>
        {submitError && (
          <p className="text-sm text-pola-error bg-pola-error-soft rounded-2xl px-4 py-2.5 mb-4" role="alert">{submitError}</p>
        )}
        <div className="flex gap-3">
          <button onClick={() => { setShowSubmitConfirm(false); setSubmitError(''); }}
            disabled={isSubmitting}
            className="pola-pf-btn-secondary flex-1 px-4 py-3 text-[15px] disabled:opacity-50">
            Annuler
          </button>
          <button onClick={() => { setShowSubmitConfirm(false); handleSubmit(); }}
            disabled={isSubmitting}
            className="pola-pf-btn-primary flex-1 px-4 py-3 text-[15px] disabled:opacity-50">
            {isSubmitting ? 'Envoi…' : homeMode ? 'Oui, envoyer' : 'Oui, valider'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
