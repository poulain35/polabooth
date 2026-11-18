import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';

/**
 * Copie avec retour « Copié » (LAB-395). `copy(text, key)` renvoie `true` si le texte est copié ;
 * `copied` vaut alors `key` (par défaut `true`) pendant `resetMs`, puis `false`. Plusieurs boutons
 * dans un même écran : une clé par bouton, et `copied === key` pour savoir lequel afficher.
 */
export function useCopy(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text, key = true) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    }
    return ok;
  }, [resetMs]);

  return { copied, copy };
}
