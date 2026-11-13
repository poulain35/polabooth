// Tests du garde-fou emails hors production (LAB-80) : logique pure + câblage dans postBrevo (fetch intercepté).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEmailGuard, isAllowedRecipient, parseEmailGuardConfig, renderTemplateSubject, subjectTag,
  type EmailGuardConfig,
} from './email-guard.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];
const html = (to: string, extra: Record<string, unknown> = {}) => ({
  sender: { email: 'noreply@exemple.fr', name: 'Studio Exemple' },
  to: [{ email: to }],
  subject: 'Votre devis',
  htmlContent: '<p>x</p>',
  ...extra,
});
const tpl = (to: string) => ({
  sender: { email: 'noreply@exemple.fr', name: 'Studio Exemple' },
  to: [{ email: to }],
  templateId: 12,
  params: { CLIENT_NAME: 'Léa' },
});
const send = (r: Awaited<ReturnType<typeof applyEmailGuard>>) => {
  assert.equal(r.action, 'send');
  return (r as { payload: Record<string, unknown> }).payload;
};

test('aucune variable : config vide, payload strictement inchangé (même objet)', async () => {
  const config = parseEmailGuardConfig(env({}));
  assert.deepEqual(config, {});
  const payload = html('client@x.fr');
  assert.equal(send(await applyEmailGuard(payload, config)), payload);
  const t = tpl('client@x.fr');
  assert.equal(send(await applyEmailGuard(t, config, async () => { throw new Error('jamais appelé'); })), t);
});

test('parseEmailGuardConfig : découpe, minuscules, espaces et @ initial tolérés', () => {
  assert.deepEqual(
    parseEmailGuardConfig(env({ EMAIL_SUBJECT_PREFIX: '[TEST] ', EMAIL_ALLOWLIST: ' Moi@Gmail.com, @exemple.fr,,', EMAIL_REDIRECT_TO: ' Moi@Gmail.com ' })),
    { subjectPrefix: '[TEST] ', allowlist: ['moi@gmail.com', 'exemple.fr'], redirectTo: 'moi@gmail.com' },
  );
  assert.deepEqual(parseEmailGuardConfig(env({ EMAIL_ALLOWLIST: ' , ' })), {});
});

test('préfixe seul : objet HTML préfixé, destinataire inchangé', async () => {
  const p = send(await applyEmailGuard(html('client@x.fr'), { subjectPrefix: '[TEST] ' }));
  assert.equal(p.subject, '[TEST] Votre devis');
  assert.deepEqual(p.to, [{ email: 'client@x.fr' }]);
  assert.equal(p.htmlContent, '<p>x</p>');
});

test('préfixe sur template Brevo : objet du template rendu puis passé en surcharge subject', async () => {
  const calls: number[] = [];
  const resolver = async (id: number, params: Record<string, unknown>) => {
    calls.push(id);
    return renderTemplateSubject('Bonjour {{ params.CLIENT_NAME }}, votre devis', params);
  };
  const p = send(await applyEmailGuard(tpl('client@x.fr'), { subjectPrefix: '[TEST] ' }, resolver));
  assert.deepEqual(calls, [12]);
  assert.equal(p.subject, '[TEST] Bonjour Léa, votre devis');
  assert.equal(p.templateId, 12);
  assert.deepEqual(p.params, { CLIENT_NAME: 'Léa' });
});

test('template dont l\'objet est indisponible : objet de repli explicite', async () => {
  const p = send(await applyEmailGuard(tpl('a@x.fr'), { subjectPrefix: '[TEST] ' }, async () => null));
  assert.equal(p.subject, '[TEST] Template Brevo n°12');
});

test('renderTemplateSubject : params substitués, filtres ignorés, absents vidés', () => {
  assert.equal(renderTemplateSubject('{{params.A}} / {{ params.B | default: "x" }} / {{ params.C }}', { A: 'a', B: 'b' }), 'a / b / ');
});

test('isAllowedRecipient : adresse exacte, domaine, alias +tag, casse', () => {
  const list = ['moi@gmail.com', 'exemple.fr'];
  assert.equal(isAllowedRecipient('moi@gmail.com', list), true);
  assert.equal(isAllowedRecipient('MOI@Gmail.COM', list), true);
  assert.equal(isAllowedRecipient('moi+devis@gmail.com', list), true);
  assert.equal(isAllowedRecipient('contact@exemple.fr', list), true);
  assert.equal(isAllowedRecipient('Contact+x@Exemple.fr', list), true);
  assert.equal(isAllowedRecipient('autre@gmail.com', list), false);
  assert.equal(isAllowedRecipient('moi@gmail.com.evil.fr', list), false);
  assert.equal(isAllowedRecipient('x@sub.exemple.fr', list), false);
  assert.equal(isAllowedRecipient('moitoi@gmail.com', list), false);
});

test('allowlist sans redirection : destinataire autorisé envoyé, objet inchangé', async () => {
  const config: EmailGuardConfig = { allowlist: ['moi@gmail.com'] };
  const p = send(await applyEmailGuard(html('moi+test@gmail.com'), config));
  assert.equal(p.subject, 'Votre devis');
  assert.deepEqual(p.to, [{ email: 'moi+test@gmail.com' }]);
});

