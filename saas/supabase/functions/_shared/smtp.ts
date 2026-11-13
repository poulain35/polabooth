// Envoi SMTP des emails (open core étape 2, lot S2), utilisé par _shared/email.ts quand le
// fournisseur est « smtp » (_shared/email-provider.ts).
// Le message est construit depuis le payload au format Brevo que prépare email.ts (marque, pièces
// jointes en base64 et garde-fou déjà appliqués) : un seul chemin pour les deux fournisseurs.
// Supabase bloque les ports sortants 25 et 587 : port 465 (TLS direct) par défaut.
// Bibliothèque : nodemailer (prise en charge officielle de Deno 2), importée seulement au premier
// envoi réel. Le transport est injectable (setSmtpTransportFactory) : testé sous `node --test`.

import { denoEnv, type EnvGet } from './secrets.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS dès la connexion (465) ; sinon STARTTLS si le serveur le propose. */
  secure: boolean;
  user: string | null;
  password: string | null;
}

export interface SmtpAddress { name?: string; address: string }

export type SmtpAttachment =
  | { filename: string; content: string; encoding: 'base64' }
  | { filename?: string; href: string };

/** Message au format nodemailer (sous-ensemble utilisé). */
export interface SmtpMessage {
  from: SmtpAddress;
  to: SmtpAddress[];
  cc?: SmtpAddress[];
  bcc?: SmtpAddress[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
  attachments?: SmtpAttachment[];
}

export interface SmtpTransport {
  sendMail(message: SmtpMessage): Promise<{ messageId?: string | null }>;
}

/** `name` : nom annoncé au serveur (EHLO), le domaine de l'expéditeur. */
export type SmtpTransportFactory = (config: SmtpConfig, name: string | undefined) => SmtpTransport | Promise<SmtpTransport>;

export const DEFAULT_SMTP_PORT = 465;

const text = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** Configuration depuis SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASSWORD ; null sans SMTP_HOST. */
export function smtpConfigFromEnv(env: EnvGet = denoEnv): SmtpConfig | null {
  const host = text(env('SMTP_HOST'));
  if (!host) return null;
  const raw = text(env('SMTP_PORT'));
  const parsed = raw ? Number(raw) : DEFAULT_SMTP_PORT;
  const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_SMTP_PORT;
  // Le mot de passe n'est pas « trimé » : il est transmis tel quel.
  const password = env('SMTP_PASSWORD');
  return { host, port, secure: port === 465, user: text(env('SMTP_USER')), password: password ? password : null };
}

interface BrevoRecipient { email: string; name?: string }

const addresses = (list: unknown): SmtpAddress[] | undefined => {
  if (!Array.isArray(list) || !list.length) return undefined;
  return (list as BrevoRecipient[]).map((r) => (r.name ? { name: r.name, address: r.email } : { address: r.email }));
};

/**
 * Payload Brevo (/v3/smtp/email, HTML seulement) → message SMTP. Les pièces jointes produites par
 * inlineAttachments ({ content base64, name }) deviennent des pièces jointes nodemailer.
 * Un payload de modèle Brevo (templateId, sans htmlContent) n'a pas d'équivalent : erreur.
 */
export function smtpMessageFromPayload(payload: Record<string, unknown>): SmtpMessage {
  if (typeof payload.htmlContent !== 'string') {
    throw new Error('Email sans contenu HTML : les modèles Brevo ne peuvent pas partir en SMTP');
  }
  const sender = payload.sender as BrevoRecipient | undefined;
  if (!sender?.email) throw new Error('Expéditeur absent (FROM_EMAIL ou expéditeur de l\'organisation)');
  const to = addresses(payload.to);
  if (!to) throw new Error('Aucun destinataire');

  const message: SmtpMessage = {
    from: sender.name ? { name: sender.name, address: sender.email } : { address: sender.email },
    to,
    subject: String(payload.subject ?? ''),
    html: payload.htmlContent,
  };
  const cc = addresses(payload.cc);
  if (cc) message.cc = cc;
  const bcc = addresses(payload.bcc);
  if (bcc) message.bcc = bcc;
  const headers = payload.headers as Record<string, string> | undefined;
  if (headers && Object.keys(headers).length) message.headers = { ...headers };
  if (Array.isArray(payload.attachment) && payload.attachment.length) {
    message.attachments = (payload.attachment as Array<{ content?: string; url?: string; name?: string }>).map((a) =>
      typeof a.content === 'string'
        ? { filename: a.name ?? 'piece-jointe', content: a.content, encoding: 'base64' as const }
        : { ...(a.name ? { filename: a.name } : {}), href: String(a.url) });
  }
  return message;
}

/** Échec d'un envoi SMTP, en clair pour email_logs.error_reason (jamais le mot de passe). */
export interface SmtpFailure { status: number; detail: string }

export function describeSmtpError(e: unknown): SmtpFailure {
  const err = (e ?? {}) as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
  const status = typeof err.responseCode === 'number' ? err.responseCode : 0;
  const code = typeof err.code === 'string' ? err.code : '';
  const reason = typeof err.response === 'string' && err.response
    ? err.response
    : typeof err.message === 'string' && err.message ? err.message : String(e);
  return { status, detail: code ? `${code} : ${reason}` : reason };
}

// Délais courts : une fonction Supabase est coupée bien avant les délais par défaut de nodemailer
// (2 min de connexion), l'erreur doit remonter à temps pour être journalisée.
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

const nodemailerTransport: SmtpTransportFactory = async (config, name) => {
  const { default: nodemailer } = await import('npm:nodemailer@10.5.0');
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
    ...(name ? { name } : {}),
    ...TIMEOUTS,
  }) as unknown as SmtpTransport;
};

let transportFactory: SmtpTransportFactory = nodemailerTransport;

/** Remplace le transport (tests) ; null rétablit nodemailer. */
export function setSmtpTransportFactory(factory: SmtpTransportFactory | null): void {
  transportFactory = factory ?? nodemailerTransport;
}

/** Envoie le message ; retourne le Message-ID. Lève l'erreur du transport telle quelle. */
export async function sendSmtp(config: SmtpConfig, message: SmtpMessage): Promise<string | null> {
  const domain = message.from.address.split('@')[1]?.trim() || undefined;
  const transport = await transportFactory(config, domain);
  const info = await transport.sendMail(message);
  return info?.messageId ?? null;
}
