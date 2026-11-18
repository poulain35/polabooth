// Vérifications de l'installation (LAB-376) : stockage S3, fonctions pures. Signature AWS SigV4 sur
// node:crypto, adresses des buckets, messages d’erreur et règle CORS du guide. Testé par
// install-checks-storage.test.mjs (exemples officiels de la documentation S3).
import { createHash, createHmac } from 'node:crypto';
import { clip, networkErrorCode, networkReason } from './install-checks-common.mjs';

// ── Stockage S3 : signature AWS SigV4 ───────────────────────────────────────────────────────

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

export const EMPTY_SHA256 = sha256Hex('');

/** Encodage RFC 3986 exigé par SigV4 (encodeURIComponent laisse passer ! ' ( ) *). */
export const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** « 20130524T000000Z » */
export const amzDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Clé de signature : HMAC en chaîne AWS4+secret → jour → région → service → aws4_request. */
export function signingKey(secretAccessKey, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
}

/** Chaîne de requête canonique : paires encodées RFC 3986, triées par nom puis valeur (`?cors` → `cors=`). */
export function canonicalQuery(searchParams) {
  return [...searchParams]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** Chemin canonique S3 : chaque segment décodé puis encodé une fois (RFC 3986), `/` gardés. */
export const canonicalPath = (pathname) => (pathname || '/').split('/').map((s) => rfc3986(decodeURIComponent(s))).join('/');

/**
 * Signe une requête S3 (en-tête Authorization, AWS SigV4). `headers` : en-têtes à signer en plus de
 * host, x-amz-date et x-amz-content-sha256. Renvoie les en-têtes à envoyer (sans host, posé par fetch)
 * et les éléments intermédiaires (tests). Ne jamais afficher `headers.authorization`.
 */
export function signS3Request({ method, url, headers = {}, payloadHash, accessKeyId, secretAccessKey, region, date, service = 's3' }) {
  const u = new URL(url);
  const stamp = amzDate(date);
  const all = { host: u.host, 'x-amz-date': stamp, 'x-amz-content-sha256': payloadHash };
  for (const [name, value] of Object.entries(headers)) all[name.toLowerCase()] = value;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, canonicalPath(u.pathname), canonicalQuery(u.searchParams), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${stamp.slice(0, 8)}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(secretAccessKey, stamp.slice(0, 8), region, service)).update(stringToSign, 'utf8').digest('hex');
  const { host: _host, ...send } = all;
  return {
    headers: { ...send, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    canonicalRequest,
    stringToSign,
    signature,
  };
}

// ── Stockage S3 : adresses ──────────────────────────────────────────────────────────────────

/** Région SigV4 si STORAGE_REGION est vide (même valeur que _shared/storage-config.ts). */
export const DEFAULT_S3_REGION = 'us-east-1';

/**
 * Réglages S3 de la configuration, selon la même règle que storageClientConfig() de
 * supabase/functions/_shared/storage-config.ts (reproduite : ce fichier TypeScript importe un module
 * Deno et ne se charge pas sous Node 20) : région vide = us-east-1, adresses « endpoint/bucket/clé »
 * sauf STORAGE_FORCE_PATH_STYLE=false (« bucket.endpoint/clé »).
 */
export function s3Settings(storage) {
  return {
    endpoint: storage.STORAGE_ENDPOINT.replace(/\/+$/, ''),
    region: storage.STORAGE_REGION || DEFAULT_S3_REGION,
    forcePathStyle: storage.STORAGE_FORCE_PATH_STYLE !== 'false',
    accessKeyId: storage.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: storage.STORAGE_SECRET_ACCESS_KEY,
  };
}

export const encodeKey = (key) => key.split('/').map(rfc3986).join('/');

/** Adresse S3 d'un bucket (`key` vide) ou d'un objet, `query` sans « ? » (ex. « cors »). */
export function s3Url({ endpoint, forcePathStyle }, bucket, key = '', query = '') {
  const u = new URL(endpoint);
  const base = u.pathname.replace(/\/+$/, '');
  const path = key ? encodeKey(key) : '';
  const url = forcePathStyle
    ? `${u.origin}${base}/${rfc3986(bucket)}${path ? `/${path}` : ''}`
    : `${u.protocol}//${bucket}.${u.host}${base}/${path}`;
  return query ? `${url}?${query}` : url;
}

export const publicObjectUrl = (publicUrl, key) => `${publicUrl.replace(/\/+$/, '')}/${encodeKey(key)}`;

export const isR2 = (endpoint) => /\.r2\.cloudflarestorage\.com$/i.test(new URL(endpoint).hostname);

/**
 * Buckets à vérifier : STORAGE_BUCKET (adresse STORAGE_PUBLIC_URL) et STORAGE_PHOTOS_BUCKET s'il est
 * défini et différent (adresse STORAGE_PHOTOS_PUBLIC_URL, sinon STORAGE_PUBLIC_URL comme les fonctions).
 */
export function storageBuckets(storage) {
  const list = [{ bucket: storage.STORAGE_BUCKET, publicUrl: storage.STORAGE_PUBLIC_URL }];
  if (storage.STORAGE_PHOTOS_BUCKET && storage.STORAGE_PHOTOS_BUCKET !== storage.STORAGE_BUCKET) {
    list.push({ bucket: storage.STORAGE_PHOTOS_BUCKET, publicUrl: storage.STORAGE_PHOTOS_PUBLIC_URL || storage.STORAGE_PUBLIC_URL });
  }
  return list;
}

/** Clé du fichier de test : `polabooth-verification/<horodatage>.txt`. */
export const testObjectKey = (date) => `polabooth-verification/${date.toISOString().replace(/[:.]/g, '-')}.txt`;

// ── Stockage S3 : erreurs et lecture publique ───────────────────────────────────────────────

/** Code et message d'une erreur S3 (XML `<Error><Code>…</Code><Message>…</Message>`). */
export function parseS3Error(text) {
  const pick = (tag) => String(text ?? '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '';
  return { code: pick('Code'), message: pick('Message') };
}

const STORAGE_GUIDE = 'docs/installation-instance.md, section 3';

/** Message et solution pour une requête S3 signée refusée (`action` : envoi, suppression…). */
export function s3Failure({ status, code, message, error }, { action, bucket, endpoint, forcePathStyle }) {
  if (error) {
    const reason = networkReason(error);
    const dnsHint = !forcePathStyle && ['ENOTFOUND', 'EAI_AGAIN'].includes(networkErrorCode(error))
      ? ' Avec STORAGE_FORCE_PATH_STYLE=false, l\'adresse est « bucket.endpoint » : laissez plutôt la variable vide.'
      : '';
    return {
      message: `${action} impossible : ${endpoint} injoignable (${reason}).`,
      hint: `Vérifiez STORAGE_ENDPOINT (${STORAGE_GUIDE}).${dnsHint}`,
    };
  }
  const said = `${status}${code ? ` ${code}` : ''}${message ? ` : ${clip(message)}` : ''}`;
  if (code === 'InvalidAccessKeyId') {
    return { message: `${action} en échec : clé d'accès inconnue du fournisseur (${said}).`, hint: 'Vérifiez STORAGE_ACCESS_KEY_ID : copiez-la en entier.' };
  }
  if (code === 'SignatureDoesNotMatch') {
    return { message: `${action} en échec : clé secrète refusée (${status} ${code}).`, hint: 'Vérifiez STORAGE_SECRET_ACCESS_KEY : copiez-la en entier, sans espace.' };
  }
  if (code === 'NoSuchBucket' || (status === 404 && !code)) {
    return { message: `${action} en échec : bucket « ${bucket} » introuvable (${said}).`, hint: 'Vérifiez STORAGE_BUCKET (nom exact) et STORAGE_ENDPOINT.' };
  }
  if (status === 301 || /region|location/i.test(`${code} ${message}`) || code === 'AuthorizationHeaderMalformed') {
    return { message: `${action} en échec : région ou adresse du fournisseur incorrecte (${said}).`, hint: `Vérifiez STORAGE_REGION (ex. fr-par, gra, auto pour Cloudflare R2) et STORAGE_ENDPOINT (${STORAGE_GUIDE}).` };
  }
  if (status === 403 || code === 'AccessDenied') {
    return {
      message: `${action} en échec : la clé n'a pas le droit d'écrire dans le bucket « ${bucket} » (${said}).`,
      hint: 'Donnez à la clé les droits de lecture et d\'écriture sur ce bucket (Cloudflare R2 : « Object Read & Write »).',
    };
  }
  return { message: `${action} en échec : refus du fournisseur (${said}).`, hint: `Vérifiez les variables STORAGE_* (${STORAGE_GUIDE}).` };
}

/** Problème de lecture publique (`null` si le fichier revient intact), avec la solution. */
export function publicReadFailure({ status, body, error }, { expected, publicUrl, bucket, r2, local = false }) {
  if (!local && !/^https:\/\//i.test(publicUrl)) {
    return {
      message: `Adresse publique en http (${publicUrl}) : la borne n'enregistre que des photos en https.`,
      hint: 'Mettez une adresse en https:// dans STORAGE_PUBLIC_URL (et STORAGE_PHOTOS_PUBLIC_URL).',
    };
  }
  const publicHint = r2
    ? `Cloudflare R2 : bucket ${bucket} › Settings › Public access, reliez un domaine (ou activez l'adresse r2.dev), puis mettez cette adresse dans STORAGE_PUBLIC_URL.`
    : `Rendez la lecture du bucket publique chez votre fournisseur, et vérifiez que STORAGE_PUBLIC_URL est l'adresse publique de ce bucket (${STORAGE_GUIDE}).`;
  if (error) {
    return { message: `Lecture publique impossible : ${new URL(publicUrl).host} injoignable (${networkReason(error)}).`, hint: publicHint };
  }
  if (status === 200) {
    if (body === expected) return null;
    return { message: `L'adresse publique ${publicUrl} ne mène pas au bucket « ${bucket} » (contenu différent).`, hint: publicHint };
  }
  if (status === 401 || status === 403) {
    return { message: `Lecture publique refusée (${status}) : le bucket « ${bucket} » n'est pas public.`, hint: publicHint };
  }
  if (status === 404) {
    return { message: `Fichier de test introuvable par l'adresse publique (404) : ${publicUrl} ne mène pas au bucket « ${bucket} », ou sa lecture publique n'est pas activée.`, hint: publicHint };
  }
  return { message: `Lecture publique en échec (${status}) par ${publicUrl}.`, hint: publicHint };
}

// ── CORS ────────────────────────────────────────────────────────────────────────────────────

/**
 * Ce que le navigateur fait réellement : PUT sur une adresse présignée avec l'en-tête Content-Type
 * (envois des photos, de l'audio, de l'installeur : GuestUploader, AdminPhotoEvent, AdminAudioEvent,
 * putToStorage), et GET par fetch sur l'adresse publique (téléchargement des photos de la galerie).
 */
export const CORS_PREFLIGHT = { method: 'PUT', headers: ['content-type'] };

/** Règle du guide (section 3). */
export const corsRule = (appUrl) => ({
  AllowedOrigins: [appUrl],
  AllowedMethods: ['GET', 'PUT'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3600,
});

export const corsRuleJson = (appUrl) => JSON.stringify([corsRule(appUrl)], null, 2);

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Règles `<CORSRule>…</CORSRule>` déjà posées (réponse de GET ?cors), telles quelles. */
export const existingCorsRules = (xml) => String(xml ?? '').match(/<CORSRule>[\s\S]*?<\/CORSRule>/g) ?? [];

/** Corps du PUT ?cors : règles existantes gardées, règle du guide ajoutée à la fin. */
export function corsXml(appUrl, existing = []) {
  const rule = corsRule(appUrl);
  const ours = '<CORSRule>'
    + rule.AllowedOrigins.map((o) => `<AllowedOrigin>${xmlEscape(o)}</AllowedOrigin>`).join('')
    + rule.AllowedMethods.map((m) => `<AllowedMethod>${m}</AllowedMethod>`).join('')
    + rule.AllowedHeaders.map((h) => `<AllowedHeader>${h}</AllowedHeader>`).join('')
    + rule.ExposeHeaders.map((h) => `<ExposeHeader>${h}</ExposeHeader>`).join('')
    + `<MaxAgeSeconds>${rule.MaxAgeSeconds}</MaxAgeSeconds>`
    + '</CORSRule>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${existing.join('')}${ours}</CORSConfiguration>`;
}

export const contentMd5 = (body) => createHash('md5').update(body, 'utf8').digest('base64');

const listHeader = (value) => String(value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const allowsOrigin = (allowOrigin, origin) => {
  const v = String(allowOrigin ?? '').trim();
  return v === '*' || v === origin;
};

/**
 * Réponse à la requête préalable du navigateur (OPTIONS, Origin, PUT, content-type) :
 * `{ state: 'ok' | 'missing' | 'incomplete' | 'unverifiable', detail }`.
 * S3 répond 403 quand aucune règle CORS ne couvre l'origine : c'est « missing ».
 */
export function analyzePreflight(response, origin) {
  if (!response || response.error) return { state: 'unverifiable', detail: response?.error ? networkReason(response.error) : 'pas de réponse' };
  const { status, headers } = response;
  if (status === 403) return { state: 'missing', detail: 'aucune règle CORS pour cette origine' };
  if (status < 200 || status >= 300) return { state: 'unverifiable', detail: `réponse inattendue (${status})` };
  const allowOrigin = headers['access-control-allow-origin'];
  if (!allowOrigin) return { state: 'missing', detail: 'aucune règle CORS pour cette origine' };
  if (!allowsOrigin(allowOrigin, origin)) return { state: 'incomplete', detail: `origine autorisée : ${clip(allowOrigin, 100)}` };
  const methods = listHeader(headers['access-control-allow-methods']);
  if (!methods.includes('put') && !methods.includes('*')) return { state: 'incomplete', detail: 'méthode PUT non autorisée' };
  const allowed = listHeader(headers['access-control-allow-headers']);
  const missing = CORS_PREFLIGHT.headers.filter((h) => !allowed.includes(h) && !allowed.includes('*'));
  if (missing.length) return { state: 'incomplete', detail: `en-tête ${missing.join(', ')} non autorisé` };
  return { state: 'ok', detail: '' };
}

/** Où coller la règle quand le script ne peut pas la poser. */
export function corsManualHint({ r2, bucket }) {
  return r2
    ? `Cloudflare R2 : bucket ${bucket} › Settings › CORS Policy › Add CORS policy, collez la règle ci-dessous.`
    : `Collez la règle ci-dessous dans les réglages CORS du bucket ${bucket} chez votre fournisseur (${STORAGE_GUIDE}).`;
}

/** Refus de poser le CORS faute de droits (la clé n'agit que sur les fichiers). */
export const corsDenied = ({ status, code }) => status === 403 || status === 501 || ['AccessDenied', 'NotImplemented'].includes(code);
