// Nouvel essai unique d'un appel base en échec transitoire (LAB-122). Logique pure, testée sous
// `node --test` (retry.test.ts).

/** Pause avant l'unique nouvel essai d'un appel base en échec transitoire. */
export const RPC_RETRY_DELAY_MS = 2_000;

/** SQLSTATE et codes PostgREST d'un échec passager (délai, verrou, connexion, pool saturé). */
const TRANSIENT_CODES = new Set([
  '57014', // statement timeout (query_canceled)
  '55P03', // lock timeout
  '40001', '40P01', // sérialisation, interblocage
  '53300', '57P01', '57P03', // connexions saturées, arrêt / démarrage du serveur
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', // connexion PostgREST ↔ base, cache de schéma, pool
]);

/**
 * Erreur d'un appel supabase-js (RPC) qui vaut un nouvel essai. `status` 0 = échec réseau (fetch rejeté),
 * 502 à 504 = passerelle.
 */
export function isTransientDbError(error: { code?: string | null; message?: string | null } | null, status?: number): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (TRANSIENT_CODES.has(code) || code.startsWith('08')) return true;
  if (status === 0 || status === 502 || status === 503 || status === 504) return true;
  return /statement timeout|lock timeout|fetch failed|connection (refused|reset|closed|terminated)|ECONNRESET/i.test(error.message ?? '');
}

/** Résultat d'un appel supabase-js : erreur éventuelle et statut HTTP (0 = échec réseau). */
export interface DbResult {
  error: { code?: string | null; message?: string | null } | null;
  status?: number;
}

/**
 * Lance `run`, puis le relance une seule fois après RPC_RETRY_DELAY_MS si l'erreur est transitoire
 * (isTransientDbError). Le second résultat est renvoyé tel quel, succès ou échec : jamais de troisième
 * essai. Une erreur non transitoire est renvoyée immédiatement. `sleep` est injectable pour les tests.
 */
export async function retryOnceIfTransient<T extends DbResult>(
  run: () => PromiseLike<T>,
  onRetry: (error: NonNullable<T['error']>) => void = () => {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const first = await run();
  if (!first.error || !isTransientDbError(first.error, first.status)) return first;
  onRetry(first.error as NonNullable<T['error']>);
  await sleep(RPC_RETRY_DELAY_MS);
  return await run();
}
