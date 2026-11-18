import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// Modale « quitter sans sauvegarder » : éditeur du client et écrans de la borne (LAB-317).
// Fermer la fenêtre (Échap, clic à côté, croix) revient à « Annuler ».
export default function UnsavedChangesModal({ onSave, onLeave, onCancel }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xs rounded-dialog gap-0 text-center">
        <div className="w-12 h-12 bg-editor-warning rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-editor-warning-fg" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <DialogTitle className="text-base mb-2">Modifications non sauvegardées</DialogTitle>
        <DialogDescription className="mb-5">
          Vous avez des modifications qui n'ont pas encore été sauvegardées. Que souhaitez-vous faire ?
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <Button onClick={onSave} className="w-full">
            Sauvegarder et quitter
          </Button>
          <Button variant="outline" onClick={onLeave}
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive">
            Quitter sans sauvegarder
          </Button>
          <Button variant="ghost" onClick={onCancel} className="w-full text-muted-foreground">
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
