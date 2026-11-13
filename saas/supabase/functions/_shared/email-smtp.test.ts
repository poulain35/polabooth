// Envoi SMTP des emails (open core étape 2, lot S2) : choix du fournisseur, conversion du payload,
// câblage dans _shared/email.ts (faux transport) et non-régression Brevo (payload identique).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmailProvider } from './email-provider.ts';
import {
  describeSmtpError, setSmtpTransportFactory, smtpConfigFromEnv, smtpMessageFromPayload,
  type SmtpConfig, type SmtpMessage,
} from './smtp.ts';
import { renderAccessCodeEmail } from './saas-emails.ts';
import { applyEmailBrand, emailBrandFromOrg } from './email-brand.ts';

const envOf = (vars: Record<string, string>) => (k: string) => vars[k];

// ── Choix du fournisseur ────────────────────────────────────────────────────

test('resolveEmailProvider : sans variable nouvelle → Brevo, sans lire la clé', async () => {
  let read = 0;
  const key = async () => { read++; return null; };
  assert.equal(await resolveEmailProvider(key, envOf({})), 'brevo');
  assert.equal(read, 0);
});

test('resolveEmailProvider : EMAIL_PROVIDER explicite (casse et espaces ignorés)', async () => {
  const key = async () => 'xkeysib';
  assert.equal(await resolveEmailProvider(key, envOf({ EMAIL_PROVIDER: ' SMTP ' })), 'smtp');
  assert.equal(await resolveEmailProvider(async () => null, envOf({ EMAIL_PROVIDER: 'brevo', SMTP_HOST: 'smtp.x.fr' })), 'brevo');
});

test('resolveEmailProvider : absent → SMTP seulement sans clé Brevo et avec SMTP_HOST', async () => {
  assert.equal(await resolveEmailProvider(async () => null, envOf({ SMTP_HOST: 'smtp.x.fr' })), 'smtp');
  assert.equal(await resolveEmailProvider(async () => 'xkeysib', envOf({ SMTP_HOST: 'smtp.x.fr' })), 'brevo');
  assert.equal(await resolveEmailProvider(async () => null, envOf({ SMTP_HOST: '  ' })), 'brevo');
  assert.equal(await resolveEmailProvider(async () => null, envOf({ EMAIL_PROVIDER: 'autre', SMTP_HOST: 'smtp.x.fr' })), 'smtp');
});

// ── Configuration et conversion ─────────────────────────────────────────────

test('smtpConfigFromEnv : null sans SMTP_HOST, port 465 (TLS direct) par défaut', () => {
  assert.equal(smtpConfigFromEnv(envOf({})), null);
  assert.deepEqual(smtpConfigFromEnv(envOf({ SMTP_HOST: ' smtp.x.fr ', SMTP_USER: 'u', SMTP_PASSWORD: ' p ' })), {
    host: 'smtp.x.fr', port: 465, secure: true, user: 'u', password: ' p ',
  });
  assert.deepEqual(smtpConfigFromEnv(envOf({ SMTP_HOST: 'smtp.x.fr', SMTP_PORT: '2525' })), {
    host: 'smtp.x.fr', port: 2525, secure: false, user: null, password: null,
  });
  assert.equal(smtpConfigFromEnv(envOf({ SMTP_HOST: 'smtp.x.fr', SMTP_PORT: 'abc' }))?.port, 465);
  assert.equal(smtpConfigFromEnv(envOf({ SMTP_HOST: 'smtp.x.fr', SMTP_PORT: '70000' }))?.port, 465);
});

test('smtpMessageFromPayload : expéditeur, destinataires, en-têtes et pièces jointes', () => {
  const message = smtpMessageFromPayload({
    sender: { email: 'contact@pola.fr', name: 'Pola' },
    to: [{ email: 'a@x.fr' }],
    cc: [{ email: 'b@x.fr', name: 'B' }],
    subject: 'Objet',
    htmlContent: '<p>x</p>',
    headers: { 'List-Unsubscribe': '<https://x.fr/u>' },
    attachment: [{ content: 'JVBERi0=', name: 'Devis.pdf' }, { url: 'https://x.fr/f.pdf' }],
  });
  assert.deepEqual(message, {
    from: { name: 'Pola', address: 'contact@pola.fr' },
    to: [{ address: 'a@x.fr' }],
    cc: [{ name: 'B', address: 'b@x.fr' }],
    subject: 'Objet',
    html: '<p>x</p>',
    headers: { 'List-Unsubscribe': '<https://x.fr/u>' },
    attachments: [{ filename: 'Devis.pdf', content: 'JVBERi0=', encoding: 'base64' }, { href: 'https://x.fr/f.pdf' }],
  });
});

