import { useEffect, useSyncExternalStore } from 'react';
import { getCurrentUserId, isAppAdmin } from '../lib/supabase';
import { createAppAdminStore } from '../lib/appAdmin';

// État partagé (menu, routes, fiche événement) : une seule lecture de is_app_admin par compte.
const store = createAppAdminStore({ getUserId: getCurrentUserId, checkAdmin: isAppAdmin });

/**
 * Administrateur de l'application (app_admins, LAB-276) : seul à gérer modèles, décorations et
 * polices. `loading` vrai tant que la lecture n'a pas abouti ; en cas d'erreur, `isAdmin` est faux.
 */
export function useAppAdmin() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);
  useEffect(() => { store.load(); }, []);
  return { isAdmin: snapshot.isAdmin, loading: snapshot.loading };
}
