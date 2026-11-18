// LAB-243 : association d'une borne par code court (page /associer). Logique pure, testée.

/** Alphabet des codes, sans signe ambigu (ni 0, 1, O, I, L, U). */
export const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PAIRING_CODE_LENGTH = 6;

/** Durée du suivi « Borne connectée » après l'association. */
export const PAIRING_POLL_INTERVAL_MS = 3_000;
export const PAIRING_POLL_TIMEOUT_MS = 2 * 60_000;

/**
 * Code tapé par l'admin → code canonique. Minuscules, tiret et espaces acceptés ; O→0 et I/L→1
 * corrigés (le code reste alors invalide : l'alphabet n'a ni 0 ni 1, voir pairingCodeProblem).
 */
export function normalizePairingCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/**
 * Raison pour laquelle un code normalisé ne peut pas être envoyé, ou null s'il est bon.
 * 'empty' | 'too_short' | 'too_long' | 'ambiguous' (0, 1, O, I, L ou U).
 */
export function pairingCodeProblem(code) {
  if (!code) return 'empty';
  if ([...code].some((c) => !PAIRING_ALPHABET.includes(c))) return 'ambiguous';
  if (code.length < PAIRING_CODE_LENGTH) return 'too_short';
  if (code.length > PAIRING_CODE_LENGTH) return 'too_long';
  return null;
}

export function isValidPairingCode(code) {
  return pairingCodeProblem(code) === null;
}

/** Message affiché sous le champ, ou null (code vide ou bon). */
export function pairingCodeHint(code) {
  switch (pairingCodeProblem(code)) {
    case 'ambiguous':
      return 'Le code ne contient jamais 0, 1, O, I, L ni U. Vérifiez le code affiché sur la borne.';
    case 'too_short':
    case 'too_long':
      return `Le code compte ${PAIRING_CODE_LENGTH} caractères.`;
    default:
      return null;
  }
}

/** Affichage XXX-XXX (ce que montre la borne). */
export function formatPairingCode(code) {
  const c = String(code ?? '');
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

/** Minutes restantes avant expiration, arrondies au-dessus ; 0 si expiré ou inconnu. */
export function minutesLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60_000);
}

export const MSG_NOT_FOUND = "Ce code n'existe pas. Vérifiez le code affiché sur la borne.";
export const MSG_EXPIRED = 'Ce code a expiré. La borne en affiche déjà un nouveau.';
export const MSG_USED = "Cette borne vient d'être associée.";
const MSG_CANCELLED = 'Ce code a été annulé. La borne en affiche déjà un nouveau.';
export const MSG_RATE_LIMITED = "Trop d'essais. Réessayez dans 15 minutes.";
export const MSG_OTHER_ACCOUNT =
  'Cette borne est déjà associée à un autre compte. Elle doit d’abord y être retirée.';

/** Erreur Supabase de la limite d'essais (SQLSTATE PT429 → HTTP 429). */
export function isRateLimitError(error) {
  return !!error && (error.code === 'PT429' || error.hint === 'trop_de_requetes' || error.status === 429);
}

/**
 * Message pour un statut de kiosk_pairing_lookup, ou null si le code est utilisable (pending).
 * approved / delivered = le code a déjà servi.
 */
export function lookupStatusMessage(status) {
  switch (status) {
    case 'pending': return null;
    case 'not_found': return MSG_NOT_FOUND;
    case 'expired': return MSG_EXPIRED;
    case 'approved':
    case 'delivered': return MSG_USED;
    case 'cancelled': return MSG_CANCELLED;
    default: return 'Code impossible à vérifier. Réessayez.';
  }
}

/** Message pour un refus de kiosk_pairing_approve, ou null si result.status vaut 'ok'. */
export function approveResultMessage(result) {
  const status = result?.status;
  switch (status) {
    case 'ok': return null;
    case 'not_found': return MSG_NOT_FOUND;
    case 'expired': return MSG_EXPIRED;
    case 'used': return MSG_USED;
    case 'cancelled': return MSG_CANCELLED;
    case 'other_account': return MSG_OTHER_ACCOUNT;
    case 'limit_reached':
      return `Votre compte compte déjà ${result.count} borne${result.count > 1 ? 's' : ''} sur ${result.limit}. `
        + 'Retirez une borne ou contactez votre loueur.';
    case 'pc_in_use':
      return `Ce PC est déjà la borne « ${result.label || 'sans nom'} ». `
        + 'Choisissez-la dans « Remplacer une borne existante », ou retirez-la d’abord.';
    default: return "L'association a échoué. Réessayez.";
  }
}

/** Message pour une exception levée par l'une des RPC d'association. */
export function pairingErrorMessage(error) {
  if (isRateLimitError(error)) return MSG_RATE_LIMITED;
  if (error?.code === '22023') return 'Le nom de la borne est trop long (80 caractères au plus).';
  if (error?.code === '42501') {
    const msg = String(error.message ?? '');
    if (/aucun compte/i.test(msg)) return 'Aucun compte n’est rattaché à votre connexion.';
    if (/remplacer/i.test(msg)) return 'Cette borne à remplacer n’est pas dans ce compte.';
    if (/autre compte/i.test(msg)) return 'Seul le super-admin peut associer une borne à un autre compte.';
    return 'Action non autorisée pour votre compte.';
  }
  return 'Problème de connexion. Vérifiez votre réseau et réessayez.';
}

/**
 * Suivi après « Associer » : 'connected' quand la borne a récupéré son secret, 'stopped' sur un
 * statut final sans remise (annulé), 'waiting' sinon.
 */
export function pairingFollowState(status) {
  if (status === 'delivered') return 'connected';
  if (status === 'cancelled' || status === 'expired' || status === 'not_found') return 'stopped';
  return 'waiting';
}

/** Nom proposé : celui de la borne si ce PC est déjà connu du compte, sinon le nom du PC. */
export function suggestedKioskLabel(lookup) {
  return (lookup?.license?.label || lookup?.machine_name || '').trim().slice(0, 80);
}

/**
 * Adresse de retour après connexion (?next=) : chemin interne uniquement, pas de redirection
 * ouverte. Pages admin, et /associer avec sa requête.
 */
export function safeNextPath(next) {
  if (typeof next !== 'string' || !next) return null;
  if (/^\/admin\/[\w/-]*$/.test(next)) return next;
  if (/^\/associer(\?[\w=&%.-]*)?$/.test(next)) return next;
  return null;
}
