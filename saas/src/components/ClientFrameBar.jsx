import { FRAME_LABEL_MAX_LENGTH } from '../lib/designKind';
import { canDeleteFrame, frameDisplayName, frameStatusLabel } from '../lib/clientDesignFrames';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Spinner } from './ui/spinner';

// Plusieurs cadres dans l'éditeur du client (LAB-313) : barre des cadres de l'onglet
// « Mon modèle photo » et fenêtre d'envoi groupé.

const STATUS_STYLES = {
  approved:  'bg-pf-sage-soft text-pf-sage',
  submitted: 'bg-pf-surface text-pf-muted',
  rejected:  'bg-pola-error-soft text-pola-error',
};

function Countdown({ value }) {
  const length = Array.from(value ?? '').length;
  return <span className="text-[11px] text-editor-muted tabular-nums">{length}/{FRAME_LABEL_MAX_LENGTH}</span>;
}

export default function ClientFrameBar({
  frames, activeSlot, maxFrames, canAdd, canEdit = true, disabled = false,
  onSelect, onAdd, onRename, onDelete,
}) {
  const active = frames.find((f) => f.slot === activeSlot) ?? null;

  return (
    <div className="shrink-0 bg-editor-panel border-b border-editor-line px-2 md:px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto" role="tablist" aria-label="Mes cadres">
        {frames.map((frame) => {
          const selected = frame.slot === activeSlot;
          const status = frameStatusLabel(frame.status);
          return (
            <button
              key={frame.slot}
              role="tab"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onSelect(frame.slot)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors
                disabled:opacity-60 ${selected
                  ? 'border-primary bg-editor-selected text-primary font-medium'
                  : 'border-editor-line text-editor-muted hover:bg-editor-hover'}`}
            >
              <span className="max-w-[10rem] truncate">{frameDisplayName(frame)}</span>
              {status && (
                <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${STATUS_STYLES[frame.status] ?? ''}`}>
                  {status}
                </span>
              )}
            </button>
          );
        })}
        {canAdd && (
          <button
            onClick={onAdd}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-editor-line-strong
              text-sm text-editor-muted hover:border-primary hover:text-primary transition-colors disabled:opacity-60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            Ajouter un cadre
          </button>
        )}
        <span className="shrink-0 text-xs text-editor-muted pl-1">{frames.length}/{maxFrames} cadres</span>
      </div>

      {active && canEdit && (
        <div className="flex items-center gap-2 ml-auto">
          <label htmlFor="frame-label" className="text-xs text-editor-muted whitespace-nowrap">Nom sur la borne</label>
          <div className="relative">
            <input
              id="frame-label"
              type="text"
              value={active.label}
              onChange={(e) => onRename(active.slot, e.target.value)}
              placeholder={`Cadre ${active.slot}`}
              disabled={disabled}
              className="w-44 md:w-52 border border-editor-line bg-editor-panel text-editor-fg rounded-lg pl-3 pr-12 py-1.5 text-sm outline-none
                focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2"><Countdown value={active.label} /></span>
          </div>
          {canDeleteFrame(active) && (
            <button
              onClick={() => onDelete(active.slot)}
              disabled={disabled}
              title="Supprimer ce cadre"
              className="p-1.5 rounded-lg text-editor-faint hover:text-pola-error hover:bg-pola-error-soft transition-colors disabled:opacity-60"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Fenêtre « Envoyer mes cadres » : confirmation (liste des cadres envoyés), progression, erreur.
 * state : { phase: 'confirm' } | { phase: 'sending', done, total } | { phase: 'error', message }.
 */
export function FramesSendModal({ state, frames, toSend, onConfirm, onClose }) {
  const sending = state.phase === 'sending';
  const sent = frames.filter((f) => toSend.includes(f.slot));
  const kept = frames.filter((f) => f.status === 'approved');

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <DialogContent
        aria-labelledby="frames-send-title"
        className="w-[22rem] max-w-[calc(100%-2rem)] gap-0 border-0 rounded-[28px] sm:rounded-[28px] shadow-editor-float font-pola"
      >
        {sending ? (
          <div className="text-center py-2">
            <Spinner className="block mx-auto mb-4 border-pf-noyer" label="Envoi en cours" />
            <DialogTitle id="frames-send-title" className="text-[15px] font-medium leading-snug tracking-normal text-pf-text">
              Envoi du cadre {Math.min(state.done + 1, state.total)} sur {state.total}…
            </DialogTitle>
            <DialogDescription className="text-sm text-pf-muted mt-1">Ne fermez pas la page.</DialogDescription>
          </div>
        ) : (
          <>
            <DialogTitle id="frames-send-title" className="font-pf-serif font-normal text-[24px] leading-tight tracking-normal text-pf-text mb-2 pr-6">
              {sent.length > 1 ? `Envoyer vos ${sent.length} cadres ?` : 'Envoyer votre cadre ?'}
            </DialogTitle>
            {sent.length > 0 ? (
              <>
                <ul className="text-[15px] text-pf-text mb-3 space-y-1">
                  {sent.map((f) => <li key={f.slot}>• {frameDisplayName(f)}</li>)}
                </ul>
                <DialogDescription className="text-[15px] text-pf-muted mb-5">
                  {sent.length > 1
                    ? "Ils seront envoyés pour validation. Vous ne pourrez plus les modifier après l'envoi."
                    : "Il sera envoyé pour validation. Vous ne pourrez plus le modifier après l'envoi."}
                  {kept.length > 0 && ' Les cadres déjà validés restent tels quels.'}
                </DialogDescription>
              </>
            ) : (
              <DialogDescription className="text-[15px] text-pf-muted mb-5">Tous vos cadres sont déjà validés.</DialogDescription>
            )}
            {state.phase === 'error' && (
              <p className="text-sm text-pola-error bg-pola-error-soft rounded-2xl px-4 py-2.5 mb-4" role="alert">{state.message}</p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="pola-pf-btn-secondary flex-1 px-4 py-3 text-[15px]">
                Annuler
              </button>
              <button type="button" onClick={onConfirm} disabled={sent.length === 0} className="pola-pf-btn-primary flex-1 px-4 py-3 text-[15px] disabled:opacity-50">
                {state.phase === 'error' ? 'Réessayer' : 'Oui, envoyer'}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
