// Vérifications de l'installation (LAB-376) : messagerie SMTP. Client minimal sur node:tls (la fonction
// Deno _shared/smtp.ts passe par nodemailer, indisponible ici sans npm) ; réseau injecté, testé par
// install-checks-smtp.test.mjs avec un faux serveur. Le mot de passe ne figure jamais dans les messages.
import { randomBytes } from 'node:crypto';
import { isIP, connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { CERT_CODES, CHECK_TIMEOUT_MS, clip, networkErrorCode, networkReason } from './install-checks-common.mjs';

// ── SMTP : fonctions pures ──────────────────────────────────────────────────────────────────

/**
 * Découpe les réponses SMTP complètes d'un tampon : `250-…` continue une réponse, `250 …` la termine.
 * Renvoie `{ replies: [{ code, lines, text }], rest }` (`rest` : début d'une réponse incomplète).
 */
export function parseSmtpReplies(buffer) {
  const replies = [];
  let pending = [];
  let consumed = 0;
  const re = /([^\r\n]*)\r?\n/g;
  let m;
  while ((m = re.exec(buffer))) {
    const line = m[1];
    const parts = line.match(/^(\d{3})([ -]?)(.*)$/);
    if (!parts) {
      replies.push({ code: 0, lines: [line], text: line });
      pending = [];
      consumed = re.lastIndex;
      continue;
    }
    pending.push(parts[3]);
    if (parts[2] !== '-') {
      replies.push({ code: Number(parts[1]), lines: pending, text: pending.join(' ').trim() });
      pending = [];
      consumed = re.lastIndex;
    }
  }
  return { replies, rest: buffer.slice(consumed) };
}

/** Mécanismes annoncés par EHLO (`AUTH PLAIN LOGIN` ou `AUTH=PLAIN LOGIN`), en majuscules. */
export function authMechanisms(ehloLines) {
  const out = new Set();
  for (const line of ehloLines) {
    const m = String(line).match(/^AUTH[ =](.*)$/i);
    if (m) m[1].split(/\s+/).filter(Boolean).forEach((x) => out.add(x.toUpperCase()));
  }
  return [...out];
}

export const pickAuthMechanism = (mechanisms) => ['PLAIN', 'LOGIN'].find((m) => mechanisms.includes(m)) ?? null;

export const hasExtension = (ehloLines, name) => ehloLines.some((l) => String(l).toUpperCase().split(/[ =]/)[0] === name);

/**
 * Mot d'en-tête (RFC 2047) : texte ASCII imprimable tel quel, sinon `=?UTF-8?B?…?=` découpé en mots
 * de 75 caractères au plus (sans couper un caractère), séparés par un repli de ligne.
 */
export function encodeHeaderWord(text) {
  const s = String(text);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** Adresse avec nom affiché : nom simple tel quel, nom avec signes entre guillemets, non ASCII encodé. */
export function formatAddress(name, email) {
  const n = String(name ?? '').trim();
  if (!n) return `<${email}>`;
  if (!/^[\x20-\x7e]*$/.test(n)) return `${encodeHeaderWord(n)} <${email}>`;
  if (/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(n)) return `${n} <${email}>`;
  return `"${n.replace(/(["\\])/g, '\\$1')}" <${email}>`;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date au format des emails (RFC 5322), en UTC : « Wed, 18 Nov 2026 10:00:00 +0000 ». */
export function rfc5322Date(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} `
    + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

export const TEST_EMAIL_SUBJECT = 'Polabooth : votre messagerie fonctionne';

/**
 * Email de test (lignes CRLF, corps texte UTF-8 en base64). Pas de point final de DATA :
 * `smtpData` s'en charge.
 */
export function buildTestEmail({ fromEmail, fromName, to, smtpHost, date, messageId }) {
  const body = [
    'Bonjour,',
    '',
    'Cet email de test vient du script d\'installation de Polabooth.',
    `Votre messagerie (${smtpHost}) fonctionne : votre SaaS pourra envoyer ses emails depuis ${fromEmail}.`,
    '',
    'Rien à faire : vous pouvez supprimer ce message.',
    '',
  ].join('\r\n');
  const encoded = Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
  return [
    `From: ${formatAddress(fromName, fromEmail)}`,
    `To: <${to}>`,
    `Subject: ${encodeHeaderWord(TEST_EMAIL_SUBJECT)}`,
    `Date: ${rfc5322Date(date)}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
    '',
  ].join('\r\n');
}

/** Contenu de DATA : points de tête doublés, terminé par `.` seul sur sa ligne. */
export function smtpData(message) {
  const text = message.endsWith('\r\n') ? message : `${message}\r\n`;
  return `${text.replace(/^\./gm, '..')}.\r\n`;
}

/** Échec SMTP : `stage` (connect, greeting, ehlo, starttls, auth, mail, rcpt, data, send), `code` système ou réponse. */
export class SmtpError extends Error {
  constructor(stage, { code = '', reply = null, cause = null, offered = [] } = {}) {
    super(reply ? `${stage} : ${reply.code} ${reply.text}` : `${stage} : ${code}`);
    this.stage = stage;
    this.code = code;
    this.reply = reply;
    this.cause = cause;
    this.offered = offered;
  }
}

/** Message et solution en français pour un échec SMTP (jamais le mot de passe). */
export function smtpFailure(err, { host, port, user, fromEmail, to }) {
  const where = `${host}:${port}`;
  const reply = err.reply;
  const said = reply ? ` (${reply.code} ${clip(reply.text)})` : '';
  const code = err.reply ? '' : networkErrorCode(err.cause ?? err) || err.code;
  const hostHint = 'Vérifiez SMTP_HOST (ex. smtp.ionos.fr, ssl0.ovh.net, smtp-relay.brevo.com) et SMTP_PORT (465, SSL/TLS).';

  if (err.stage === 'auth' && err.code === 'NO_AUTH') {
    return {
      message: `Le serveur ${where} ne propose ni AUTH PLAIN ni AUTH LOGIN${err.offered.length ? ` (proposées : ${err.offered.join(', ')})` : ''}.`,
      hint: 'Demandez à votre hébergeur email les réglages SMTP « SSL/TLS, port 465, avec mot de passe ».',
    };
  }
  if (err.stage === 'starttls' && err.code === 'NO_STARTTLS') {
    return {
      message: `Le serveur ${where} ne propose pas de connexion chiffrée (STARTTLS) sur ce port.`,
      hint: 'Utilisez le port 465 (SSL/TLS) : SMTP_PORT=465.',
    };
  }
  if (!reply) {
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return { message: `Serveur SMTP introuvable : « ${host} » n'existe pas.`, hint: hostHint };
    }
    if (code === 'ECONNREFUSED') return { message: `Connexion refusée par ${where}.`, hint: hostHint };
    if (code === 'ETIMEDOUT') {
      return {
        message: `Pas de réponse de ${where} en ${CHECK_TIMEOUT_MS / 1000} s.`,
        hint: `${hostHint} Un pare-feu (ou votre box) bloque peut-être ce port.`,
      };
    }
    if (CERT_CODES.has(code)) {
      return {
        message: `Certificat du serveur SMTP ${host} refusé (${code}).`,
        hint: 'SMTP_HOST doit être le nom exact du serveur, celui de son certificat (voir la documentation de votre hébergeur email).',
      };
    }
    if (code === 'ERR_SSL_WRONG_VERSION_NUMBER' || code === 'EPROTO') {
      return { message: `Le serveur ${where} ne répond pas en SSL/TLS.`, hint: 'Utilisez le port SSL/TLS de votre hébergeur : SMTP_PORT=465.' };
    }
    return {
      message: `Échange avec ${where} interrompu (${err.stage}) : ${networkReason(err.cause ?? err)}.`,
      hint: hostHint,
    };
  }
  if (reply.code >= 400 && reply.code < 500) {
    return { message: `Refus temporaire du serveur SMTP${said}.`, hint: 'Réessayez dans quelques minutes, puis relancez.' };
  }
  if (err.stage === 'auth') {
    if (reply.code === 534) {
      return {
        message: `Le serveur exige un mot de passe d'application${said}.`,
        hint: 'Gmail, Outlook… : créez un « mot de passe d\'application » dans votre compte et mettez-le dans SMTP_PASSWORD.',
      };
    }
    return {
      message: `Identifiants SMTP refusés pour ${user}${said}.`,
      hint: 'Vérifiez SMTP_USER (souvent l\'adresse email complète) et SMTP_PASSWORD (entre guillemets simples s\'il contient un espace, un # ou un $). Gmail, Outlook… : mot de passe d\'application.',
    };
  }
  if (err.stage === 'mail') {
    return {
      message: `Expéditeur refusé : FROM_EMAIL (${fromEmail}) n'est pas autorisé par ce compte SMTP${said}.`,
      hint: 'Mettez dans FROM_EMAIL l\'adresse du compte (souvent SMTP_USER) ou une adresse que votre hébergeur autorise.',
    };
  }
  if (err.stage === 'rcpt') {
    return { message: `Destinataire refusé : ADMIN_EMAIL (${to})${said}.`, hint: 'Vérifiez ADMIN_EMAIL.' };
  }
  if (err.stage === 'send' || err.stage === 'data') {
    return {
      message: `Email de test refusé par le serveur${said}.`,
      hint: 'Souvent un FROM_EMAIL non autorisé par le compte SMTP : utilisez l\'adresse du compte (SMTP_USER).',
    };
  }
  return { message: `Le serveur SMTP ${where} a refusé l'échange (${err.stage})${said}.`, hint: hostHint };
}

