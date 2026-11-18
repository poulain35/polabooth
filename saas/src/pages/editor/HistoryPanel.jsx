import { useEffect, useState } from 'react';
import { listDesignVersions, getDesignVersion } from '../../lib/supabase';
import { formatDateWith, formatTime } from '../../lib/dates';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Spinner } from '../../components/ui/spinner';

// ── Panneau historique ────────────────────────────────────────────────────────

// slot : cadre affiché quand le choix du cadre est ouvert (LAB-313), sinon undefined (rien d'envoyé).
export default function HistoryPanel({ code, kind = 'print', slot, onRestore, onClose }) {
  const [versions, setVersions] = useState(null);
  const [restoring, setRestoring] = useState(null);

  useEffect(() => {
    if (!code) return;
    listDesignVersions(code, kind, slot)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [code, kind, slot]);

  async function handleRestore(v) {
    setRestoring(v.id);
    try {
      const full = await getDesignVersion(code, v.id, kind, slot);
      onRestore(full);
    } catch {
      alert('Erreur lors de la restauration.');
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Panneau à droite de l'écran, toute la hauteur. */}
      <DialogContent
        aria-labelledby="history-title"
        className="font-pola text-pf-text left-auto right-0 top-0 translate-x-0 translate-y-0 h-full w-80 max-w-full flex flex-col gap-0 border-0 rounded-none sm:rounded-none p-0 shadow-editor-float data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
      >
        <div className="px-5 py-4 pr-12 border-b border-pf-line shrink-0">
          <DialogTitle id="history-title" className="font-pf-serif font-normal text-[20px] leading-tight tracking-normal text-pf-text">Historique des versions</DialogTitle>
          <DialogDescription className="text-xs text-pf-muted mt-1">Cliquez sur une version pour la restaurer</DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {versions === null && (
            <div className="flex justify-center pt-8">
              <Spinner className="border-pf-noyer" label="Chargement des versions" />
            </div>
          )}
          {versions?.length === 0 && (
            <p className="text-sm text-pf-muted text-center pt-8">
              Aucune version sauvegardée.<br />
              Utilisez le bouton "Sauvegarder" pour créer une version.
            </p>
          )}
          {versions?.map((v, i) => (
            <div key={v.id}
              className="bg-pf-bg border border-pf-line rounded-2xl p-3 hover:bg-pf-surface transition-colors">
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 bg-pf-surface text-pf-noyer rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {versions.length - i}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-pf-text truncate">
                    {v.label || `Version ${versions.length - i}`}
                  </p>
                  <p className="text-xs text-pf-muted mt-0.5">{formatDateWith(v.created_at, { day: '2-digit', month: 'short' })} à {formatTime(v.created_at)}</p>
                  <span className="inline-block mt-1 text-[10px] bg-pf-surface-2 text-pf-muted rounded px-1.5 py-0.5">
                    {v.format}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(v)}
                  disabled={restoring === v.id}
                  className="pola-pf-focus shrink-0 mt-1 px-3 py-1 text-xs font-medium bg-pf-noyer hover:bg-pf-noyer-h
                    text-white rounded-full disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {restoring === v.id
                    ? <Spinner className="h-3 w-3 border border-white" label="Restauration en cours" />
                    : null}
                  Restaurer
                </button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
