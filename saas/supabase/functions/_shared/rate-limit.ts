// Rate limit à fenêtre glissante, compteurs dans `booking_rate_limits` (spec §5.8, M4).
// Les clés (IP, email) sont hachées avec RATE_LIMIT_SALT : aucune donnée personnelle en clair.
// Les lignes sont purgées après 48 h par le cron `purge-booking-rate-limits`.
// Sans import Deno/esm.sh : testable sous `node --test` (rate-limit.test.ts).

export interface RateDecision {
  allowed: boolean;
  /** Secondes avant qu'une place se libère (0 si autorisé). */
  retryAfterSeconds: number;
}

/**
 * Décision pure : `timestamps` = les plus anciens horodatages (ms) de la fenêtre, triés
 * par ordre croissant, au plus `limit` éléments.
 */
export function evaluateRateLimit(timestamps: number[], limit: number, windowMs: number, now: number): RateDecision {
  const inWindow = timestamps.filter((t) => t > now - windowMs).sort((a, b) => a - b);
  if (inWindow.length < limit) return { allowed: true, retryAfterSeconds: 0 };
  const oldest = inWindow[inWindow.length - limit];
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashKey(value: string, salt: string): Promise<string> {
  if (!salt) throw new Error('RATE_LIMIT_SALT manquant');
  return await sha256Hex(value + salt);
}

export const IP_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for'] as const;

/**
 * IP du client derrière Cloudflare et le proxy Supabase : cf-connecting-ip, puis x-real-ip,
 * puis le DERNIER élément de X-Forwarded-For (le premier est fourni par le client, donc falsifiable).
 * À VALIDER en dev réel : logguer les en-têtes reçus (DEBUG_IP_HEADERS, cf. ipHeaderNames).
 */
export function clientIp(headers: Headers): string {
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const v = headers.get(name)?.trim();
    if (v) return v;
  }
  const last = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? 'unknown';
}

/** Noms des en-têtes IP présents, jamais leurs valeurs (diagnostic sans donnée personnelle). */
export function ipHeaderNames(headers: Headers): string[] {
  return IP_HEADERS.filter((name) => headers.has(name));
}

// Sous-ensemble du client supabase-js utilisé ici (évite l'import esm.sh dans les tests).
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/**
 * Vérifie le bucket et, si la requête est autorisée, l'enregistre.
 * Non atomique : quelques requêtes concurrentes peuvent dépasser la limite, ce qui est
 * acceptable pour de l'anti-abus.
 */
export async function checkRateLimit(
  db: Db,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<RateDecision> {
  const decision = await peekRateLimit(db, bucket, limit, windowSeconds, now);
  if (decision.allowed) await recordHit(db, bucket);
  return decision;
}

/** Décision sur le bucket SANS enregistrer la requête (compteurs d'échecs, contrôles groupés). */
export async function peekRateLimit(
  db: Db,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<RateDecision> {
  const windowMs = windowSeconds * 1000;
  const since = new Date(now - windowMs).toISOString();
  const { data, error } = await db
    .from('booking_rate_limits')
    .select('created_at')
    .eq('bucket', bucket)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`rate limit (${bucket}) : ${error.message}`);

  const timestamps = ((data ?? []) as { created_at: string }[]).map((r) => Date.parse(r.created_at));
  return evaluateRateLimit(timestamps, limit, windowMs, now);
}

export async function recordHit(db: Db, bucket: string): Promise<void> {
  const { error } = await db.from('booking_rate_limits').insert({ bucket });
  if (error) throw new Error(`rate limit insert (${bucket}) : ${error.message}`);
}

/** Nombre d'entrées du bucket dans la fenêtre (compteur global). */
export async function countHits(db: Db, bucket: string, windowSeconds: number, now: number = Date.now()): Promise<number> {
  const since = new Date(now - windowSeconds * 1000).toISOString();
  const { count, error } = await db
    .from('booking_rate_limits')
    .select('id', { count: 'exact', head: true })
    .eq('bucket', bucket)
    .gt('created_at', since);
  if (error) throw new Error(`rate limit count (${bucket}) : ${error.message}`);
  return count ?? 0;
}
