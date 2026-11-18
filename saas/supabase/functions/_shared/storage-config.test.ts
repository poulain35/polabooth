// Stockage compatible S3 (open core étape 2, lot S1, LAB-266) : sans STORAGE_*, configuration R2
// identique au code d'avant S1 ; avec STORAGE_*, valeurs du fournisseur ; erreurs claires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import {
  audioBucket, audioPublicBaseUrl, DEFAULT_S3_REGION, eventFolder, photosBucket, photosPublicBaseUrl,
  StorageConfigError, storageClientConfig, storageVarNames, usesGenericS3,
} from './storage-config.ts';

type Env = Record<string, string | undefined>;
const envOf = (vars: Env) => (k: string) => vars[k];

// ── Référence : le code d'avant S1, recopié tel quel (sans Deno.env) ─────────

const legacy = (vars: Env) => {
  const get = (k: string) => vars[k];
  return {
    client: {
      region: 'auto',
      endpoint: `https://${get('R2_ACCOUNT_ID')!}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: get('R2_SECRET_ACCESS_KEY')!,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    },
    // get-photo-upload-url, get-guest-upload-url, get-kiosk-upload-url, get-photos, delete-photo
    photosBucket: get('R2_PHOTOS_BUCKET_NAME') ?? get('R2_BUCKET_NAME')!,
    // media-expiry
    photosBucketPurge: get('R2_PHOTOS_BUCKET_NAME') || (get('R2_BUCKET_NAME') ?? ''),
    // fonctions audio, media-expiry
    audioBucket: get('R2_BUCKET_NAME')!,
    // _shared/r2paths.ts
    photosPublic: (get('R2_PHOTOS_PUBLIC_URL') ?? get('R2_PUBLIC_URL') ?? '').replace(/\/$/, ''),
    // get-photo-upload-url
    photosPublicAdmin: (get('R2_PHOTOS_PUBLIC_URL') ?? get('R2_PUBLIC_URL')!).replace(/\/$/, ''),
    // get-audio-upload-url
    audioPublic: get('R2_PUBLIC_URL')!.replace(/\/$/, ''),
  };
};

/** get-photo-upload-url avait sa propre copie de slugify ; r2paths.ts l'autre. */
function legacyFolder(id: string, name: string | null | undefined): string {
  const slug = (name ?? '')
    .normalize('NFD').replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'event';
  return `${slug}-${id.slice(0, 8)}`;
}

const R2_FULL: Env = {
  R2_ACCOUNT_ID: 'abc123def456',
  R2_ACCESS_KEY_ID: 'AKIAR2',
  R2_SECRET_ACCESS_KEY: 's3cr3t',
  R2_BUCKET_NAME: 'pola-audio',
  R2_PHOTOS_BUCKET_NAME: 'pola-photos',
  R2_PUBLIC_URL: 'https://pub-audio.r2.dev/',
  R2_PHOTOS_PUBLIC_URL: 'https://pub-photos.r2.dev',
};
const R2_SINGLE_BUCKET: Env = {
  R2_ACCOUNT_ID: 'abc123def456',
  R2_ACCESS_KEY_ID: 'AKIAR2',
  R2_SECRET_ACCESS_KEY: 's3cr3t',
  R2_BUCKET_NAME: 'pola-media',
  R2_PUBLIC_URL: 'https://pub-media.r2.dev',
};

for (const [label, vars] of [['deux buckets', R2_FULL], ['un seul bucket', R2_SINGLE_BUCKET]] as const) {
  test(`sans STORAGE_* (R2, ${label}) : client, buckets et URL publiques identiques à avant S1`, () => {
    const env = envOf(vars);
    const before = legacy(vars);
    assert.equal(usesGenericS3(env), false);
    assert.deepEqual(storageClientConfig(env), before.client);
    assert.equal('forcePathStyle' in storageClientConfig(env), false);
    assert.equal(photosBucket(env), before.photosBucket);
    assert.equal(photosBucket(env), before.photosBucketPurge);
    assert.equal(audioBucket(env), before.audioBucket);
    assert.equal(photosPublicBaseUrl(env), before.photosPublic);
    assert.equal(photosPublicBaseUrl(env), before.photosPublicAdmin);
    assert.equal(audioPublicBaseUrl(env), before.audioPublic);
  });
}

test('sans STORAGE_* : endpoint R2 du compte, région auto', () => {
  const config = storageClientConfig(envOf(R2_FULL));
  assert.equal(config.endpoint, 'https://abc123def456.r2.cloudflarestorage.com');
  assert.equal(config.region, 'auto');
  assert.equal(photosPublicBaseUrl(envOf(R2_FULL)), 'https://pub-photos.r2.dev');
  assert.equal(audioPublicBaseUrl(envOf(R2_FULL)), 'https://pub-audio.r2.dev');
});

test('clés d\'objet : dossier d\'événement inchangé (r2paths.ts et get-photo-upload-url)', () => {
  const id = '1f2e3d4c-5b6a-7980-8a9b-0c1d2e3f4a5b';
  const names = ['Mariage Émilie & Théo', '  ', null, undefined, 'Anniversaire 30 ans — Zoé !!!', 'x'.repeat(80), 'Ça déchire ⭐'];
  for (const name of names) assert.equal(eventFolder({ id, name }), legacyFolder(id, name));
  assert.equal(eventFolder({ id, name: 'Mariage Émilie & Théo' }), 'mariage-emilie-theo-1f2e3d4c');
  assert.equal(eventFolder({ id, name: null }), 'event-1f2e3d4c');
});

// ── Fournisseur S3 générique ───────────────────────────────────────────────

const SCW: Env = {
  STORAGE_ENDPOINT: 'https://s3.fr-par.scw.cloud/',
  STORAGE_REGION: 'fr-par',
  STORAGE_ACCESS_KEY_ID: 'SCWKEY',
  STORAGE_SECRET_ACCESS_KEY: 'scw-secret',
  STORAGE_BUCKET: 'loueur-audio',
  STORAGE_PHOTOS_BUCKET: 'loueur-photos',
  STORAGE_PUBLIC_URL: 'https://loueur-audio.s3.fr-par.scw.cloud/',
  STORAGE_PHOTOS_PUBLIC_URL: 'https://loueur-photos.s3.fr-par.scw.cloud',
  STORAGE_FORCE_PATH_STYLE: 'false',
};

test('avec STORAGE_ENDPOINT : client, buckets et URL publiques du fournisseur (les R2_* sont ignorées)', () => {
  const env = envOf({ ...R2_FULL, ...SCW });
  assert.equal(usesGenericS3(env), true);
  assert.deepEqual(storageClientConfig(env), {
    region: 'fr-par',
    endpoint: 'https://s3.fr-par.scw.cloud',
    forcePathStyle: false,
    credentials: { accessKeyId: 'SCWKEY', secretAccessKey: 'scw-secret' },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  assert.equal(audioBucket(env), 'loueur-audio');
  assert.equal(photosBucket(env), 'loueur-photos');
  assert.equal(audioPublicBaseUrl(env), 'https://loueur-audio.s3.fr-par.scw.cloud');
  assert.equal(photosPublicBaseUrl(env), 'https://loueur-photos.s3.fr-par.scw.cloud');
});

test('avec STORAGE_ENDPOINT : région us-east-1 et path style par défaut, un seul bucket et une seule URL', () => {
  const env = envOf({
    STORAGE_ENDPOINT: 'http://minio.local:9000',
    STORAGE_ACCESS_KEY_ID: 'minio',
    STORAGE_SECRET_ACCESS_KEY: 'minio123',
    STORAGE_BUCKET: 'pola',
    STORAGE_PUBLIC_URL: 'http://minio.local:9000/pola/',
  });
  const config = storageClientConfig(env);
  assert.equal(config.region, DEFAULT_S3_REGION);
  assert.equal(config.region, 'us-east-1');
  assert.equal(config.forcePathStyle, true);
  assert.equal(config.endpoint, 'http://minio.local:9000');
  assert.equal(photosBucket(env), 'pola');
  assert.equal(audioBucket(env), 'pola');
  assert.equal(photosPublicBaseUrl(env), 'http://minio.local:9000/pola');
});

test('STORAGE_FORCE_PATH_STYLE : true/false, 1/0, oui/non (casse ignorée)', () => {
  const base = { STORAGE_ENDPOINT: 'https://s3.x.io', STORAGE_ACCESS_KEY_ID: 'k', STORAGE_SECRET_ACCESS_KEY: 's' };
  for (const [raw, expected] of [['TRUE', true], ['1', true], ['oui', true], ['False', false], ['0', false], ['non', false]] as const) {
    assert.equal(storageClientConfig(envOf({ ...base, STORAGE_FORCE_PATH_STYLE: raw })).forcePathStyle, expected, raw);
  }
});

test('Supabase Storage (S3) : endpoint du projet, région du projet, path style', () => {
  const env = envOf({
    STORAGE_ENDPOINT: 'https://abcdefgh.storage.supabase.co/storage/v1/s3',
    STORAGE_REGION: 'eu-west-3',
    STORAGE_ACCESS_KEY_ID: 'k',
    STORAGE_SECRET_ACCESS_KEY: 's',
    STORAGE_BUCKET: 'media',
    STORAGE_PUBLIC_URL: 'https://abcdefgh.supabase.co/storage/v1/object/public/media',
  });
  const config = storageClientConfig(env);
  assert.equal(config.endpoint, 'https://abcdefgh.storage.supabase.co/storage/v1/s3');
  assert.equal(config.forcePathStyle, true);
  assert.equal(`${photosPublicBaseUrl(env)}/photos/x-1/a.jpg`, 'https://abcdefgh.supabase.co/storage/v1/object/public/media/photos/x-1/a.jpg');
});

// ── Erreurs de configuration ───────────────────────────────────────────────

test('erreur claire : STORAGE_ENDPOINT sans clés', () => {
  assert.throws(() => storageClientConfig(envOf({ STORAGE_ENDPOINT: 'https://s3.x.io' })),
    (e: Error) => e instanceof StorageConfigError && /STORAGE_ACCESS_KEY_ID et STORAGE_SECRET_ACCESS_KEY/.test(e.message));
  assert.throws(() => storageClientConfig(envOf({ STORAGE_ENDPOINT: 'https://s3.x.io', STORAGE_ACCESS_KEY_ID: 'k' })),
    /STORAGE_SECRET_ACCESS_KEY manque/);
});

test('erreur claire : STORAGE_ENDPOINT qui n\'est pas une URL, STORAGE_FORCE_PATH_STYLE illisible', () => {
  const keys = { STORAGE_ACCESS_KEY_ID: 'k', STORAGE_SECRET_ACCESS_KEY: 's' };
  assert.throws(() => storageClientConfig(envOf({ ...keys, STORAGE_ENDPOINT: 's3.fr-par.scw.cloud' })), /STORAGE_ENDPOINT invalide/);
  assert.throws(() => storageClientConfig(envOf({ ...keys, STORAGE_ENDPOINT: 'https://s3.x.io', STORAGE_FORCE_PATH_STYLE: 'peut-être' })),
    /STORAGE_FORCE_PATH_STYLE invalide/);
});

test('erreur claire : variable STORAGE_* sans STORAGE_ENDPOINT (pas de mélange silencieux avec R2)', () => {
  const env = envOf({ ...R2_FULL, STORAGE_BUCKET: 'autre' });
  assert.throws(() => storageClientConfig(env), /STORAGE_BUCKET défini\(e\)s sans STORAGE_ENDPOINT/);
  assert.throws(() => photosBucket(env), StorageConfigError);
});

test('erreur claire : ni R2 ni STORAGE_* configuré', () => {
  assert.throws(() => storageClientConfig(envOf({})), /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY manque/);
  assert.equal(photosBucket(envOf({})), '');
  assert.equal(photosPublicBaseUrl(envOf({})), '');
});

test('variable vide = absente', () => {
  const env = envOf({ ...R2_FULL, R2_PHOTOS_BUCKET_NAME: '', R2_PHOTOS_PUBLIC_URL: '', STORAGE_ENDPOINT: '' });
  assert.equal(usesGenericS3(env), false);
  assert.equal(photosBucket(env), 'pola-audio');
  assert.equal(photosPublicBaseUrl(env), 'https://pub-audio.r2.dev');
});

test('storageVarNames : noms du fournisseur actif pour les messages', () => {
  assert.match(storageVarNames(envOf(R2_FULL)).photosBucket, /R2_PHOTOS_BUCKET_NAME/);
  assert.match(storageVarNames(envOf(SCW)).photosPublicUrl, /STORAGE_PHOTOS_PUBLIC_URL/);
});

// ── Câblage des fonctions ──────────────────────────────────────────────────

const FUNCTIONS_DIR = fileURLToPath(new URL('..', import.meta.url));
const STORAGE_FUNCTIONS = [
  'delete-audio-track', 'delete-photo', 'generate-audio-title', 'get-audio-tracks', 'get-audio-upload-url',
  'get-guest-upload-url', 'get-kiosk-upload-url', 'get-photo-upload-url', 'get-photos', 'media-expiry',
  'get-release-upload-url',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

test('plus aucun endpoint R2 ni client S3 en dur hors de _shared/storage*.ts', () => {
  const allowed = new Set(['_shared/storage-config.ts', '_shared/storage.ts']);
  const offenders = sourceFiles(FUNCTIONS_DIR)
    .map((p) => ({ rel: relative(FUNCTIONS_DIR, p).split(sep).join('/'), src: readFileSync(p, 'utf8') }))
    .filter(({ rel, src }) => !allowed.has(rel) && /r2\.cloudflarestorage\.com|\bR2_[A-Z_]+|new S3Client\b|r2paths/.test(src))
    .map(({ rel }) => rel);
  assert.deepEqual(offenders, []);
});

test('les 11 fonctions de stockage passent par _shared/storage.ts', () => {
  // Dépôt public (export open core) : les fonctions des fonctionnalités privées ne sont pas livrées.
  const privateInstalled = existsSync(join(FUNCTIONS_DIR, '_shared', 'modules'));
  for (const fn of STORAGE_FUNCTIONS) {
    if (!privateInstalled && !existsSync(join(FUNCTIONS_DIR, fn))) continue;
    // Fichiers de la fonction hors tests : index.ts peut confier le stockage à un module voisin (media-expiry/purge.ts, LAB-403).
    const src = readdirSync(join(FUNCTIONS_DIR, fn)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(join(FUNCTIONS_DIR, fn, f), 'utf8')).join('\n');
    assert.match(src, /from '\.\.\/_shared\/storage\.ts'/, fn);
    assert.match(src, /storageClient\(\)/, fn);
  }
});
