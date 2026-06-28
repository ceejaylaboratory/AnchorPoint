import logger from '../utils/logger';

/**
 * Provider-agnostic interface for cloud object storage.
 * Implementations exist for S3 and GCS; the mock is used in development/test.
 */
export interface StorageProvider {
  /** Generate a time-limited pre-signed PUT URL for the given storage key. */
  generatePresignedPutUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** Return true when the object at `key` exists in the bucket. */
  objectExists(key: string): Promise<boolean>;
}

/** Minimal in-memory mock used when STORAGE_PROVIDER is absent or 'mock'. */
export class MockStorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly uploadedKeys = new Set<string>();

  constructor(bucket = 'mock-bucket') {
    this.bucket = bucket;
  }

  async generatePresignedPutUrl(key: string, _contentType: string, _expiresInSeconds: number): Promise<string> {
    return `https://${this.bucket}.mock.storage/${key}?X-Mock-Signed=1`;
  }

  async objectExists(key: string): Promise<boolean> {
    return this.uploadedKeys.has(key);
  }

  /** Test helper: simulate a completed upload for a key. */
  _markUploaded(key: string): void {
    this.uploadedKeys.add(key);
  }
}

export const storageProvider: StorageProvider = new MockStorageProvider(
  process.env.STORAGE_BUCKET ?? 'mock-bucket'
);

export function validateStorageConfigOnStartup(): void {
  const provider = process.env.STORAGE_PROVIDER;
  if (!provider) {
    logger.error('STORAGE_PROVIDER environment variable is missing.');
    process.exit(1);
  }

  if (provider !== 's3' && provider !== 'gcs') {
    logger.error(`Invalid STORAGE_PROVIDER: "${provider}". Must be either 's3' or 'gcs'.`);
    process.exit(1);
  }

  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) {
    logger.error('STORAGE_BUCKET environment variable is missing.');
    process.exit(1);
  }

  if (provider === 's3') {
    const region = process.env.STORAGE_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey) {
      logger.error('Missing required S3 configuration keys (STORAGE_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).');
      process.exit(1);
    }
  } else if (provider === 'gcs') {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentials) {
      logger.error('Missing required GCS configuration key (GOOGLE_APPLICATION_CREDENTIALS).');
      process.exit(1);
    }
  }
}

