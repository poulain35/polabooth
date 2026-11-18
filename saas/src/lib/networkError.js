// Requête qui n'a pas abouti (réseau coupé, serveur injoignable) : le navigateur ne donne qu'un
// message brut en anglais, à remplacer par une phrase claire (LAB-317).

export const NETWORK_ERROR_MESSAGE = 'Connexion impossible. Vérifiez votre réseau et réessayez.';

// Chrome « Failed to fetch », Firefox « NetworkError when attempting to fetch resource. », Safari
// « Load failed » ; supabase-js (tables) préfixe le nom de l'erreur : « TypeError: Failed to fetch ».
const FETCH_FAILURE = /^(?:(?:TypeError|FetchError):\s*)?(?:failed to fetch|networkerror when attempting to fetch resource\.?|load failed|network request failed)$/i;

export function isFetchFailure(error) {
  return FETCH_FAILURE.test(String(error?.message ?? error ?? '').trim());
}

/** Message à montrer pour une erreur : réseau traduit, sinon son message, sinon `fallback`. */
export function userErrorMessage(error, fallback) {
  if (isFetchFailure(error)) return NETWORK_ERROR_MESSAGE;
  return error?.message || fallback;
}
