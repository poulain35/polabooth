import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_MIN_LENGTH, RESET_PASSWORD_PATH, RESET_REQUEST_SENT,
  appBaseUrl, authErrorCode, authErrorMessage, passwordProblem, recoveryLink,
  recoveryLinkMessage, resetRedirectUrl, toAuthError,
} from './passwordRules.js';

test('passwordProblem : vide, trop court, trop long, différent, valide', () => {
  assert.equal(passwordProblem('', ''), 'Saisissez un nouveau mot de passe.');
  assert.equal(passwordProblem(undefined, undefined), 'Saisissez un nouveau mot de passe.');
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(passwordProblem('abc1234', 'abc1234'), 'Le mot de passe doit contenir au moins 8 caractères.');
  assert.equal(passwordProblem('a'.repeat(73), 'a'.repeat(73)), 'Le mot de passe est trop long (72 caractères au maximum).');
  // 72 octets : les caractères accentués en comptent deux.
  assert.match(passwordProblem('é'.repeat(37), 'é'.repeat(37)), /trop long/);
  assert.equal(passwordProblem('motdepasse', 'motdepass'), 'Les deux mots de passe ne sont pas identiques.');
  assert.equal(passwordProblem('abcd1234', 'abcd1234'), null);
  assert.equal(passwordProblem('a'.repeat(72), 'a'.repeat(72)), null);
});

test('passwordProblem : la longueur passe avant la confirmation', () => {
  assert.match(passwordProblem('court', 'autre'), /au moins 8/);
});

test('resetRedirectUrl : VITE_APP_URL prioritaire, sinon origine, jamais de slash final', () => {
  assert.equal(RESET_PASSWORD_PATH, '/admin/nouveau-mot-de-passe');
  assert.equal(resetRedirectUrl('https://app.exemple.fr/', 'http://localhost:5173'), 'https://app.exemple.fr/admin/nouveau-mot-de-passe');
  assert.equal(resetRedirectUrl('https://app.exemple.fr', 'x'), 'https://app.exemple.fr/admin/nouveau-mot-de-passe');
  assert.equal(resetRedirectUrl(undefined, 'http://localhost:5173'), 'http://localhost:5173/admin/nouveau-mot-de-passe');
  assert.equal(resetRedirectUrl('', 'https://photos.loueur.fr//'), 'https://photos.loueur.fr/admin/nouveau-mot-de-passe');
  assert.equal(appBaseUrl(' https://a.fr/ ', ''), 'https://a.fr');
});

test('RESET_REQUEST_SENT : message neutre (ne dit pas si le compte existe)', () => {
  assert.equal(RESET_REQUEST_SENT, 'Si un compte existe pour cette adresse, un email vient d\'être envoyé.');
});

