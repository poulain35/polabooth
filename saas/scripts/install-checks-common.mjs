// Vérifications de l'installation (LAB-376) : classement des points (✓ ⚠ ✗ ·), secrets retirés des
// messages, raisons lisibles des erreurs réseau. Partagé par la messagerie et le stockage (LAB-403).

export const CHECK_TIMEOUT_MS = 15_000;

// ── Classement ──────────────────────────────────────────────────────────────────────────────

/**
 * Statut d'un point vérifié : ok (✓), warn (⚠, l'installation continue), error (✗, bloquant),
 * skip (·, pas vérifié parce qu'un point précédent a échoué).
 */
export const CHECK_SYMBOLS = { ok: '✓', warn: '⚠', error: '✗', skip: '·' };

/** Bilan d'une liste de points : comptes par statut, `blocking` vrai s'il y a au moins une erreur. */
export function checksVerdict(items) {
  const counts = { ok: 0, warn: 0, error: 0, skip: 0 };
  for (const item of items) counts[item.status] += 1;
  return { counts, blocking: counts.error > 0 };
}

export function checksSummaryLine(items) {
  const { counts } = checksVerdict(items);
  const parts = [`${CHECK_SYMBOLS.ok} ${counts.ok}`, `${CHECK_SYMBOLS.warn} ${counts.warn}`, `${CHECK_SYMBOLS.error} ${counts.error}`];
  if (counts.skip) parts.push(`${CHECK_SYMBOLS.skip} ${counts.skip} non vérifié(s)`);
  return `Résumé des vérifications : ${parts.join(' · ')}`;
}

/** Retire les secrets (et leur forme base64) d'un texte, au cas où un serveur les renverrait. */
export function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (!secret || secret.length < 3) continue;
    for (const form of [secret, Buffer.from(secret, 'utf8').toString('base64')]) out = out.split(form).join('•••');
  }
  return out;
}

export function redactItem(item, secrets) {
  return {
    ...item,
    message: redact(item.message, secrets),
    ...(item.hint ? { hint: redact(item.hint, secrets) } : {}),
    ...(item.details ? { details: item.details.map((line) => redact(line, secrets)) } : {}),
  };
}

export const clip = (text, max = 200) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

// ── Erreurs réseau ──────────────────────────────────────────────────────────────────────────

export const CERT_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_UNTRUSTED', 'CERT_REVOKED',
]);

/** Code système d'une erreur réseau (Node : `code`, fetch : `cause.code`, délai : TimeoutError). */
export function networkErrorCode(e) {
  if (!e) return '';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'ETIMEDOUT';
  const code = e.code ?? e.cause?.code ?? '';
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'ETIMEDOUT';
  if (/wrong version number|packet length too long|unknown protocol/i.test(`${e.message} ${e.cause?.message ?? ''}`)) return 'ERR_SSL_WRONG_VERSION_NUMBER';
  return code;
}

/** Raison lisible d'une erreur réseau. */
export function networkReason(e) {
  const code = networkErrorCode(e);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'adresse introuvable (nom de serveur inconnu)';
  if (code === 'ECONNREFUSED') return 'connexion refusée';
  if (code === 'ETIMEDOUT') return `pas de réponse en ${CHECK_TIMEOUT_MS / 1000} s`;
  if (code === 'ECONNRESET' || code === 'ECONNCLOSED') return 'connexion coupée par le serveur';
  if (CERT_CODES.has(code)) return `certificat refusé (${code})`;
  if (code === 'ERR_SSL_WRONG_VERSION_NUMBER' || code === 'EPROTO') return 'le serveur ne répond pas en SSL/TLS';
  return clip(e?.cause?.message ?? e?.message ?? String(e));
}
