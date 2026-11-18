// Vérifications d'une instance avant l'installation (LAB-376) : messagerie SMTP, stockage S3, CORS.
// Les pannes les plus probables d'une installation (identifiants SMTP, lecture publique du bucket, CORS)
// ne se voyaient qu'après coup : elles sont détectées ici, avant toute modification, avec la solution.
// Sans dépendance : client SMTP minimal sur node:tls (la fonction Deno _shared/smtp.ts passe par
// nodemailer, indisponible ici sans npm) et signature AWS SigV4 sur node:crypto.
// Découpé en modules (LAB-403) : install-checks-common.mjs (classement, secrets, erreurs réseau),
// install-checks-smtp.mjs (messagerie), install-checks-storage.mjs (S3 et CORS, fonctions pures).
// Ici : vérification d’un bucket et phase complète. Réseau injecté : testé par install-instance-checks.test.mjs.
// Aucun secret dans les messages : mot de passe SMTP, clé secrète et signature n'y figurent jamais.
import { CHECK_TIMEOUT_MS, networkReason, redactItem } from './install-checks-common.mjs';
import { smtpCheck, SmtpError, smtpFailure } from './install-checks-smtp.mjs';
import {
  allowsOrigin, analyzePreflight, contentMd5, CORS_PREFLIGHT, corsDenied, corsManualHint, corsRuleJson, corsXml,
  existingCorsRules, isR2, parseS3Error, publicObjectUrl, publicReadFailure, s3Failure, s3Settings, s3Url, sha256Hex,
  signS3Request, storageBuckets, testObjectKey,
} from './install-checks-storage.mjs';

export { CHECK_SYMBOLS, checksSummaryLine, checksVerdict } from './install-checks-common.mjs';

// ── Stockage : vérification d'un bucket (réseau injecté) ────────────────────────────────────

const headersOf = (res) => {
  const out = {};
  for (const name of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']) {
    const value = res.headers?.get?.(name);
    if (value !== null && value !== undefined) out[name] = value;
  }
  return out;
};

function makeS3(fetchImpl, settings, now, timeoutMs) {
  return async function s3(method, url, { body = '', headers = {} } = {}) {
    const signed = signS3Request({
      method, url, headers, payloadHash: sha256Hex(body), date: now(),
      accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, region: settings.region,
    });
    try {
      const res = await fetchImpl(url, {
        method,
        headers: signed.headers,
        body: method === 'PUT' ? body : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, text, ...parseS3Error(text) };
    } catch (error) {
      return { error };
    }
  };
}

async function plainRequest(fetchImpl, url, init, timeoutMs) {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { status: res.status, body, headers: headersOf(res) };
  } catch (error) {
    return { error };
  }
}

/**
 * Vérifie un bucket : envoi d'un fichier de test (PUT signé), lecture par l'adresse publique,
 * CORS (et pose de la règle du guide s'il manque, sauf en simulation), suppression du fichier.
 * Appelle `emit(item)` pour chaque point.
 */
