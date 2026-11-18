// Tests des vérifications du stockage (LAB-376) : signature SigV4 (exemples officiels S3), adresses, CORS
// et messages. Fonctions pures, aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePreflight, contentMd5, corsManualHint, corsRuleJson, corsXml, EMPTY_SHA256, existingCorsRules,
  parseS3Error, publicObjectUrl, publicReadFailure, rfc3986, s3Failure, s3Settings, s3Url, signingKey,
  signS3Request, storageBuckets, testObjectKey,
} from './install-checks-storage.mjs';

// ── Signature AWS SigV4 : exemples officiels de la documentation S3 ─────────────────────────

const AWS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
  payloadHash: EMPTY_SHA256,
};

test('SigV4 : exemple officiel GET Object (en-tête Range)', () => {
  const signed = signS3Request({ ...AWS, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' } });
  assert.equal(signed.canonicalRequest, [
    'GET', '/test.txt', '',
    'host:examplebucket.s3.amazonaws.com', 'range:bytes=0-9',
    `x-amz-content-sha256:${EMPTY_SHA256}`, 'x-amz-date:20130524T000000Z', '',
    'host;range;x-amz-content-sha256;x-amz-date', EMPTY_SHA256,
  ].join('\n'));
  assert.equal(signed.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(
    signed.headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
  assert.equal(signed.headers.host, undefined, 'host est posé par fetch, pas par nous');
});

test('SigV4 : exemples officiels GET ?lifecycle et liste (?max-keys=2&prefix=J)', () => {
  const lifecycle = signS3Request({ ...AWS, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?lifecycle' });
  assert.equal(lifecycle.signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  const list = signS3Request({ ...AWS, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2' });
  assert.equal(list.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  assert.match(list.canonicalRequest, /\nmax-keys=2&prefix=J\n/);
});

test('SigV4 : dérivation de la clé de signature (exemple officiel)', () => {
  assert.equal(
    signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam').toString('hex'),
    'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
  );
});

test('rfc3986 encode aussi ! \' ( ) *', () => {
  assert.equal(rfc3986("a b!'()*é/"), 'a%20b%21%27%28%29%2A%C3%A9%2F');
});

// ── Adresses S3 ─────────────────────────────────────────────────────────────────────────────

test('s3Settings : même règle que _shared/storage-config.ts', () => {
  const base = { STORAGE_ENDPOINT: 'https://s3.fr-par.scw.cloud/', STORAGE_REGION: '', STORAGE_ACCESS_KEY_ID: 'a', STORAGE_SECRET_ACCESS_KEY: 'b', STORAGE_FORCE_PATH_STYLE: '' };
  assert.deepEqual(s3Settings(base), { endpoint: 'https://s3.fr-par.scw.cloud', region: 'us-east-1', forcePathStyle: true, accessKeyId: 'a', secretAccessKey: 'b' });
  assert.equal(s3Settings({ ...base, STORAGE_FORCE_PATH_STYLE: 'true' }).forcePathStyle, true);
  assert.equal(s3Settings({ ...base, STORAGE_FORCE_PATH_STYLE: 'false' }).forcePathStyle, false);
  assert.equal(s3Settings({ ...base, STORAGE_REGION: 'auto' }).region, 'auto');
});

test('s3Url : adresses « endpoint/bucket/clé » et « bucket.endpoint/clé »', () => {
  const path = { endpoint: 'https://s3.fr-par.scw.cloud', forcePathStyle: true };
  const vhost = { endpoint: 'https://s3.fr-par.scw.cloud', forcePathStyle: false };
  assert.equal(s3Url(path, 'medias', 'polabooth-verification/a b.txt'), 'https://s3.fr-par.scw.cloud/medias/polabooth-verification/a%20b.txt');
  assert.equal(s3Url(path, 'medias', '', 'cors'), 'https://s3.fr-par.scw.cloud/medias?cors');
  assert.equal(s3Url(vhost, 'medias', 'x/y.txt'), 'https://medias.s3.fr-par.scw.cloud/x/y.txt');
  assert.equal(s3Url(vhost, 'medias', '', 'cors'), 'https://medias.s3.fr-par.scw.cloud/?cors');
  assert.equal(s3Url({ endpoint: 'http://localhost:9000/minio', forcePathStyle: true }, 'b', 'k'), 'http://localhost:9000/minio/b/k');
  assert.equal(publicObjectUrl('https://pub.r2.dev/', 'polabooth-verification/t.txt'), 'https://pub.r2.dev/polabooth-verification/t.txt');
});

test('storageBuckets : bucket des photos à part s\'il est défini et différent', () => {
  const s = { STORAGE_BUCKET: 'medias', STORAGE_PUBLIC_URL: 'https://m.fr', STORAGE_PHOTOS_BUCKET: '', STORAGE_PHOTOS_PUBLIC_URL: '' };
  assert.deepEqual(storageBuckets(s), [{ bucket: 'medias', publicUrl: 'https://m.fr' }]);
  assert.equal(storageBuckets({ ...s, STORAGE_PHOTOS_BUCKET: 'medias' }).length, 1);
  assert.deepEqual(storageBuckets({ ...s, STORAGE_PHOTOS_BUCKET: 'photos', STORAGE_PHOTOS_PUBLIC_URL: 'https://p.fr' })[1], { bucket: 'photos', publicUrl: 'https://p.fr' });
  assert.deepEqual(storageBuckets({ ...s, STORAGE_PHOTOS_BUCKET: 'photos' })[1], { bucket: 'photos', publicUrl: 'https://m.fr' });
});

test('testObjectKey : dossier polabooth-verification, horodatage sans « : »', () => {
  assert.equal(testObjectKey(new Date('2026-11-18T10:05:03.120Z')), 'polabooth-verification/2026-11-18T10-05-03-120Z.txt');
});

// ── CORS ────────────────────────────────────────────────────────────────────────────────────

test('corsXml : règles existantes gardées, règle du guide ajoutée ; Content-MD5', () => {
  const existing = existingCorsRules('<CORSConfiguration><CORSRule><AllowedOrigin>https://autre.fr</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule></CORSConfiguration>');
  assert.equal(existing.length, 1);
  const xml = corsXml('https://photobooth.exemple.fr', existing);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<CORSConfiguration xmlns="http:\/\/s3.amazonaws.com\/doc\/2006-03-01\/">/);
  assert.match(xml, /<AllowedOrigin>https:\/\/autre.fr<\/AllowedOrigin>/);
  assert.match(xml, /<CORSRule><AllowedOrigin>https:\/\/photobooth.exemple.fr<\/AllowedOrigin><AllowedMethod>GET<\/AllowedMethod><AllowedMethod>PUT<\/AllowedMethod><AllowedHeader>\*<\/AllowedHeader><ExposeHeader>ETag<\/ExposeHeader><MaxAgeSeconds>3600<\/MaxAgeSeconds><\/CORSRule><\/CORSConfiguration>$/);
  assert.equal(contentMd5('abc'), 'kAFQmDzST7DWlj99KOF/cg==');
  assert.deepEqual(JSON.parse(corsRuleJson('https://x.fr')), [{ AllowedOrigins: ['https://x.fr'], AllowedMethods: ['GET', 'PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }]);
});

test('analyzePreflight : absent, incomplet, ok, invérifiable', () => {
  const origin = 'https://photobooth.exemple.fr';
  const ok = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT', 'access-control-allow-headers': 'content-type' };
  assert.equal(analyzePreflight({ status: 200, headers: ok }, origin).state, 'ok');
  assert.equal(analyzePreflight({ status: 204, headers: { ...ok, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }, origin).state, 'ok');
  assert.equal(analyzePreflight({ status: 403, headers: {} }, origin).state, 'missing');
  assert.equal(analyzePreflight({ status: 200, headers: {} }, origin).state, 'missing');
  assert.equal(analyzePreflight({ status: 200, headers: { ...ok, 'access-control-allow-origin': 'https://autre.fr' } }, origin).state, 'incomplete');
  assert.match(analyzePreflight({ status: 200, headers: { ...ok, 'access-control-allow-methods': 'GET' } }, origin).detail, /PUT/);
  assert.match(analyzePreflight({ status: 200, headers: { ...ok, 'access-control-allow-headers': 'x-amz-date' } }, origin).detail, /content-type/);
  assert.equal(analyzePreflight({ status: 500, headers: {} }, origin).state, 'unverifiable');
  assert.equal(analyzePreflight({ error: Object.assign(new Error('x'), { code: 'ECONNRESET' }) }, origin).state, 'unverifiable');
});

test('corsManualHint : où coller la règle (R2 ou guide)', () => {
  assert.match(corsManualHint({ r2: true, bucket: 'medias' }), /Settings › CORS Policy/);
  assert.match(corsManualHint({ r2: false, bucket: 'medias' }), /section 3/);
});

// ── Messages stockage ───────────────────────────────────────────────────────────────────────

test('parseS3Error et s3Failure : messages précis selon le code S3', () => {
  assert.deepEqual(parseS3Error('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>'), { code: 'AccessDenied', message: 'Access Denied' });
  const ctx = { action: 'Envoi', bucket: 'medias', endpoint: 'https://s3.fr-par.scw.cloud', forcePathStyle: true };
  assert.match(s3Failure({ status: 403, code: 'InvalidAccessKeyId' }, ctx).hint, /STORAGE_ACCESS_KEY_ID/);
  assert.match(s3Failure({ status: 403, code: 'SignatureDoesNotMatch' }, ctx).hint, /STORAGE_SECRET_ACCESS_KEY/);
  assert.match(s3Failure({ status: 404, code: 'NoSuchBucket' }, ctx).message, /bucket « medias » introuvable/);
  assert.match(s3Failure({ status: 400, code: 'AuthorizationHeaderMalformed', message: 'the region us-east-1 is wrong' }, ctx).hint, /STORAGE_REGION/);
  assert.match(s3Failure({ status: 403, code: 'AccessDenied' }, ctx).message, /pas le droit d'écrire/);
  const dns = s3Failure({ error: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) }, { ...ctx, forcePathStyle: false });
  assert.match(dns.message, /injoignable \(adresse introuvable/);
  assert.match(dns.hint, /STORAGE_FORCE_PATH_STYLE=false/);
});

test('publicReadFailure : http, bucket privé, mauvaise adresse, fichier intact', () => {
  const ctx = { expected: 'abc', publicUrl: 'https://pub.exemple.fr', bucket: 'medias', r2: false };
  assert.equal(publicReadFailure({ status: 200, body: 'abc' }, ctx), null);
  assert.match(publicReadFailure({ status: 200, body: 'abc' }, { ...ctx, publicUrl: 'http://pub.exemple.fr' }).message, /http/);
  assert.equal(publicReadFailure({ status: 200, body: 'abc' }, { ...ctx, publicUrl: 'http://localhost:9000', local: true }), null);
  assert.match(publicReadFailure({ status: 403, body: '' }, ctx).message, /n'est pas public/);
  assert.match(publicReadFailure({ status: 403, body: '' }, { ...ctx, r2: true }).hint, /Settings › Public access/);
  assert.match(publicReadFailure({ status: 404, body: '' }, ctx).message, /ne mène pas au bucket/);
  assert.match(publicReadFailure({ status: 200, body: 'autre' }, ctx).message, /contenu différent/);
});
