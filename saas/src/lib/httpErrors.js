// Erreurs des edge functions publiques (LAB-111) : un 429 donne toujours un message clair,
// même si le corps n'est pas du JSON (limite de la passerelle Supabase par exemple).

/** « Réessayez dans … » lisible, aligné sur le message serveur (_shared/public-rate-limit.ts). */
export function retryHint(seconds) {
  const s = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (s < 60) return `Réessayez dans ${s} seconde${s > 1 ? 's' : ''}.`;
  if (s < 3600) {
    const m = Math.ceil(s / 60);
    return `Réessayez dans ${m} minute${m > 1 ? 's' : ''}.`;
  }
  const h = Math.ceil(s / 3600);
  return `Réessayez dans ${h} heure${h > 1 ? 's' : ''}.`;
}

/** Délai d'attente en secondes : corps `retry_after`, sinon en-tête Retry-After, sinon null. */
export function retryAfterSeconds(res, data) {
  const fromBody = Number(data?.retry_after);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
  const fromHeader = Number(res?.headers?.get?.('Retry-After'));
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader);
  return null;
}

/** Message affiché pour un 429. */
export function rateLimitMessage(seconds) {
  return seconds
    ? `Trop de requêtes. ${retryHint(seconds)}`
    : 'Trop de requêtes. Réessayez dans quelques instants.';
}

/**
 * Erreur à lever après un appel `fetch` en échec. Porte `status`, `code` et `retryAfter`
 * (secondes) ; `rateLimited` vaut true pour un 429.
 */
export function functionError(res, data, fallback) {
  const rateLimited = res?.status === 429;
  const retryAfter = rateLimited ? retryAfterSeconds(res, data) : null;
  const serverMessage = typeof data?.error === 'string' && data.error ? data.error : null;
  const message = rateLimited
    ? (serverMessage?.startsWith('Trop de requêtes') ? serverMessage : rateLimitMessage(retryAfter))
    : (serverMessage ?? fallback);
  return Object.assign(new Error(message), {
    status: res?.status ?? null,
    code: data?.code ?? null,
    retryAfter,
    rateLimited,
  });
}

/** Lit le corps JSON sans lever (corps vide ou HTML d'une passerelle ⇒ {}). */
export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
