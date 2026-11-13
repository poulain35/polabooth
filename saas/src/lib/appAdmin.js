// LAB-276 : les catalogues (modèles, décorations, polices) ne sont modifiables que par
// l'administrateur de l'application (app_admins, RPC is_app_admin). Le front masque le menu
// « Création » et garde ses routes ; la base reste seule juge (RLS is_app_admin).
//
// Magasin pur et testable : état par utilisateur (un changement de compte relance la lecture),
// lectures simultanées regroupées, refus par défaut (erreur ou pas de session = pas admin).

const INITIAL = { userId: null, isAdmin: false, loading: true };

/**
 * getUserId : () => Promise<string | null> ; checkAdmin : () => Promise<boolean>.
 * Retourne { getState, subscribe, load }.
 */
export function createAppAdminStore({ getUserId, checkAdmin }) {
  let state = INITIAL;
  let pending = null;
  const listeners = new Set();

  function setState(next) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function read() {
    let userId = null;
    try {
      userId = await getUserId();
    } catch {
      userId = null;
    }
    if (!userId) {
      setState({ userId: null, isAdmin: false, loading: false });
      return state;
    }
    if (state.userId === userId && !state.loading) return state;
    // Autre compte : on n'expose pas le statut du précédent pendant la lecture.
    if (state.userId !== userId) setState({ userId, isAdmin: false, loading: true });
    let isAdmin = false;
    try {
      isAdmin = (await checkAdmin()) === true;
    } catch {
      isAdmin = false;
    }
    setState({ userId, isAdmin, loading: false });
    return state;
  }

  /** Lit (ou relit après un changement de compte) le statut d'administrateur. */
  function load() {
    if (!pending) pending = read().finally(() => { pending = null; });
    return pending;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
  };
}
