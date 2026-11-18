import { cn } from '../../lib/utils';

/**
 * Roue de chargement (LAB-395). `className` pour la taille (h-4 w-4…) ou la couleur de bordure.
 * Centrée dans un bloc : `<div className="flex justify-center py-12"><Spinner /></div>`.
 * Une couleur de bordure passée en `className` (`border-current`, `border-white`…) efface aussi le haut
 * transparent dans tailwind-merge : il est remis, sauf si `className` choisit lui-même le haut (`border-t-…`).
 */
export function Spinner({ className, label = 'Chargement', ...props }) {
  const classes = cn('inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary', className);
  return (
    <span
      role="status"
      aria-label={label}
      className={/(?:^|\s)border-t-/.test(classes) ? classes : `${classes} border-t-transparent`}
      {...props}
    />
  );
}
