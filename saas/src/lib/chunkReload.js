/**
 * Nouvelle version en ligne pendant qu'un onglet reste ouvert : les fichiers de l'ancienne version
 * (`/assets/<page>-<empreinte>.js`) n'existent plus, et la page demandée ne se charge pas
 * (« Failed to fetch dynamically imported module »). On recharge une fois pour prendre la nouvelle
 * version ; un deuxième échec dans la minute affiche l'écran d'erreur (pas de boucle).
 */
export const CHUNK_RELOAD_KEY = 'pola-chunk-reload-at';
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed|is not a valid JavaScript MIME type/i;

/** Échec de téléchargement d'un morceau de l'application (Chrome, Safari, Firefox, Vite). */
export function isChunkLoadError(error) {
  if (!error) return false;
  const message = typeof error === 'string' ? error : `${error.name ?? ''} ${error.message ?? ''}`;
  return CHUNK_ERROR_RE.test(message);
}

/**
 * Recharge la page, une fois par fenêtre d'une minute. Renvoie vrai si le rechargement est lancé.
 * Sans stockage de session utilisable, on ne recharge pas (impossible d'éviter une boucle).
 */
export function reloadOnceForNewVersion({
  storage = globalThis.sessionStorage,
  now = Date.now(),
  reload = () => globalThis.location.reload(),
} = {}) {
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY)) || 0;
    if (now - last >= 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