test('allowlist sans redirection : hors liste (to, cc ou bcc) → email bloqué', async () => {
  const config: EmailGuardConfig = { subjectPrefix: '[TEST] ', allowlist: ['moi@gmail.com'] };
  assert.deepEqual(await applyEmailGuard(html('client@x.fr'), config), { action: 'block', blocked: ['client@x.fr'] });
  assert.deepEqual(
    await applyEmailGuard(html('moi@gmail.com', { bcc: [{ email: 'compta@y.fr' }] }), config),
    { action: 'block', blocked: ['compta@y.fr'] },
  );
});

test('redirection : hors liste remplacé, destinataire d\'origine dans l\'objet', async () => {
  const config: EmailGuardConfig = { subjectPrefix: '[TEST] ', allowlist: ['exemple.fr'], redirectTo: 'moi@gmail.com' };
  const p = send(await applyEmailGuard(html('client@x.fr', { to: [{ email: 'client@x.fr', name: 'Client' }] }), config));
  assert.deepEqual(p.to, [{ email: 'moi@gmail.com' }]);
  assert.equal(p.subject, '[TEST → client@x.fr] Votre devis');
});

test('redirection : to/cc/bcc, autorisés conservés, doublons fusionnés', async () => {
  const config: EmailGuardConfig = { allowlist: ['exemple.fr'], redirectTo: 'moi@gmail.com' };
  const p = send(await applyEmailGuard(html('a@x.fr', {
    to: [{ email: 'a@x.fr' }, { email: 'contact@exemple.fr' }],
    cc: [{ email: 'b@y.fr' }],
    bcc: [{ email: 'a@x.fr' }],
  }), config));
  assert.deepEqual(p.to, [{ email: 'moi@gmail.com' }, { email: 'contact@exemple.fr' }]);
  assert.equal('cc' in p, false);
  assert.equal('bcc' in p, false);
  assert.equal(p.subject, '[→ a@x.fr, b@y.fr] Votre devis');
});

test('redirection sans allowlist : tout est redirigé sauf l\'adresse de redirection elle-même', async () => {
  const config: EmailGuardConfig = { redirectTo: 'moi@gmail.com' };
  const p = send(await applyEmailGuard(html('client@x.fr'), config));
  assert.deepEqual(p.to, [{ email: 'moi@gmail.com' }]);
  const self = send(await applyEmailGuard(html('Moi@gmail.com'), config));
  assert.deepEqual(self.to, [{ email: 'Moi@gmail.com' }]);
  assert.equal(self.subject, 'Votre devis');
});

test('redirection d\'un template : objet du template avec destinataire d\'origine', async () => {
  const config: EmailGuardConfig = { subjectPrefix: '[TEST] ', allowlist: ['moi@gmail.com'], redirectTo: 'moi@gmail.com' };
  const p = send(await applyEmailGuard(tpl('client@x.fr'), config, async () => 'Relance devis'));
  assert.equal(p.subject, '[TEST → client@x.fr] Relance devis');
  assert.deepEqual(p.to, [{ email: 'moi@gmail.com' }]);
});

test('subjectTag : préfixe non crocheté conservé devant l\'origine', () => {
  assert.equal(subjectTag('DEV - ', ['a@x.fr']), 'DEV - [→ a@x.fr] ');
  assert.equal(subjectTag('DEV - ', []), 'DEV - ');
  assert.equal(subjectTag(undefined, []), '');
});

// ── Câblage dans _shared/email.ts (postBrevo) ────────────────────────────────

const ENV: Record<string, string> = {
  BREVO_API_KEY: 'brevo-factice',
  EMAIL_SUBJECT_PREFIX: '[TEST] ',
  EMAIL_ALLOWLIST: 'moi@gmail.com',
};
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
const { sendBookingEmail, sendHtmlEmail } = await import('./email.ts');

let posted: Array<Record<string, unknown>> = [];
let templateGets: string[] = [];
beforeEach(() => {
  posted = [];
  templateGets = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith('https://api.brevo.com/v3/smtp/templates/')) {
      templateGets.push(String(url));
      return new Response(JSON.stringify({ subject: 'Devis pour {{ params.CLIENT_NAME }}' }), { status: 200 });
    }
    assert.equal(String(url), 'https://api.brevo.com/v3/smtp/email');
    posted.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ messageId: '<m@brevo>' }), { status: 201 });
  }) as typeof fetch;
});

test('postBrevo : email HTML autorisé envoyé avec objet préfixé', async () => {
  const id = await sendHtmlEmail({ to: 'moi+kiosk@gmail.com', subject: 'Vos photos', html: '<p>x</p>' });
  assert.equal(id, '<m@brevo>');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].subject, '[TEST] Vos photos');
});

test('postBrevo : template autorisé → objet du template récupéré une fois puis surchargé', async () => {
  const rendered = { subject: 'ignoré', html: '', params: { CLIENT_NAME: 'Léa' } };
  await sendBookingEmail({ to: 'moi@gmail.com', rendered, templateId: 7 });
  await sendBookingEmail({ to: 'moi@gmail.com', rendered, templateId: 7 });
  assert.deepEqual(templateGets, ['https://api.brevo.com/v3/smtp/templates/7']);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].subject, '[TEST] Devis pour Léa');
  assert.equal(posted[0].templateId, 7);
});

test('postBrevo : hors liste sans redirection → rien n\'est envoyé, retour null comme sans clé', async () => {
  const id = await sendHtmlEmail({ to: 'client@x.fr', subject: 'Vos photos', html: '<p>x</p>' });
  assert.equal(id, null);
  assert.equal(posted.length, 0);
});
