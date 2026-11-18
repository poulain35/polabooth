// Stockage des médias (open core étape 2, lot S1) : Cloudflare R2 ou tout fournisseur compatible S3.
// Partie pure (sans import npm:) : testée sous `node --test`. Le client S3 est dans storage.ts.
//
// STORAGE_ENDPOINT défini → fournisseur S3 générique (variables STORAGE_*).
// Sinon → R2 exactement comme avant S1 (R2_*, mêmes buckets, mêmes URL publiques).
// Variables lues à chaque appel. Une variable vide compte comme absente.

import { denoEnv, type EnvGet } from './secrets.ts';

export interface StorageClientConfig {
  region: string;
  endpoint: string;
  forcePathStyle?: boolean;
  credentials: { accessKeyId: string; secretAccessKey: string };
  // Les fournisseurs compatibles S3 (R2 compris) ne gèrent pas tous les sommes de contrôle CRC32
  // que le SDK ajoute par défaut : elles cassent les URL présignées.
  requestChecksumCalculation: 'WHEN_REQUIRED';
  responseChecksumValidation: 'WHEN_REQUIRED';
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/** Région SigV4 si STORAGE_REGION est absente : convention S3 et valeur par défaut de MinIO. */
export const DEFAULT_S3_REGION = 'us-east-1';

const GENERIC_VARS = [
  'STORAGE_REGION', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'STORAGE_BUCKET',
  'STORAGE_PHOTOS_BUCKET', 'STORAGE_PUBLIC_URL', 'STORAGE_PHOTOS_PUBLIC_URL', 'STORAGE_FORCE_PATH_STYLE',
];

const read = (env: EnvGet, name: string): string | undefined => env(name) || undefined;

/** Fournisseur S3 générique (STORAGE_ENDPOINT) ou R2. Une variable STORAGE_* sans endpoint est une erreur. */
export function usesGenericS3(env: EnvGet = denoEnv): boolean {
  if (read(env, 'STORAGE_ENDPOINT')?.trim()) return true;
  const orphan = GENERIC_VARS.filter((name) => read(env, name));
  if (orphan.length) {
    throw new StorageConfigError(`${orphan.join(', ')} défini(e)s sans STORAGE_ENDPOINT : ajoutez STORAGE_ENDPOINT ou retirez ces variables (stockage R2 sinon).`);
  }
  return false;
}

function parsePathStyle(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'oui'].includes(v)) return true;
  if (['false', '0', 'no', 'non'].includes(v)) return false;
  throw new StorageConfigError(`STORAGE_FORCE_PATH_STYLE invalide (« ${raw} ») : true ou false attendu.`);
}

/** Options du client S3 (`new S3Client(storageClientConfig())`). */
export function storageClientConfig(env: EnvGet = denoEnv): StorageClientConfig {
  const checksums = { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' } as const;

  if (!usesGenericS3(env)) {
    const absent = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((name) => !read(env, name));
    if (absent.length) {
      throw new StorageConfigError(`Stockage non configuré : ${absent.join(', ')} manque(nt) (ou définissez STORAGE_ENDPOINT et les variables STORAGE_*).`);
    }
    return {
      region: 'auto',
      endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env('R2_ACCESS_KEY_ID')!,
        secretAccessKey: env('R2_SECRET_ACCESS_KEY')!,
      },
      ...checksums,
    };
  }

  const endpoint = read(env, 'STORAGE_ENDPOINT')!.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(endpoint)) {
    throw new StorageConfigError(`STORAGE_ENDPOINT invalide (« ${endpoint} ») : URL http(s) attendue, ex. https://s3.fr-par.scw.cloud.`);
  }
  const accessKeyId = read(env, 'STORAGE_ACCESS_KEY_ID');
  const secretAccessKey = read(env, 'STORAGE_SECRET_ACCESS_KEY');
  const missing = [!accessKeyId && 'STORAGE_ACCESS_KEY_ID', !secretAccessKey && 'STORAGE_SECRET_ACCESS_KEY'].filter(Boolean);
  if (missing.length) {
    throw new StorageConfigError(`STORAGE_ENDPOINT est défini mais ${missing.join(' et ')} manque(nt).`);
  }

  return {
    region: read(env, 'STORAGE_REGION')?.trim() || DEFAULT_S3_REGION,
    endpoint,
    forcePathStyle: parsePathStyle(read(env, 'STORAGE_FORCE_PATH_STYLE')),
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    ...checksums,
  };
}

/** Bucket des messages audio (livre d'or) ; repli du bucket photos. Chaîne vide si absent. */
export function audioBucket(env: EnvGet = denoEnv): string {
  return (usesGenericS3(env) ? read(env, 'STORAGE_BUCKET') : read(env, 'R2_BUCKET_NAME')) ?? '';
}

/** Bucket des photos (borne, invités, admin), sinon le bucket audio. Chaîne vide si aucun. */
export function photosBucket(env: EnvGet = denoEnv): string {
  const own = usesGenericS3(env) ? read(env, 'STORAGE_PHOTOS_BUCKET') : read(env, 'R2_PHOTOS_BUCKET_NAME');
  return own ?? audioBucket(env);
}

/** Base URL publique des messages audio, sans slash final. */
export function audioPublicBaseUrl(env: EnvGet = denoEnv): string {
  const url = usesGenericS3(env) ? read(env, 'STORAGE_PUBLIC_URL') : read(env, 'R2_PUBLIC_URL');
  return (url ?? '').replace(/\/$/, '');
}

/** Base URL publique des photos (repli sur celle de l'audio), sans slash final. */
export function photosPublicBaseUrl(env: EnvGet = denoEnv): string {
  const own = usesGenericS3(env) ? read(env, 'STORAGE_PHOTOS_PUBLIC_URL') : read(env, 'R2_PHOTOS_PUBLIC_URL');
  return own ? own.replace(/\/$/, '') : audioPublicBaseUrl(env);
}

/** Noms des variables du fournisseur actif, pour les messages d'erreur. */
export function storageVarNames(env: EnvGet = denoEnv) {
  return usesGenericS3(env)
    ? { photosBucket: 'STORAGE_PHOTOS_BUCKET (ou STORAGE_BUCKET)', audioBucket: 'STORAGE_BUCKET', photosPublicUrl: 'STORAGE_PHOTOS_PUBLIC_URL (ou STORAGE_PUBLIC_URL)' }
    : { photosBucket: 'R2_PHOTOS_BUCKET_NAME (ou R2_BUCKET_NAME)', audioBucket: 'R2_BUCKET_NAME', photosPublicUrl: 'R2_PHOTOS_PUBLIC_URL (ou R2_PUBLIC_URL)' };
}

// ── Clés d'objet ─────────────────────────────────────────────────────────────
// Partagées entre get-guest-upload-url (signature) et record-guest-photo (validation du chemin
// enregistré) : les deux DOIVENT calculer le dossier de la même façon, sinon la validation
// anti-injection de photo_url rejetterait des envois légitimes.

/** Slug ASCII sûr pour une clé d'objet (retire accents, espaces et caractères spéciaux). */
function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[^\x00-\x7f]/g, '') // décompose puis retire les diacritiques/non-ASCII
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Dossier d'un événement : `{slug-du-nom}-{8 premiers car. de l'id}`. */
export function eventFolder(event: { id: string; name?: string | null }): string {
  const slug = slugify(event.name ?? '') || 'event';
  return `${slug}-${event.id.slice(0, 8)}`;
}
