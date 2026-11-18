// Email de test (LAB-345) : réglages vérifiés avant l'envoi, envoi simulé (aucun email réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_MESSAGE_LENGTH, MESSAGES, TEST_SUBJECT, refusalHint, renderTestEmail, sendTestEmail,
  type TestEmailContext, type TestEmailMessage,
} from './logic.ts';

const ACCOUNT = 'admin@example.invalid';
const SENDER = { email: 'contact@example.invalid', name: 'Studio Test' };

const ctx = (over: Partial<TestEmailContext> = {}): TestEmailContext => ({
  to: ACCOUNT,
  provider: 'brevo',
  hasBrevoKey: true,
  hasSmtpHost: false,
  sender: SENDER,
  guard: {},
  ...over,
});

function recorder(result: string | null | Error = 'msg-1') {
  const sent: TestEmailMessage[] = [];
  const send = (m: TestEmailMessage) => {
    sent.push(m);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { sent, send };
}

// Même forme que EmailSendError de _shared/email.ts (non importable sous node : Deno lu au chargement).
function sendError(status: number, message: string) {
  return Object.assign(new Error(message), { name: 'EmailSendError', status });
}

test('envoyé : à l\'adresse du compte, avec l\'expéditeur de l\'organisation', async () => {
  const { sent, send } = recorder();
  const res = await sendTestEmail(ctx(), send);
  assert.deepEqual(res, { ok: true, provider: 'brevo', to: ACCOUNT, message: MESSAGES.sent(ACCOUNT) });
  assert.match(res.message, /indésirables/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, ACCOUNT);
  assert.deepEqual(sent[0].sender, SENDER);
  assert.equal(sent[0].subject, TEST_SUBJECT);
});

test('SMTP : même chemin, fournisseur rendu', async () => {
  const { sent, send } = recorder('<id@smtp>');
  const res = await sendTestEmail(ctx({ provider: 'smtp', hasBrevoKey: false, hasSmtpHost: true }), send);
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'smtp');
  assert.match(sent[0].html, /votre serveur SMTP/);
});

test('compte sans email : rien n\'est envoyé', async () => {
  for (const to of [null, undefined, '', '   ']) {
    const { sent, send } = recorder();
    const res = await sendTestEmail(ctx({ to }), send);
    assert.deepEqual(res, { ok: false, provider: 'brevo', to: null, message: MESSAGES.noAccountEmail });
    assert.equal(sent.length, 0);
  }
});

test('aucun service d\'envoi : Brevo sans clé, ou SMTP choisi sans serveur', async () => {
  const brevo = recorder();
  const a = await sendTestEmail(ctx({ hasBrevoKey: false }), brevo.send);
  assert.equal(a.ok, false);
  assert.equal(a.message, MESSAGES.noBrevoKey);
  assert.equal(brevo.sent.length, 0);

  const smtp = recorder();
  const b = await sendTestEmail(ctx({ provider: 'smtp', hasBrevoKey: false, hasSmtpHost: false }), smtp.send);
  assert.equal(b.ok, false);
  assert.equal(b.message, MESSAGES.noSmtpHost);
  assert.equal(smtp.sent.length, 0);
});

test('expéditeur absent (ni réglage de l\'entreprise, ni FROM_EMAIL) : rien n\'est envoyé', async () => {
  const { sent, send } = recorder();
  const res = await sendTestEmail(ctx({ sender: { email: '', name: 'Studio Test' } }), send);
  assert.equal(res.ok, false);
  assert.equal(res.message, MESSAGES.noSender);
  assert.equal(sent.length, 0);
});

test('EMAIL_ALLOWLIST : adresse hors liste bloquée avant l\'envoi, adresse de la liste envoyée', async () => {
  const blocked = recorder();
  const res = await sendTestEmail(ctx({ guard: { allowlist: ['autre.example.invalid'] } }), blocked.send);
  assert.equal(res.ok, false);
  assert.equal(res.message, MESSAGES.notAllowed(ACCOUNT));
  assert.equal(blocked.sent.length, 0);

  const allowed = recorder();
  const ok = await sendTestEmail(ctx({ guard: { allowlist: ['example.invalid'] } }), allowed.send);
  assert.equal(ok.ok, true);
  assert.equal(allowed.sent.length, 1);
});

test('EMAIL_REDIRECT_TO : le message dit où l\'email est vraiment parti', async () => {
  const { sent, send } = recorder();
  const res = await sendTestEmail(ctx({ guard: { redirectTo: 'qa@example.invalid' } }), send);
  assert.equal(res.ok, true);
  assert.equal(res.to, 'qa@example.invalid');
  assert.equal(res.message, MESSAGES.redirected('qa@example.invalid', ACCOUNT));
  assert.equal(sent[0].to, ACCOUNT, 'la redirection reste appliquée par l\'envoi lui-même');
});