test('recoveryLink : erreur du flux implicite dans le hash', () => {
  const link = recoveryLink('https://a.fr/admin/nouveau-mot-de-passe#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(link.error, 'otp_expired');
  assert.equal(recoveryLinkMessage(link.error), 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.');
});

test('recoveryLink : erreur PKCE dans la query, erreur sans code', () => {
  assert.equal(recoveryLink('https://a.fr/x?error=server_error&error_code=flow_state_expired').error, 'flow_state_expired');
  assert.equal(recoveryLink('https://a.fr/x#error=access_denied').error, 'access_denied');
  assert.equal(recoveryLink('https://a.fr/x#error_description=Oups').error, 'unspecified_error');
  assert.equal(recoveryLinkMessage('access_denied'), 'Ce lien de réinitialisation n\'est pas valide. Demandez-en un nouveau.');
});

test('recoveryLink : code PKCE, token_hash, lien sans paramètre, adresse illisible', () => {
  assert.deepEqual(recoveryLink('https://a.fr/x?code=abc'), { error: null, code: 'abc', tokenHash: null, type: null });
  assert.deepEqual(recoveryLink('https://a.fr/x?token_hash=h1&type=recovery'), { error: null, code: null, tokenHash: 'h1', type: 'recovery' });
  assert.deepEqual(recoveryLink('https://a.fr/x'), { error: null, code: null, tokenHash: null, type: null });
  assert.deepEqual(recoveryLink('pas une url'), { error: null, code: null, tokenHash: null, type: null });
});

test('recoveryLinkMessage : lien ouvert dans un autre navigateur (PKCE) et lien absent', () => {
  assert.match(recoveryLinkMessage('bad_code_verifier'), /même navigateur|navigateur où/);
  assert.match(recoveryLinkMessage('code_verifier_missing'), /navigateur où/);
  assert.match(recoveryLinkMessage('missing'), /n'est pas valide/);
});

test('authErrorMessage : même mot de passe que l\'ancien', () => {
  const err = { code: 'same_password', status: 422, message: 'New password should be different from the old password.' };
  assert.equal(authErrorMessage(err), 'Le nouveau mot de passe doit être différent de l\'ancien.');
  assert.equal(authErrorCode({ message: 'New password should be different from the old password.' }), 'same_password');
});

test('authErrorMessage : mot de passe faible selon la raison', () => {
  const weak = (reasons) => ({ code: 'weak_password', name: 'AuthWeakPasswordError', reasons, message: 'x' });
  assert.match(authErrorMessage(weak(['pwned'])), /fuites de données/);
  assert.match(authErrorMessage(weak(['characters'])), /minuscules, majuscules, chiffres et symboles/);
  assert.match(authErrorMessage(weak(['length'])), /trop court/);
  assert.match(authErrorMessage(weak([])), /trop faible/);
  assert.equal(authErrorCode({ name: 'AuthWeakPasswordError', message: 'x' }), 'weak_password');
});

test('authErrorMessage : lien expiré', () => {
  assert.match(authErrorMessage({ code: 'otp_expired', message: 'Email link is invalid or has expired' }), /expiré/);
  assert.equal(authErrorCode({ message: 'Email link is invalid or has expired' }), 'otp_expired');
});

test('authErrorMessage : limite d\'envoi (429), avec ou sans délai', () => {
  assert.equal(
    authErrorMessage({ code: 'over_email_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 42 seconds.' }),
    'Trop de demandes à la suite. Réessayez dans 42 secondes.',
  );
  assert.equal(
    authErrorMessage({ code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' }),
    'Trop de demandes à la suite. Patientez quelques minutes avant de réessayer.',
  );
  assert.equal(authErrorCode({ status: 429, message: 'Too many requests' }), 'over_request_rate_limit');
  assert.equal(authErrorCode({ message: 'email rate limit exceeded' }), 'over_request_rate_limit');
});

test('authErrorMessage : réauthentification, session, identifiants, réseau', () => {
  assert.match(authErrorMessage({ code: 'reauthentication_needed', message: 'Password update requires reauthentication' }), /confirmez votre identité/);
  assert.equal(authErrorCode({ message: 'Password update requires reauthentication' }), 'reauthentication_needed');
  assert.equal(authErrorMessage({ code: 'reauthentication_not_valid' }), 'Code de vérification incorrect ou expiré.');
  assert.match(authErrorMessage({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }), /session a expiré/);
  assert.equal(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }), 'Email ou mot de passe incorrect');
  assert.equal(authErrorMessage({ message: 'Invalid login credentials' }), 'Email ou mot de passe incorrect');
  assert.match(authErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), /Connexion impossible/);
});

test('authErrorMessage : erreur inconnue ⇒ message d\'origine, sinon repli', () => {
  assert.equal(authErrorMessage({ code: 'autre', message: 'Quelque chose' }), 'Quelque chose');
  assert.equal(authErrorMessage({}, 'Repli'), 'Repli');
  assert.equal(authErrorMessage(null, 'Repli'), 'Repli');
});

test('toAuthError : message traduit, code conservé', () => {
  const err = toAuthError({ code: 'same_password', message: 'New password should be different from the old password.' });
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'same_password');
  assert.equal(err.message, 'Le nouveau mot de passe doit être différent de l\'ancien.');
  assert.equal(toAuthError({ message: 'Password update requires reauthentication' }).code, 'reauthentication_needed');
});
