// Email de test (mise en route, LAB-345) : vérifie que les emails partent vraiment, par le même chemin
// que les vrais envois (sendHtmlEmail de _shared/email.ts : marque, garde-fou, Brevo ou SMTP).
// Destinataire = l'email du compte connecté, jamais un paramètre : la fonction ne sert pas de relais.
// Logique pure (envoi injecté) : testée par logic.test.ts sous `node --test`.
// Les messages ne citent que des noms de variables, jamais une valeur.

import type { EmailProvider } from '../_shared/email-provider.ts';
import { applyEmailGuard, type EmailGuardConfig } from '../_shared/email-guard.ts';
import { detailsTable, escapeHtml, layout, mutedNote } from '../_shared/email-layout.ts';

export interface Sender { email: string; name: string }

export interface TestEmailContext {
  /** Email du compte connecté (null : compte sans adresse). */
  to: string | null | undefined;
  provider: EmailProvider;
  /** Clé Brevo présente (Services connectés ou BREVO_API_KEY). */
  hasBrevoKey: boolean;
  /** SMTP_HOST défini. */
  hasSmtpHost: boolean;
  /** Expéditeur de l'organisation (orgSender), FROM_EMAIL à défaut. */
  sender: Sender;
  guard: EmailGuardConfig;
}

export interface TestEmailMessage { to: string; subject: string; html: string; sender: Sender }
export type SendHtml = (message: TestEmailMessage) => Promise<string | null>;

export interface TestEmailResult {
  ok: boolean;
  provider: EmailProvider;
  /** Adresse qui reçoit l'email (celle du compte, ou EMAIL_REDIRECT_TO sur une instance de test). */
  to: string | null;
  message: string;
  /** Piste de correction après un refus du service d'envoi. */
  hint?: string;
}

export const MAX_MESSAGE_LENGTH = 300;
export const TEST_SUBJECT = 'Email de test : l\'envoi des emails fonctionne';

export const MESSAGES = {
  noAccountEmail: 'Votre compte n\'a pas d\'adresse email : impossible d\'envoyer l\'email de test.',
  noBrevoKey: 'Aucun service d\'envoi n\'est configuré : saisissez votre clé Brevo dans Services connectés, '
    + 'ou faites régler un serveur SMTP à l\'installation.',
  noSmtpHost: 'L\'envoi par serveur SMTP est choisi, mais aucun serveur n\'est réglé (SMTP_HOST manquant '
    + 'dans les réglages d\'installation).',
  noSender: 'Aucune adresse d\'expédition : renseignez « Adresse de l\'expéditeur » dans Réglages › Entreprise '
    + '(ou FROM_EMAIL dans les réglages d\'installation).',
  notAllowed: (to: string) => `Email non envoyé : ${to} ne fait pas partie des destinataires autorisés de cette `
    + 'instance de test (EMAIL_ALLOWLIST).',
  notSent: 'Email non envoyé : le service d\'envoi n\'a rien confirmé. Vérifiez les réglages, puis réessayez.',
  sent: (to: string) => `Email envoyé à ${to}. Regardez aussi dans les indésirables.`,
  redirected: (to: string, account: string) => `Email envoyé à ${to} au lieu de ${account} (redirection de `
    + 'l\'instance de test, EMAIL_REDIRECT_TO). Regardez aussi dans les indésirables.',
} as const;

const PROVIDER_LABELS: Record<EmailProvider, string> = { brevo: 'Brevo', smtp: 'votre serveur SMTP' };

const clip = (text: string) => (text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text);

/** Contenu de l'email de test (gabarit des emails internes, marque appliquée à l'envoi). */
export function renderTestEmail(p: { provider: EmailProvider; sender: Sender; to: string }): { subject: string; html: string } {
  const from = p.sender.name ? `${p.sender.name} <${p.sender.email}>` : p.sender.email;
  const html = layout('L\'envoi des emails fonctionne', `
    <p>Cet email a été envoyé depuis l'administration pour vérifier l'envoi des emails. Vos clients reçoivent les leurs par le même chemin.</p>
    ${detailsTable([
      ['Envoyé par', escapeHtml(PROVIDER_LABELS[p.provider])],
      ['Expéditeur', escapeHtml(from)],
      ['Destinataire', escapeHtml(p.to)],
    ])}
    ${mutedNote('Rien à faire de plus. S\'il est arrivé dans les indésirables, marquez-le comme « non indésirable ».', '24px 0 0')}`,
  { audience: 'admin' });
  return { subject: TEST_SUBJECT, html };
}