// ── SMTP : échange (réseau injecté) ─────────────────────────────────────────────────────────

function timeoutError() {
  return Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' });
}

/** Connexion TLS directe (port 465). Renvoie le socket une fois la poignée de main faite. */
export function defaultSmtpConnect({ host, port, secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, ...(isIP(host) ? {} : { servername: host }) })
      : netConnect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(timeoutError()); }, timeoutMs);
    const onError = (e) => { clearTimeout(timer); reject(e); };
    socket.once('error', onError);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

/** Passage en TLS d'une connexion en clair après STARTTLS. */
export function defaultSmtpStartTls(socket, { host, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, ...(isIP(host) ? {} : { servername: host }) });
    const timer = setTimeout(() => { secure.destroy(); reject(timeoutError()); }, timeoutMs);
    const onError = (e) => { clearTimeout(timer); reject(e); };
    secure.once('error', onError);
    secure.once('secureConnect', () => {
      clearTimeout(timer);
      secure.off('error', onError);
      resolve(secure);
    });
  });
}

function conversation(socket, timeoutMs) {
  let buffer = '';
  const replies = [];
  let failure = null;
  let wake = null;
  const onData = (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const parsed = parseSmtpReplies(buffer);
    buffer = parsed.rest;
    replies.push(...parsed.replies);
    wake?.();
  };
  const onError = (e) => { failure ??= e; wake?.(); };
  const onClose = () => { failure ??= Object.assign(new Error('connexion fermée'), { code: 'ECONNCLOSED' }); wake?.(); };
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  const read = (stage) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { wake = null; reject(new SmtpError(stage, { code: 'ETIMEDOUT' })); }, timeoutMs);
    const check = () => {
      if (replies.length) {
        clearTimeout(timer);
        wake = null;
        resolve(replies.shift());
      } else if (failure) {
        clearTimeout(timer);
        wake = null;
        reject(new SmtpError(stage, { code: networkErrorCode(failure) || 'ECONNRESET', cause: failure }));
      }
    };
    wake = check;
    check();
  });

  return {
    async command(stage, line, expected) {
      if (line !== null) socket.write(`${line}\r\n`);
      const reply = await read(stage);
      if (!expected.includes(reply.code)) throw new SmtpError(stage, { code: 'REPLY', reply });
      return reply;
    },
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

/**
 * Vérifie la messagerie : connexion (TLS direct sur 465, STARTTLS sinon), EHLO, authentification
 * (PLAIN ou LOGIN selon l'annonce du serveur), puis, si `sendEmail`, envoi de l'email de test à
 * `config.adminEmail`. Renvoie `{ mechanism, sent }` ; lève SmtpError.
 */
export async function smtpCheck(config, {
  connect = defaultSmtpConnect, startTls = defaultSmtpStartTls, sendEmail = true,
  timeoutMs = CHECK_TIMEOUT_MS, now = new Date(), randomId = () => randomBytes(8).toString('hex'),
} = {}) {
  const host = config.smtpHost;
  const port = Number(config.smtpPort);
  const secure = port === 465;
  const domain = config.fromEmail.split('@')[1] || 'localhost';
  let socket;
  let conv;
  try {
    try {
      socket = await connect({ host, port, secure, timeoutMs });
    } catch (e) {
      throw new SmtpError('connect', { code: networkErrorCode(e), cause: e });
    }
    conv = conversation(socket, timeoutMs);
    await conv.command('greeting', null, [220]);
    let ehlo = await conv.command('ehlo', `EHLO ${domain}`, [250]);
    if (!secure) {
      if (!hasExtension(ehlo.lines, 'STARTTLS')) throw new SmtpError('starttls', { code: 'NO_STARTTLS' });
      await conv.command('starttls', 'STARTTLS', [220]);
      conv.detach();
      try {
        socket = await startTls(socket, { host, timeoutMs });
      } catch (e) {
        throw new SmtpError('starttls', { code: networkErrorCode(e), cause: e });
      }
      conv = conversation(socket, timeoutMs);
      ehlo = await conv.command('ehlo', `EHLO ${domain}`, [250]);
    }
    const offered = authMechanisms(ehlo.lines);
    const mechanism = pickAuthMechanism(offered);
    if (!mechanism) throw new SmtpError('auth', { code: 'NO_AUTH', offered });
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    if (mechanism === 'PLAIN') {
      await conv.command('auth', `AUTH PLAIN ${b64(`\0${config.smtpUser}\0${config.smtpPassword}`)}`, [235]);
    } else {
      await conv.command('auth', 'AUTH LOGIN', [334]);
      await conv.command('auth', b64(config.smtpUser), [334]);
      await conv.command('auth', b64(config.smtpPassword), [235]);
    }
    if (!sendEmail) {
      await conv.command('quit', 'QUIT', [221]).catch(() => {});
      return { mechanism, sent: false };
    }
    await conv.command('mail', `MAIL FROM:<${config.fromEmail}>`, [250]);
    await conv.command('rcpt', `RCPT TO:<${config.adminEmail}>`, [250, 251]);
    await conv.command('data', 'DATA', [354]);
    const message = buildTestEmail({
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      to: config.adminEmail,
      smtpHost: host,
      date: now,
      messageId: `polabooth-verification-${randomId()}@${domain}`,
    });
    socket.write(smtpData(message));
    await conv.command('send', null, [250]);
    await conv.command('quit', 'QUIT', [221]).catch(() => {});
    return { mechanism, sent: true };
  } finally {
    conv?.detach();
    socket?.destroy?.();
  }
}
