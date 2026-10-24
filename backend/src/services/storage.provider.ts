import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import logger from '../utils/logger';
import { UploadStorageError, isStorageNotFoundError } from './upload-store.service';

/**
 * StorageProvider handles operations related to object storage (e.g. AWS S3 / MinIO).
 */
export class StorageProvider {
  private s3Client: S3Client;
  private bucketName: string;

  /**
   * Constructs the StorageProvider.
   *
   * @param bucketName - The name of the S3 bucket to query (defaults to environment variable AWS_BUCKET_NAME or 'anchorpoint-kyc-files')
   * @param s3Client - An optional pre-configured S3Client instance (useful for testing/dependency injection)
   */
  constructor(bucketName?: string, s3Client?: S3Client) {
    this.bucketName = bucketName || process.env.AWS_BUCKET_NAME || 'anchorpoint-kyc-files';
    this.s3Client = s3Client || new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT,
      forcePathStyle: process.env.AWS_FORCE_PATH_STYLE === 'true',
    });
  }

  /**
   * Verifies if an object exists in the storage bucket using a light metadata query (HEAD request).
   * Does NOT download file content.
   * A missing object resolves to false. Any other S3 failure (e.g. AccessDenied
   * from misconfigured credentials, network errors) is rethrown as an
   * {@link UploadStorageError} so callers do not mistake it for a missing upload.
   *
   * @param key - The key (path) of the object in S3.
   * @returns A promise that resolves to true if the object exists, or false if it does not.
   * @throws {UploadStorageError} When S3 fails for a reason other than "not found".
   */
  public async objectExists(key: string): Promise<boolean> {
    if (!key) {
      logger.warn('StorageProvider.objectExists called with an empty or undefined key');
      return false;
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      logger.info(`Object confirmed to exist: ${key}`);
      return true;
    } catch (error: unknown) {
      if (isStorageNotFoundError(error)) {
        logger.info(`Object not found in storage (graceful check): ${key}`);
        return false;
      }

      logger.error(`Error querying object metadata for key "${key}":`, error);
      throw new UploadStorageError('objectExists', error);
    }
  }
}
