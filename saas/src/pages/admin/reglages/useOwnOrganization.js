import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

/**
 * Organisation du compte connecté (ligne `organizations` dont il est propriétaire), lue une fois.
 * Reprend le chargement de l'ancienne page Paramètres (LAB-338). `org` vaut null tant qu'elle n'est
 * pas lue ou si le compte n'en a pas ; `loading` passe à faux dans les deux cas.
 */
export function useOwnOrganization() {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) return;
        const { data } = await supabase
          .from('organizations')
          .select('*')
          .eq('owner_id', session.session.user.id)
          .maybeSingle();
        if (!cancelled) setOrg(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Met à jour l'organisation en mémoire (après un enregistrement), sans relire la base. */
  const patchOrg = useCallback((patch) => setOrg((o) => (o ? { ...o, ...patch } : o)), []);

  return { org, setOrg, patchOrg, loading };
}
