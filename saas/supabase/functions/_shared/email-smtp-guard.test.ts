// Garde-fou des emails (EMAIL_SUBJECT_PREFIX, EMAIL_ALLOWLIST) en SMTP (open core étape 2, lot S2).
// Fichier à part : la configuration du garde-fou est lue au chargement de _shared/email.ts.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setSmtpTransportFactory, type SmtpMessage } from './smtp.ts';

const ENV: Record<string, string> = {
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.pola.fr',
  FROM_EMAIL: 'noreply@pola.fr',
  FROM_NAME: 'Pola',
  EMAIL_SUBJECT_PREFIX: '[TEST] ',
  EMAIL_ALLOWLIST: 'moi@gmail.com',
};
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
const { sendHtmlEmail, sendBookingEmail } = await import('./email.ts');

let sent: SmtpMessage[] = [];
let fetched: string[] = [];
beforeEach(() => {
  sent = [];
  fetched = [];
  globalThis.fetch = (async (url: string | URL) => {
    fetched.push(String(url));
    return new Response('absent', { status: 404 });
  }) as typeof fetch;
  setSmtpTransportFactory(() => ({
    async sendMail(message) { sent.push(message); return { messageId: '<m@smtp>' }; },
  }));
});
afterEach(() => setSmtpTransportFactory(null));

test('SMTP : destinataire autorisé (alias +) → envoyé avec l\'objet préfixé', async () => {
  assert.equal(await sendHtmlEmail({ to: 'moi+kiosk@gmail.com', subject: 'Vos photos', html: '<p>x</p>' }), '<m@smtp>');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '[TEST] Vos photos');
});

test('SMTP : hors EMAIL_ALLOWLIST → rien n\'est envoyé, retour null', async () => {
  assert.equal(await sendHtmlEmail({ to: 'client@x.fr', subject: 'Vos photos', html: '<p>x</p>' }), null);
  assert.equal(sent.length, 0);
});

test('SMTP : modèle Brevo ignoré, objet de l\'app préfixé, aucun appel à l\'API Brevo', async () => {
  const rendered = { subject: 'Votre devis', html: '<p>x</p>', params: { CLIENT_NAME: 'Léa' } };
  await sendBookingEmail({ to: 'moi@gmail.com', rendered, templateId: 7 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '[TEST] Votre devis');
  assert.deepEqual(fetched, []);
});