test('smtpMessageFromPayload : un modèle Brevo (sans HTML) ne part pas en SMTP', () => {
  assert.throws(() => smtpMessageFromPayload({ sender: { email: 'a@x.fr' }, to: [{ email: 'b@x.fr' }], templateId: 3 }), /modèles Brevo/);
  assert.throws(() => smtpMessageFromPayload({ to: [{ email: 'b@x.fr' }], htmlContent: '' }), /Expéditeur/);
  assert.throws(() => smtpMessageFromPayload({ sender: { email: 'a@x.fr' }, to: [], htmlContent: '' }), /destinataire/);
});

test('describeSmtpError : code de réponse et message du serveur', () => {
  assert.deepEqual(describeSmtpError(Object.assign(new Error('Invalid login'), {
    code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Authentication failed',
  })), { status: 535, detail: 'EAUTH : 535 5.7.8 Authentication failed' });
  assert.deepEqual(describeSmtpError(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' })),
    { status: 0, detail: 'ETIMEDOUT : Connection timeout' });
});

// ── Câblage dans _shared/email.ts ───────────────────────────────────────────

// Variables lues à chaque envoi (fournisseur, clé Brevo, SMTP_*) : modifiables test par test.
// Sans SUPABASE_URL, la clé Brevo vient de l'environnement et la marque retombe sur FROM_NAME.
const BASE_ENV: Record<string, string> = {
  BREVO_API_KEY: 'brevo-factice',
  FROM_EMAIL: 'noreply@pola.fr',
  FROM_NAME: 'Studio Exemple',
  APP_URL: 'https://app.pola.fr',
};
let ENV: Record<string, string> = { ...BASE_ENV };
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
const { sendAccessCodeEmail, sendBookingEmail, sendDeliveryEmail, sendHtmlEmail, EmailSendError } = await import('./email.ts');

const PDF_URL = 'https://files.pola.fr/facture.pdf';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

interface BrevoCall { url: string; method?: string; headers: unknown; body: string }
let brevoCalls: BrevoCall[] = [];
let otherCalls: string[] = [];
let smtpSent: Array<{ config: SmtpConfig; name: string | undefined; message: SmtpMessage }> = [];
let smtpFailure: unknown = null;

beforeEach(() => {
  ENV = { ...BASE_ENV };
  brevoCalls = [];
  otherCalls = [];
  smtpSent = [];
  smtpFailure = null;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === PDF_URL) return new Response(PDF);
    if (u === 'https://api.brevo.com/v3/smtp/email') {
      brevoCalls.push({ url: u, method: init?.method, headers: init?.headers, body: String(init?.body) });
      return new Response(JSON.stringify({ messageId: '<m@brevo>' }), { status: 201 });
    }
    otherCalls.push(u);
    return new Response('absent', { status: 404 });
  }) as typeof fetch;
  setSmtpTransportFactory((config, name) => ({
    async sendMail(message) {
      if (smtpFailure) throw smtpFailure;
      smtpSent.push({ config, name, message });
      return { messageId: '<m@smtp>' };
    },
  }));
});
afterEach(() => setSmtpTransportFactory(null));

const brand = emailBrandFromOrg(null, BASE_ENV.FROM_NAME);
const ACCESS = { to: 'client@exemple.fr', clientName: 'Léa', eventName: 'Mariage', accessCode: 'ABC123', expiresAt: '2026-12-31' };
const BREVO_HEADERS = { 'api-key': 'brevo-factice', 'Content-Type': 'application/json' };

