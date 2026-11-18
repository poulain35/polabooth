// Email de la borne (LAB-300) : l'aperçu (kiosk-email-preview) montre exactement le HTML envoyé
// (send-kiosk-photo, email de test), par Brevo comme par SMTP ; D14 : l'envoi ne demande plus
// BREVO_API_KEY (SMTP seul suffit, sans fournisseur rien ne part et rien n'est compté).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildKioskEmail, testSubject, type KioskEmailInput } from './kiosk-email.ts';
import { setSmtpTransportFactory, type SmtpMessage } from './smtp.ts';
import { sendKioskEmailAndCount } from './event-activity.ts';

// Variables lues à chaque envoi ; sans SUPABASE_URL, clé Brevo et marque viennent de l'environnement.
const BASE_ENV: Record<string, string> = {
  BREVO_API_KEY: 'brevo-factice',
  FROM_EMAIL: 'noreply@pola.fr',
  FROM_NAME: 'Studio Exemple',
  APP_URL: 'https://app.pola.fr',
};
let ENV: Record<string, string> = { ...BASE_ENV };
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
const { brandEmailHtml, sendHtmlEmail } = await import('./email.ts');

let brevoBodies: Array<Record<string, unknown>> = [];
let smtpSent: SmtpMessage[] = [];

beforeEach(() => {
  ENV = { ...BASE_ENV };
  brevoBodies = [];
  smtpSent = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
      brevoBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ messageId: '<m@brevo>' }), { status: 201 });
    }
    return new Response('absent', { status: 404 });
  }) as typeof fetch;
  setSmtpTransportFactory(() => ({
    async sendMail(message) {
      smtpSent.push(message);
      return { messageId: '<m@smtp>' };
    },
  }));
});
afterEach(() => setSmtpTransportFactory(null));

const INPUT: KioskEmailInput = {
  event: { name: 'Mariage Camille & Hugo', access_code: 'K7M2PQ', start_date: '2026-06-13T18:00:00+02:00', client_name: 'Camille & Hugo' },
  email: {
    subject: 'Vos photos — {event_name}', title: 'Merci {client_name} !', button_label: 'Voir ma photo',
    message: 'Bonjour,\n**Merci** d’être venus le {event_date}.', sender_name: 'Studio', sender_email: 'contact@studio.example',
  },
  branding: { color: '#1F4E79', logo_url: 'https://cdn.example.com/events/brand-logo.png' },
  identity: { companyName: 'Studio Exemple', senderName: '', senderEmail: 'noreply@pola.fr' },
  photo: { id: '9a7d6e5f-1111-4222-8333-444455556666', media_type: 'photo', thumbnail_url: null },
  photoUrl: 'https://photos.example.com/p.jpg',
  appUrl: 'https://app.pola.fr',
};

/** Ce que fait send-kiosk-photo (compteur simulé). */
async function sendLikeKiosk(to: string, rows: unknown[]) {
  const { subject, html, sender } = buildKioskEmail(INPUT);
  const db = { from: () => ({ insert: (row: unknown) => { rows.push(row); return Promise.resolve({ error: null }); } }) };
  return await sendKioskEmailAndCount(db, 'evt', () => sendHtmlEmail({ to, subject, html, sender }));
}

test('aperçu = email envoyé (Brevo) : même HTML, même objet, même expéditeur', async () => {
  const built = buildKioskEmail(INPUT);
  const preview = await brandEmailHtml(built.html);
  const rows: unknown[] = [];
  assert.equal(await sendLikeKiosk('invite@exemple.fr', rows), '<m@brevo>');
  assert.equal(rows.length, 1, 'envoi réel compté');
  assert.equal(brevoBodies.length, 1);
  assert.equal(brevoBodies[0].htmlContent, preview);
  assert.equal(brevoBodies[0].subject, built.subject);
  assert.deepEqual(brevoBodies[0].sender, { email: 'contact@studio.example', name: 'Studio' });
  assert.doesNotMatch(preview, /<!--brand:|%%BRAND_/);
  assert.ok(preview.includes('Merci Camille &amp; Hugo !') && preview.includes('samedi 13 juin 2026'));
});

test('aperçu = email envoyé (SMTP) ; l’email de test a le même HTML, objet préfixé « [Test] »', async () => {
  Object.assign(ENV, { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.pola.fr' });
  const built = buildKioskEmail(INPUT);
  const preview = await brandEmailHtml(built.html);
  assert.equal(await sendLikeKiosk('invite@exemple.fr', []), '<m@smtp>');
  // Email de test (kiosk-email-preview, action 'test').
  await sendHtmlEmail({ to: 'admin@exemple.fr', subject: testSubject(built.subject), html: built.html, sender: built.sender });
  assert.equal(smtpSent.length, 2);
  assert.equal(smtpSent[0].html, preview);
  assert.equal(smtpSent[1].html, preview);
  assert.equal(smtpSent[1].subject, `[Test] ${built.subject}`);
  assert.deepEqual(smtpSent[1].to, [{ address: 'admin@exemple.fr' }]);
});

test('D14 : sans clé Brevo, l’email part par SMTP et il est compté', async () => {
  delete ENV.BREVO_API_KEY;
  ENV.SMTP_HOST = 'smtp.pola.fr';
  const rows: unknown[] = [];
  assert.equal(await sendLikeKiosk('invite@exemple.fr', rows), '<m@smtp>');
  assert.equal(smtpSent.length, 1);
  assert.equal(brevoBodies.length, 0);
  assert.equal(rows.length, 1);
});

test('D14 : aucun fournisseur → rien ne part, rien n’est compté (réponse « simulé »)', async () => {
  delete ENV.BREVO_API_KEY;
  const rows: unknown[] = [];
  assert.equal(await sendLikeKiosk('invite@exemple.fr', rows), null);
  assert.equal(smtpSent.length + brevoBodies.length + rows.length, 0);
});

test('D14 : send-kiosk-photo ne lit plus BREVO_API_KEY (choix du fournisseur dans _shared/email.ts)', () => {
  const src = readFileSync(new URL('../send-kiosk-photo/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /BREVO_API_KEY|serviceSecret/);
  assert.match(src, /sendHtmlEmail\(\{ to, subject, html, sender \}\)/);
  const preview = readFileSync(new URL('../kiosk-email-preview/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(preview, /BREVO_API_KEY|serviceSecret/);
  assert.match(preview, /html: await brandEmailHtml\(html\)/);
});
