// Client du stockage des médias (open core étape 2, lot S1) : R2 ou fournisseur compatible S3,
// selon les variables (voir storage-config.ts, partie pure et testée).

import { S3Client } from 'npm:@aws-sdk/client-s3';
import { storageClientConfig } from './storage-config.ts';

export {
  audioBucket, audioPublicBaseUrl, eventFolder, photosBucket, photosPublicBaseUrl, storageVarNames,
} from './storage-config.ts';

/** Client S3 du fournisseur configuré. Lève StorageConfigError si la configuration est incomplète. */
export function storageClient(): S3Client {
  return new S3Client(storageClientConfig());
}
