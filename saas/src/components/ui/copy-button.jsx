import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './button';
import { useCopy } from '../../hooks/useCopy';

/**
 * Bouton « Copier » (LAB-395) : copie `value`, affiche « Copié » 2 s, toast d'erreur si la copie
 * échoue (et de succès si `successMessage` est donné). Variante et taille de `Button`.
 */
export function CopyButton({
  value,
  label = 'Copier',
  copiedLabel = 'Copié',
  successMessage,
  errorMessage = 'Copie impossible : sélectionnez le texte à la main.',
  variant = 'outline',
  size = 'xs',
  ...props
}) {
  const { copied, copy } = useCopy();
  async function handleClick() {
    const ok = await copy(value);
    if (!ok) toast.error(errorMessage);
    else if (successMessage) toast.success(successMessage);
  }
  return (
    <Button type="button" variant={variant} size={size} onClick={handleClick} {...props}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