test('Brevo sans variable nouvelle : code d\'accès HTML, payload identique octet pour octet', async () => {
  const sent = await sendAccessCodeEmail(ACCESS);
  const { subject, html } = renderAccessCodeEmail({
    clientName: 'Léa', eventName: 'Mariage', accessCode: 'ABC123', editorUrl: 'https://app.pola.fr/e/ABC123', expiresAt: '2026-12-31',
  });
  assert.deepEqual(sent, { messageId: '<m@brevo>', subject, error: null });
  assert.deepEqual(brevoCalls, [{
    url: 'https://api.brevo.com/v3/smtp/email',
    method: 'POST',
    headers: BREVO_HEADERS,
    body: JSON.stringify({
      sender: { email: 'noreply@pola.fr', name: 'Studio Exemple' },
      to: [{ email: 'client@exemple.fr' }],
      subject,
      htmlContent: applyEmailBrand(html, brand),
    }),
  }]);
  assert.deepEqual(otherCalls, []);
  assert.equal(smtpSent.length, 0);
});

test('Brevo sans variable nouvelle : code d\'accès par modèle, payload identique', async () => {
  const sender = { email: 'contact@client.fr', name: 'Client' };
  await sendAccessCodeEmail({ ...ACCESS, templateId: 12, sender });
  assert.equal(brevoCalls.length, 1);
  assert.deepEqual(brevoCalls[0].headers, BREVO_HEADERS);
  assert.equal(brevoCalls[0].body, JSON.stringify({
    sender,
    to: [{ email: 'client@exemple.fr' }],
    templateId: 12,
    params: {
      CLIENT_NAME: 'Léa',
      EVENT_NAME: 'Mariage',
      ACCESS_CODE: 'ABC123',
      EDITOR_URL: 'https://app.pola.fr/e/ABC123',
      EXPIRES_DATE: new Date('2026-12-31').toLocaleDateString('fr-FR'),
    },
  }));
});

test('Brevo sans variable nouvelle : email de réservation avec pièce jointe et en-têtes, payload identique', async () => {
  const rendered = { subject: 'Votre devis', html: '<p>Bonjour</p>', params: {} };
  const headers = { 'List-Unsubscribe': '<https://app.pola.fr/u>' };
  await sendBookingEmail({ to: 'client@exemple.fr', rendered, templateId: null, attachment: [{ url: PDF_URL, name: 'Devis.pdf' }], headers });
  assert.equal(brevoCalls.length, 1);
  assert.deepEqual(brevoCalls[0].headers, BREVO_HEADERS);
  assert.equal(brevoCalls[0].body, JSON.stringify({
    sender: { email: 'noreply@pola.fr', name: 'Studio Exemple' },
    to: [{ email: 'client@exemple.fr' }],
    subject: 'Votre devis',
    htmlContent: '<p>Bonjour</p>',
    attachment: [{ content: Buffer.from(PDF).toString('base64'), name: 'Devis.pdf' }],
    headers,
  }));
  // Avec SMTP_HOST mais une clé Brevo : toujours Brevo.
  ENV.SMTP_HOST = 'smtp.pola.fr';
  await sendBookingEmail({ to: 'client@exemple.fr', rendered, templateId: null });
  assert.equal(brevoCalls.length, 2);
  assert.equal(smtpSent.length, 0);
});