/** Piste de correction d'un refus (EmailSendError : `status` = code SMTP ou HTTP Brevo, 0 sans réponse). */
export function refusalHint(provider: EmailProvider, status: number): string {
  if (provider === 'smtp') {
    if (status === 535 || status === 534 || status === 530) {
      return 'Le serveur SMTP refuse l\'identifiant ou le mot de passe (SMTP_USER, SMTP_PASSWORD).';
    }
    if (status === 0) {
      return 'Le serveur SMTP ne répond pas : vérifiez son adresse et son port (SMTP_HOST, SMTP_PORT, 465 conseillé).';
    }
    if (status === 550 || status === 553 || status === 554) {
      return 'Le serveur SMTP refuse l\'adresse d\'expédition : elle doit appartenir au compte SMTP utilisé.';
    }
    return 'Le serveur SMTP a refusé l\'email : transmettez le détail à votre hébergeur.';
  }
  if (status === 401 || status === 403) {
    return 'Brevo refuse la clé : vérifiez-la dans Services connectés, ou les adresses IP autorisées dans Brevo.';
  }
  if (status === 400) {
    return 'Brevo refuse l\'email : l\'adresse d\'expédition doit être validée dans Brevo (Expéditeurs et domaines).';
  }
  return 'Brevo a refusé l\'email : réessayez plus tard, ou transmettez le détail à votre hébergeur.';
}

/** Message d'un refus : « Envoi refusé : SMTP 535 : … », 300 caractères au plus. */
function refusalMessage(detail: string): string {
  return clip(`Envoi refusé : ${detail}`);
}

/** Raison pour laquelle rien ne peut partir, ou null si l'envoi peut être tenté. */
function setupProblem(ctx: TestEmailContext): string | null {
  if (!ctx.to?.trim()) return MESSAGES.noAccountEmail;
  if (ctx.provider === 'brevo' && !ctx.hasBrevoKey) return MESSAGES.noBrevoKey;
  if (ctx.provider === 'smtp' && !ctx.hasSmtpHost) return MESSAGES.noSmtpHost;
  if (!ctx.sender.email?.trim()) return MESSAGES.noSender;
  return null;
}

const isSendError = (e: unknown): e is Error & { status: number } =>
  e instanceof Error && e.name === 'EmailSendError' && typeof (e as { status?: unknown }).status === 'number';

/** Vérifie les réglages, envoie l'email de test et décrit le résultat. Ne lève pas. */
export async function sendTestEmail(ctx: TestEmailContext, send: SendHtml): Promise<TestEmailResult> {
  const { provider } = ctx;
  const problem = setupProblem(ctx);
  if (problem) return { ok: false, provider, to: ctx.to?.trim() || null, message: problem };
  const account = ctx.to!.trim();

  // Même garde-fou que l'envoi (email-guard.ts) : on sait d'avance si l'adresse est bloquée ou redirigée.
  const guarded = await applyEmailGuard({ to: [{ email: account }] }, ctx.guard);
  if (guarded.action === 'block') return { ok: false, provider, to: account, message: MESSAGES.notAllowed(account) };
  const recipient = ((guarded.payload.to as Array<{ email: string }> | undefined)?.[0]?.email) ?? account;

  const { subject, html } = renderTestEmail({ provider, sender: ctx.sender, to: account });
  let messageId: string | null;
  try {
    messageId = await send({ to: account, subject, html, sender: ctx.sender });
  } catch (e) {
    if (isSendError(e)) {
      return { ok: false, provider, to: recipient, message: refusalMessage(e.message), hint: refusalHint(provider, e.status) };
    }
    const detail = e instanceof Error && e.message ? e.message : String(e);
    return { ok: false, provider, to: recipient, message: clip(`Envoi impossible : ${detail}`) };
  }
  if (!messageId) return { ok: false, provider, to: recipient, message: MESSAGES.notSent };
  const redirected = recipient.toLowerCase() !== account.toLowerCase();
  return {
    ok: true,
    provider,
    to: recipient,
    message: redirected ? MESSAGES.redirected(recipient, account) : MESSAGES.sent(recipient),
  };
}