test('refus SMTP 535 : « Envoi refusé : SMTP 535… » et piste identifiant / mot de passe', async () => {
  const { send } = recorder(sendError(535, 'SMTP 535 : EAUTH : 535 5.7.8 Authentication failed'));
  const res = await sendTestEmail(ctx({ provider: 'smtp', hasSmtpHost: true }), send);
  assert.equal(res.ok, false);
  assert.equal(res.message, 'Envoi refusé : SMTP 535 : EAUTH : 535 5.7.8 Authentication failed');
  assert.match(res.hint ?? '', /SMTP_USER, SMTP_PASSWORD/);
});

test('refus Brevo : message borné à 300 caractères', async () => {
  const { send } = recorder(sendError(401, `Brevo 401 : ${'x'.repeat(400)}`));
  const res = await sendTestEmail(ctx(), send);
  assert.equal(res.ok, false);
  assert.ok(res.message.startsWith('Envoi refusé : Brevo 401 : '));
  assert.equal(res.message.length, MAX_MESSAGE_LENGTH);
  assert.match(res.hint ?? '', /Brevo refuse la clé/);
});

test('service injoignable (erreur réseau) : ok false, pas d\'exception', async () => {
  const { send } = recorder(new TypeError('fetch failed'));
  const res = await sendTestEmail(ctx(), send);
  assert.deepEqual(res, { ok: false, provider: 'brevo', to: ACCOUNT, message: 'Envoi impossible : fetch failed' });
});

test('aucun identifiant renvoyé par le service : non confirmé', async () => {
  const { send } = recorder(null);
  const res = await sendTestEmail(ctx(), send);
  assert.equal(res.ok, false);
  assert.equal(res.message, MESSAGES.notSent);
});

test('pistes de correction par code', () => {
  assert.match(refusalHint('smtp', 0), /ne répond pas/);
  assert.match(refusalHint('smtp', 553), /adresse d'expédition/);
  assert.match(refusalHint('smtp', 421), /hébergeur/);
  assert.match(refusalHint('brevo', 400), /validée dans Brevo/);
  assert.match(refusalHint('brevo', 500), /réessayez plus tard/);
});

test('contenu : gabarit des emails internes, valeurs échappées', () => {
  const { subject, html } = renderTestEmail({ provider: 'brevo', sender: { email: 'a@example.invalid', name: '<b>X</b>' }, to: ACCOUNT });
  assert.equal(subject, TEST_SUBJECT);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt; &lt;a@example\.invalid&gt;/);
  assert.doesNotMatch(html, /<b>X<\/b>/);
  assert.doesNotMatch(html, /<!--brand:footer-->/, 'audience admin : pas de pied de page client');
});

test('index.ts : destinataire = email du compte, droits avant l\'envoi, jamais de destinataire du corps', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const guard = src.indexOf('requireAppAdmin(db, auth.user.id)');
  assert.ok(guard > src.indexOf("authenticate(req.headers.get('Authorization'), sessionUser)"));
  const send = src.indexOf('await sendTestEmail({');
  assert.ok(guard > 0 && guard < send, 'administrateur vérifié avant l\'envoi');
  assert.ok(src.indexOf('LIMITS.testEmailUser') < send, 'limite avant l\'envoi');
  assert.match(src, /to: auth\.user\.email,/);
  assert.match(src, /\}, sendHtmlEmail\);/, 'même envoi que les vrais emails');
  assert.doesNotMatch(src, /req\.json\(/, 'aucun paramètre lu : pas de relais');
  assert.doesNotMatch(src, /from\('email_logs'\)|logEmail\(/, 'pas de ligne email_logs');
});

test('limite d’envoi : 10 emails de test par heure et par compte (LAB-346)', async () => {
  const { LIMITS } = await import('../_shared/public-rate-limit.ts');
  assert.deepEqual(LIMITS.testEmailUser, { bucket: 'test-email:user', limit: 10, windowSeconds: 3600 });
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /guard\.check\(\[\[LIMITS\.testEmailUser, auth\.user\.id\]\]\)/, 'clé = le compte, pas l’adresse IP');
  assert.ok(src.indexOf('requireAppAdmin(') < src.indexOf('LIMITS.testEmailUser'), 'droits vérifiés avant de compter');
  assert.match(src, /if \(limited\) return limited;/);
  assert.equal((src.match(/\bto:/g) ?? []).length, 1, 'un seul destinataire possible');
});