test('SMTP : le code d\'accès part par le transport, avec la marque, sans modèle Brevo', async () => {
  Object.assign(ENV, { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.pola.fr', SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
  const sent = await sendAccessCodeEmail({ ...ACCESS, templateId: 12 });
  const { subject, html } = renderAccessCodeEmail({
    clientName: 'Léa', eventName: 'Mariage', accessCode: 'ABC123', editorUrl: 'https://app.pola.fr/e/ABC123', expiresAt: '2026-12-31',
  });
  assert.deepEqual(sent, { messageId: '<m@smtp>', subject, error: null });
  assert.equal(brevoCalls.length, 0);
  assert.deepEqual(otherCalls, []); // ni API Brevo, ni objet de modèle
  assert.equal(smtpSent.length, 1);
  const { config, name, message } = smtpSent[0];
  assert.deepEqual(config, { host: 'smtp.pola.fr', port: 465, secure: true, user: 'u', password: 'p' });
  assert.equal(name, 'pola.fr');
  assert.deepEqual(message.from, { name: 'Studio Exemple', address: 'noreply@pola.fr' });
  assert.deepEqual(message.to, [{ address: 'client@exemple.fr' }]);
  assert.equal(message.subject, subject);
  assert.equal(message.html, applyEmailBrand(html, brand));
  assert.ok(message.html.includes('Studio Exemple'));
  assert.doesNotMatch(message.html, /<!--brand:|%%BRAND_/);
});

test('SMTP : pièce jointe téléchargée puis jointe en base64', async () => {
  Object.assign(ENV, { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.pola.fr' });
  const sent = await sendDeliveryEmail({
    to: 'client@exemple.fr', clientName: 'Léa', eventName: 'Mariage', companyName: 'Pola',
    photoGalleryUrl: 'https://photos.pola.fr/g', attachmentUrl: PDF_URL,
  });
  assert.equal(sent.messageId, '<m@smtp>');
  assert.equal(smtpSent.length, 1);
  assert.deepEqual(smtpSent[0].message.attachments, [
    { filename: 'facture.pdf', content: Buffer.from(PDF).toString('base64'), encoding: 'base64' },
  ]);
});

test('SMTP automatique : pas de clé Brevo et SMTP_HOST défini', async () => {
  delete ENV.BREVO_API_KEY;
  ENV.SMTP_HOST = 'smtp.pola.fr';
  assert.equal(await sendHtmlEmail({ to: 'client@exemple.fr', subject: 'Vos photos', html: '<p>x</p>' }), '<m@smtp>');
  assert.equal(brevoCalls.length, 0);
});

test('SMTP sans SMTP_HOST : rien n\'est envoyé, retour null comme sans clé Brevo', async () => {
  ENV.EMAIL_PROVIDER = 'smtp';
  assert.equal(await sendHtmlEmail({ to: 'client@exemple.fr', subject: 'x', html: '<p>x</p>' }), null);
  assert.equal(smtpSent.length + brevoCalls.length, 0);
});

test('SMTP : une erreur du serveur lève EmailSendError (et devient error pour email_logs)', async () => {
  Object.assign(ENV, { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.pola.fr' });
  smtpFailure = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 Authentication failed' });
  const rendered = { subject: 'Votre devis', html: '<p>x</p>', params: {} };
  await assert.rejects(sendBookingEmail({ to: 'client@exemple.fr', rendered, templateId: 4 }), (e: unknown) => {
    assert.ok(e instanceof EmailSendError);
    assert.equal(e.status, 535);
    assert.equal(e.message, 'SMTP 535 : EAUTH : 535 Authentication failed');
    return true;
  });
  const sent = await sendAccessCodeEmail(ACCESS);
  assert.equal(sent.messageId, null);
  assert.match(sent.error ?? '', /^SMTP 535 : /);

  smtpFailure = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
  await assert.rejects(sendHtmlEmail({ to: 'client@exemple.fr', subject: 'x', html: '<p>x</p>' }),
    { name: 'EmailSendError', message: 'SMTP : ETIMEDOUT : Connection timeout' });
});

// ── email-sync : rien à resynchroniser en SMTP ───────────────────────────────

test('email-sync : en SMTP, réponse 200 skipped avant toute lecture ou appel Brevo', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../email-sync/index.ts', import.meta.url), 'utf8');
  const skip = src.indexOf("if (provider !== 'brevo')");
  assert.ok(skip > 0);
  assert.match(src, /resolveEmailProvider\(\(\) => serviceSecret\('BREVO_API_KEY'\)\)/);
  assert.match(src.slice(skip, skip + 300), /corsResponse\(200, \{\s*skipped: true,/);
  assert.match(src.slice(skip, skip + 300), /Suivi indisponible avec SMTP/);
  assert.ok(skip < src.indexOf('authenticate('));
  assert.ok(skip < src.indexOf("db.from('email_logs')"));
  assert.ok(skip < src.indexOf('https://api.brevo.com'));
});