export async function checkBucket({ bucket, publicUrl }, config, {
  fetch: fetchImpl, dryRun = false, local = false, now = () => new Date(), sleep, timeoutMs = CHECK_TIMEOUT_MS,
  corsRetries = 4, corsRetryMs = 5000, emit,
}) {
  const settings = s3Settings(config.storage);
  const r2 = isR2(settings.endpoint);
  const s3 = makeS3(fetchImpl, settings, now, timeoutMs);
  const origin = config.appUrl;
  const label = `Stockage « ${bucket} »`;
  const key = testObjectKey(now());
  const content = `Fichier de test de Polabooth (vérification de l'installation, ${key}). Il est supprimé aussitôt.\n`;
  const objectUrl = s3Url(settings, bucket, key);
  const failureContext = { bucket, endpoint: settings.endpoint, forcePathStyle: settings.forcePathStyle };

  const put = await s3('PUT', objectUrl, { body: content, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const written = !put.error && put.ok;
  if (written) emit({ id: `storage-write:${bucket}`, status: 'ok', message: `${label} : envoi d'un fichier de test (${key})` });
  else emit({ id: `storage-write:${bucket}`, status: 'error', ...s3Failure(put, { action: `${label} : envoi du fichier de test`, ...failureContext }) });

  let getCors = null;
  const readPublic = async () => plainRequest(fetchImpl, publicObjectUrl(publicUrl, key), { method: 'GET', headers: { Origin: origin } }, timeoutMs);
  if (!written) {
    emit({ id: `storage-read:${bucket}`, status: 'skip', message: `${label} : lecture publique non vérifiée (envoi en échec)` });
  } else {
    const read = await readPublic();
    const failure = publicReadFailure(read, { expected: content, publicUrl, bucket, r2, local });
    if (failure) emit({ id: `storage-read:${bucket}`, status: 'error', ...failure, message: `${label} : ${failure.message}` });
    else {
      emit({ id: `storage-read:${bucket}`, status: 'ok', message: `${label} : lecture publique par ${publicUrl}` });
      getCors = allowsOrigin(read.headers['access-control-allow-origin'], origin);
    }
  }

  // CORS : requête préalable du navigateur sur l'adresse S3 (PUT présigné), et en-tête de la lecture
  // publique avec Origin (GET de la galerie). L'objet n'a pas besoin d'exister pour OPTIONS.
  const preflight = async () => {
    const res = await plainRequest(fetchImpl, objectUrl, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': CORS_PREFLIGHT.method, 'Access-Control-Request-Headers': CORS_PREFLIGHT.headers.join(',') },
    }, timeoutMs);
    return analyzePreflight(res, origin);
  };
  const corsLabel = `${label} : CORS`;
  const rule = corsRuleJson(origin).split('\n');
  const manual = corsManualHint({ r2, bucket });
  let check = await preflight();
  const getProblem = getCors === false;
  if (check.state === 'unverifiable') {
    emit({ id: `cors:${bucket}`, status: 'warn', message: `${corsLabel} impossible à vérifier (${check.detail}) : vérifiez la règle à la main.`, hint: manual, details: rule });
  } else if (check.state === 'ok' && !getProblem) {
    emit({ id: `cors:${bucket}`, status: 'ok', message: `${corsLabel} : envoi (PUT) et lecture (GET) autorisés depuis ${origin}` });
  } else {
    const why = check.state === 'ok' ? `lecture (GET) depuis ${origin} non autorisée` : check.detail;
    if (dryRun) {
      emit({ id: `cors:${bucket}`, status: 'warn', message: `${corsLabel} absent ou incomplet (${why}) : l'installation posera la règle du guide (simulation : rien n'est modifié).`, details: rule });
    } else {
      const outcome = await putCors(s3, settings, bucket, origin);
      if (outcome.state === 'denied') {
        emit({ id: `cors:${bucket}`, status: 'warn', message: `${corsLabel} absent ou incomplet (${why}), et la clé n'a pas le droit de le poser (${outcome.said}). Sans lui, les envois de photos depuis le navigateur échouent.`, hint: manual, details: rule });
      } else if (outcome.state === 'failed') {
        emit({ id: `cors:${bucket}`, status: 'warn', message: `${corsLabel} absent ou incomplet (${why}) ; pose refusée par le fournisseur (${outcome.said}).`, hint: manual, details: rule });
      } else {
        for (let i = 0; i < corsRetries; i++) {
          check = await preflight();
          const getOk = getCors === null || allowsOrigin((await readPublic()).headers?.['access-control-allow-origin'], origin);
          if (check.state === 'ok' && getOk) break;
          check = { ...check, state: check.state === 'ok' ? 'get' : check.state };
          if (i < corsRetries - 1) await sleep(corsRetryMs);
        }
        if (check.state === 'ok') {
          emit({ id: `cors:${bucket}`, status: 'ok', message: `${corsLabel} posé : origine ${origin}, méthodes GET et PUT (règles existantes gardées)` });
        } else {
          emit({ id: `cors:${bucket}`, status: 'warn', message: `${corsLabel} posé, mais pas encore pris en compte par le fournisseur : vérifiez-le dans quelques minutes.`, hint: manual, details: rule });
        }
      }
    }
  }

  if (written) {
    const del = await s3('DELETE', objectUrl);
    if (!del.error && (del.ok || del.status === 404)) emit({ id: `storage-delete:${bucket}`, status: 'ok', message: `${label} : fichier de test supprimé` });
    else {
      const failure = s3Failure(del, { action: 'suppression', ...failureContext });
      emit({ id: `storage-delete:${bucket}`, status: 'warn', message: `${label} : fichier de test non supprimé (${key}) : ${failure.message}`, hint: 'Supprimez-le à la main dans le bucket (dossier polabooth-verification/), sans conséquence sinon.' });
    }
  }
}

/** Pose la règle du guide (PUT ?cors), en gardant les règles déjà posées. */
async function putCors(s3, settings, bucket, origin) {
  const said = (r) => (r.error ? networkReason(r.error) : `${r.status}${r.code ? ` ${r.code}` : ''}`);
  const url = s3Url(settings, bucket, '', 'cors');
  const current = await s3('GET', url);
  if (current.error) return { state: 'failed', said: said(current) };
  let existing = [];
  if (current.ok) existing = existingCorsRules(current.text);
  else if (corsDenied(current)) return { state: 'denied', said: said(current) };
  else if (current.status !== 404) return { state: 'failed', said: said(current) };
  const xml = corsXml(origin, existing);
  const res = await s3('PUT', url, { body: xml, headers: { 'content-type': 'application/xml', 'content-md5': contentMd5(xml) } });
  if (!res.error && res.ok) return { state: 'set' };
  if (!res.error && corsDenied(res)) return { state: 'denied', said: said(res) };
  return { state: 'failed', said: said(res) };
}

// ── Phase complète ──────────────────────────────────────────────────────────────────────────

/**
 * Phase « Vérifications » : messagerie puis chaque bucket. `onItem(item)` à chaque point (affichage au
 * fil de l'eau) ; renvoie la liste des points, sans aucun secret.
 * Options : fetch, smtpConnect, smtpStartTls (réseau), dryRun (CORS non posé), skipEmailTest,
 * local (http accepté), now, sleep, timeoutMs.
 */
export async function runChecks(config, {
  fetch: fetchImpl, smtpConnect, smtpStartTls, dryRun = false, skipEmailTest = false, local = false,
  now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = CHECK_TIMEOUT_MS,
  corsRetries, corsRetryMs, onItem = () => {},
} = {}) {
  const secrets = [config.smtpPassword, config.storage.STORAGE_SECRET_ACCESS_KEY];
  const items = [];
  const emit = (item) => {
    const clean = redactItem(item, secrets);
    items.push(clean);
    onItem(clean);
  };

  const where = `${config.smtpHost}:${config.smtpPort}`;
  try {
    const res = await smtpCheck(config, {
      sendEmail: !skipEmailTest, timeoutMs, now: now(),
      ...(smtpConnect ? { connect: smtpConnect } : {}), ...(smtpStartTls ? { startTls: smtpStartTls } : {}),
    });
    if (res.sent) {
      emit({ id: 'smtp', status: 'ok', message: `Messagerie (${where}) : identifiants acceptés, email de test envoyé à ${config.adminEmail} (regardez aussi les indésirables)` });
    } else {
      emit({ id: 'smtp', status: 'warn', message: `Messagerie (${where}) : identifiants acceptés, email de test non envoyé (--skip-email-test)` });
    }
  } catch (e) {
    if (!(e instanceof SmtpError)) throw e;
    const { message, hint } = smtpFailure(e, { host: config.smtpHost, port: config.smtpPort, user: config.smtpUser, fromEmail: config.fromEmail, to: config.adminEmail });
    emit({ id: 'smtp', status: 'error', message: `Messagerie : ${message}`, hint });
  }

  for (const target of storageBuckets(config.storage)) {
    await checkBucket(target, config, {
      fetch: fetchImpl, dryRun, local, now, sleep, timeoutMs, emit,
      ...(corsRetries ? { corsRetries } : {}), ...(corsRetryMs !== undefined ? { corsRetryMs } : {}),
    });
  }
  return items;
}
