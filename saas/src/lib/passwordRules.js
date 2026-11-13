// Mot de passe de l'admin (LAB-268) : règles de saisie, adresse du lien de réinitialisation,
// lecture du lien reçu par email et traduction des erreurs de Supabase Auth.
import { retryHint } from './httpErrors.js';

// Supabase accepte 6 caractères par défaut ; on exige 8 (minimum courant des recommandations
// ANSSI / NIST) parce que ce compte ouvre toutes les données des clients. Si le projet Supabase
// impose davantage, son refus (weak_password) est traduit plus bas.
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt (Supabase Auth) ignore ce qui dépasse 72 octets : Supabase refuse au-delà.
export const PASSWORD_MAX_BYTES = 72;

export const RESET_PASSWORD_PATH = '/admin/nouveau-mot-de-passe';
export const FORGOT_PASSWORD_PATH = '/admin/login?oubli=1';

export const RESET_REQUEST_SENT = 'Si un compte existe pour cette adresse, un email vient d\'être envoyé.';

const LINK_EXPIRED = 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.';
const LINK_INVALID = 'Ce lien de réinitialisation n\'est pas valide. Demandez-en un nouveau.';
const LINK_OTHER_BROWSER = 'Ce lien doit être ouvert dans le navigateur où vous avez fait la demande. Demandez-en un nouveau.';

/** Problème de saisie du nouveau mot de passe, ou null s'il est acceptable. */
export function passwordProblem(password, confirmation) {
  const value = String(password ?? '');
  if (!value) return 'Saisissez un nouveau mot de passe.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return `Le mot de passe est trop long (${PASSWORD_MAX_BYTES} caractères au maximum).`;
  }
  if (value !== String(confirmation ?? '')) return 'Les deux mots de passe ne sont pas identiques.';
  return null;
}

/** Adresse du site sans slash final : VITE_APP_URL, sinon l'origine de la page. */
export function appBaseUrl(envUrl, origin) {
  return String(envUrl || origin || '').trim().replace(/\/+$/, '');
}

/** redirectTo de resetPasswordForEmail : page de réinitialisation sur l'adresse du site. */
export function resetRedirectUrl(envUrl, origin) {
  return appBaseUrl(envUrl, origin) + RESET_PASSWORD_PATH;
}

/**
 * Paramètres du lien de réinitialisation ouvert (hash du flux implicite, query du flux PKCE ou
 * d'un modèle d'email pointant vers le site avec token_hash). Les erreurs arrivent dans l'un ou l'autre.
 */
export function recoveryLink(href) {
  let url;
  try { url = new URL(href); } catch { return { error: null, code: null, tokenHash: null, type: null }; }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (key) => url.searchParams.get(key) || hash.get(key) || null;
  const hasError = get('error') || get('error_code') || get('error_description');
  return {
    error: hasError ? (get('error_code') || get('error') || 'unspecified_error') : null,
    code: get('code'),
    tokenHash: get('token_hash'),
    type: get('type'),
  };
}

/** Message affiché quand le lien ne donne pas de session de récupération. */
export function recoveryLinkMessage(reason) {
  if (reason === 'otp_expired' || reason === 'flow_state_expired' || reason === 'flow_state_not_found') {
    return LINK_EXPIRED;
  }
  if (reason === 'bad_code_verifier' || reason === 'code_verifier_missing') return LINK_OTHER_BROWSER;
  return LINK_INVALID;
}

/** Code d'une erreur Supabase Auth, déduit du message quand le serveur n'en donne pas. */
export function authErrorCode(error) {
  if (!error) return null;
  if (error.code) return error.code;
  const message = String(error.message ?? '');
  if (error.name === 'AuthWeakPasswordError') return 'weak_password';
  if (error.name === 'AuthSessionMissingError') return 'session_not_found';
  if (error.name === 'AuthPKCECodeVerifierMissingError') return 'code_verifier_missing';
  if (error.name === 'AuthRetryableFetchError') return 'network_error';
  if (error.status === 429 || /rate limit|only request this after/i.test(message)) return 'over_request_rate_limit';
  if (/different from the old password/i.test(message)) return 'same_password';
  if (/requires reauthentication/i.test(message)) return 'reauthentication_needed';
  if (/invalid or has expired|token has expired/i.test(message)) return 'otp_expired';
  if (/invalid login credentials/i.test(message)) return 'invalid_credentials';
  return null;
}

function weakPasswordMessage(error) {
  const reasons = Array.isArray(error?.reasons) ? error.reasons : [];
  if (reasons.includes('pwned')) {
    return 'Ce mot de passe figure dans des fuites de données connues. Choisissez-en un autre.';
  }
  if (reasons.includes('characters')) {
    return 'Mot de passe trop faible : mélangez minuscules, majuscules, chiffres et symboles.';
  }
  if (reasons.includes('length')) return 'Mot de passe trop court pour les règles du serveur. Allongez-le.';
  return 'Mot de passe trop faible. Choisissez-en un plus long ou plus varié.';
}

function rateLimitMessage(error) {
  const seconds = /after (\d+) seconds?/i.exec(String(error?.message ?? ''))?.[1];
  return seconds
    ? `Trop de demandes à la suite. ${retryHint(Number(seconds))}`
    : 'Trop de demandes à la suite. Patientez quelques minutes avant de réessayer.';
}

/** Message en français pour une erreur Supabase Auth. */
export function authErrorMessage(error, fallback = 'Une erreur est survenue. Réessayez.') {
  switch (authErrorCode(error)) {
    case 'same_password': return 'Le nouveau mot de passe doit être différent de l\'ancien.';
    case 'weak_password': return weakPasswordMessage(error);
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found': return LINK_EXPIRED;
    case 'bad_code_verifier':
    case 'code_verifier_missing': return LINK_OTHER_BROWSER;
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return rateLimitMessage(error);
    case 'reauthentication_needed': return 'Pour des raisons de sécurité, confirmez votre identité avant de changer le mot de passe.';
    case 'reauthentication_not_valid': return 'Code de vérification incorrect ou expiré.';
    case 'current_password_required': return 'Saisissez votre mot de passe actuel.';
    case 'current_password_mismatch': return 'Le mot de passe actuel est incorrect.';
    case 'session_not_found':
    case 'session_expired': return 'Votre session a expiré. Reconnectez-vous ou demandez un nouveau lien.';
    case 'invalid_credentials': return 'Email ou mot de passe incorrect';
    case 'email_address_invalid': return 'Adresse email invalide.';
    case 'network_error': return 'Connexion impossible. Vérifiez votre réseau et réessayez.';
    default: return error?.message || fallback;
  }
}

/** Erreur à lever côté front : message traduit, code d'origine conservé. */
export function toAuthError(error, fallback) {
  const err = new Error(authErrorMessage(error, fallback));
  err.code = authErrorCode(error);
  return err;
}
