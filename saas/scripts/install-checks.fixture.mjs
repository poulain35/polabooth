// Faux serveur SMTP (socket simulé) des tests de l'installation (LAB-376), partagé par
// install-checks-smtp.test.mjs et install-instance-checks.test.mjs (LAB-403). Aucun réseau.
import { EventEmitter } from 'node:events';

export const PASSWORD = 'mot-de-passe-smtp-42';
export const SECRET_KEY = 'cle-secrete-stockage-42';

export function fakeSmtp({ password = PASSWORD, auth = 'PLAIN LOGIN', fromAllowed = true, silent = false, connectError = null } = {}) {
  const log = [];
  const messages = [];
  const connect = async ({ host, port, secure }) => {
    log.push(`connect ${host}:${port}${secure ? ' tls' : ''}`);
    if (connectError) throw Object.assign(new Error(connectError), { code: connectError });
    const sock = new EventEmitter();
    let buf = '';
    let dataMode = false;
    let login = 0;
    const send = (s) => setImmediate(() => sock.emit('data', Buffer.from(s)));
    const handle = (line) => {
      log.push(line.startsWith('AUTH PLAIN ') ? 'AUTH PLAIN …' : login ? '…' : line);
      if (login === 1) { login = 2; return send('334 UGFzc3dvcmQ6\r\n'); }
      if (login === 2) {
        login = 0;
        return send(Buffer.from(line, 'base64').toString() === password ? '235 2.7.0 ok\r\n' : '535 5.7.8 Authentication failed\r\n');
      }
      if (line.startsWith('EHLO ')) return send(`250-smtp.exemple.fr\r\n${auth ? `250-AUTH ${auth}\r\n` : ''}250 SIZE 1000\r\n`);
      if (line.startsWith('AUTH PLAIN ')) {
        const [, , pass] = Buffer.from(line.slice(11), 'base64').toString().split('\0');
        return send(pass === password ? '235 2.7.0 ok\r\n' : '535 5.7.8 Authentication failed\r\n');
      }
      if (line === 'AUTH LOGIN') { login = 1; return send('334 VXNlcm5hbWU6\r\n'); }
      if (line.startsWith('MAIL FROM:')) return send(fromAllowed ? '250 ok\r\n' : '553 5.7.1 Sender address rejected: not owned by user\r\n');
      if (line.startsWith('RCPT TO:')) return send('250 ok\r\n');
      if (line === 'DATA') { dataMode = true; return send('354 go\r\n'); }
      if (line === 'QUIT') return send('221 bye\r\n');
      return send('500 unknown\r\n');
    };
    sock.write = (chunk) => {
      buf += chunk;
      for (;;) {
        if (dataMode) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push(buf.slice(0, end + 2));
          buf = buf.slice(end + 5);
          dataMode = false;
          send('250 2.0.0 queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        handle(line);
      }
    };
    sock.destroy = () => { sock.destroyed = true; };
    if (!silent) send('220 smtp.exemple.fr ESMTP\r\n');
    return sock;
  };
  return { connect, log, messages };
}

export const smtpConfig = { smtpHost: 'smtp.exemple.fr', smtpPort: '465', smtpUser: 'contact@exemple.fr', smtpPassword: PASSWORD, fromEmail: 'contact@exemple.fr', fromName: 'Société Équipée', adminEmail: 'admin@exemple.fr' };
