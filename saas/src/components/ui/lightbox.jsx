import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Agrandissement plein écran d'une image (LAB-395). Se ferme par Échap, par un clic n'importe où
 * ou par le bouton « Fermer ». `open` faux : rien n'est rendu. Le contenu (souvent une <img>) est
 * passé en enfant ; un clic dessus ferme aussi, sauf si l'enfant fait `e.stopPropagation()`.
 */
export function Lightbox({ open, onClose, label = 'Aperçu agrandi', className, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={cn('fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4', className)}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Fermer"
        className="absolute right-4 top-4 z-10 rounded-full p-1 text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        onClick={onClose}
      >
        <X className="h-8 w-8" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}
