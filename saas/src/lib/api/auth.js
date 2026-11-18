// Connexion, mot de passe et statut de l'admin.
import { recoveryLink, resetRedirectUrl, toAuthError } from '../passwordRules.js';
import { supabase } from './client.js';

// ── Connexion et mot de passe de l'admin (LAB-268) ────────────────────────────

export async function signInAdmin(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw toAuthError(error, 'Connexion impossible. Réessayez.');
}

/** Envoie le lien de réinitialisation. Sans erreur même si le compte n'existe pas (Supabase). */
export async function requestPasswordReset(email) {
  const redirectTo = resetRedirectUrl(import.meta.env.VITE_APP_URL, window.location.origin);
  const { error } = await supabase.auth.resetPasswordForEmail(String(email ?? '').trim(), { redirectTo });
  if (error) throw toAuthError(error, "Envoi de l'email impossible. Réessayez.");
}

/**
 * Ouvre la session de récupération à partir du lien reçu par email.
 * Flux implicite (client par défaut) et PKCE : le client Supabase lit l'URL à son initialisation,
 * getSession() l'attend. token_hash : modèle d'email qui pointe directement vers le site.
 * Code PKCE resté dans l'URL : échange explicite (échoue si le lien est ouvert dans un autre navigateur).
 * Renvoie { ok: true, email } ou { ok: false, reason }.
 */
export async function openPasswordRecovery(href = window.location.href) {
  const link = recoveryLink(href);
  if (link.error) return { ok: false, reason: link.error };
  if (link.tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: 'recovery' });
    if (error) return { ok: false, reason: toAuthError(error).code ?? 'invalid' };
  }
  let { data: { session } } = await supabase.auth.getSession();
  if (!session && link.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);
    if (error) return { ok: false, reason: toAuthError(error).code ?? 'invalid' };
    session = data.session;
  }
  if (!session) return { ok: false, reason: 'missing' };
  return { ok: true, email: session.user?.email ?? '' };
}

/** Identifiant de l'utilisateur connecté (null sans session). */
export async function getCurrentUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** Email de l'admin connecté ('' sans session). */
export async function getCurrentUserEmail() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email ?? '';
}

/** Change le mot de passe de l'utilisateur connecté. nonce : code de réauthentification reçu par email. */
export async function updatePassword(password, { nonce, currentPassword } = {}) {
  const attributes = { password };
  if (nonce) attributes.nonce = nonce.trim();
  if (currentPassword) attributes.current_password = currentPassword;
  const { error } = await supabase.auth.updateUser(attributes);
  if (error) throw toAuthError(error, 'Changement du mot de passe impossible. Réessayez.');
}

/** Envoie par email le code exigé par Supabase quand la session est trop ancienne (« Secure password change »). */
export async function sendReauthenticationCode() {
  const { error } = await supabase.auth.reauthenticate();
  if (error) throw toAuthError(error, 'Envoi du code impossible. Réessayez.');
}

/** true si l'utilisateur connecté est dans app_admins. */
export async function isAppAdmin() {
  const { data, error } = await supabase.rpc('is_app_admin');
  if (error) throw error;
  return data === true;
}
