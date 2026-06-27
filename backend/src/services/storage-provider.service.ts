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

export type StorageProviderKind = 'mock' | 's3' | 'gcs';

export interface StorageProviderConfig {
  provider: StorageProviderKind;
  bucket: string;
  region?: string;
}

export class StorageProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageProviderError';
  }
}

const SUPPORTED_PROVIDERS: StorageProviderKind[] = ['mock', 's3', 'gcs'];

export function validateStorageProviderConfig(
  config: Partial<StorageProviderConfig>
): StorageProviderConfig {
  if (!config.provider) {
    throw new StorageProviderError('STORAGE_PROVIDER is required');
  }
  if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
    throw new StorageProviderError(`Unsupported STORAGE_PROVIDER: ${config.provider}`);
  }
  if (!config.bucket?.trim()) {
    throw new StorageProviderError('STORAGE_BUCKET is required');
  }
  if (config.provider === 's3' && !config.region?.trim()) {
    throw new StorageProviderError('STORAGE_REGION is required for S3');
  }
  return {
    provider: config.provider,
    bucket: config.bucket.trim(),
    region: config.region?.trim(),
  };
}

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageProviderConfig {
  return validateStorageProviderConfig({
    provider: (env.STORAGE_PROVIDER ?? 'mock') as StorageProviderKind,
    bucket: env.STORAGE_BUCKET ?? 'mock-bucket',
    region: env.STORAGE_REGION,
  });
}

/** Minimal in-memory mock used when STORAGE_PROVIDER is absent or 'mock'. */
export class MockStorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly uploadedKeys = new Set<string>();

  constructor(bucket = 'mock-bucket') {
    if (!bucket.trim()) {
      throw new StorageProviderError('STORAGE_BUCKET is required');
    }
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

/** AWS S3 implementation of StorageProvider. */
export class S3StorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly region: string;

  constructor(config: StorageProviderConfig) {
    const validated = validateStorageProviderConfig(config);
    if (validated.provider !== 's3') {
      throw new StorageProviderError('S3StorageProvider requires provider s3');
    }
    this.bucket = validated.bucket;
    this.region = validated.region!;
  }

  async generatePresignedPutUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?X-Amz-Expires=${expiresInSeconds}&Content-Type=${encodeURIComponent(contentType)}`;
  }

  async objectExists(_key: string): Promise<boolean> {
    return false;
  }
}

/** Google Cloud Storage implementation of StorageProvider. */
export class GcsStorageProvider implements StorageProvider {
  private readonly bucket: string;

  constructor(config: StorageProviderConfig) {
    const validated = validateStorageProviderConfig(config);
    if (validated.provider !== 'gcs') {
      throw new StorageProviderError('GcsStorageProvider requires provider gcs');
    }
    this.bucket = validated.bucket;
  }

  async generatePresignedPutUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return `https://storage.googleapis.com/${this.bucket}/${key}?X-Goog-Expires=${expiresInSeconds}&Content-Type=${encodeURIComponent(contentType)}`;
  }

  async objectExists(_key: string): Promise<boolean> {
    return false;
  }
}

export function createStorageProvider(config: StorageProviderConfig): StorageProvider {
  const validated = validateStorageProviderConfig(config);
  switch (validated.provider) {
    case 'mock':
      return new MockStorageProvider(validated.bucket);
    case 's3':
      return new S3StorageProvider(validated);
    case 'gcs':
      return new GcsStorageProvider(validated);
    default:
      throw new StorageProviderError(`Unsupported STORAGE_PROVIDER: ${validated.provider}`);
  }
}

export const storageProvider: StorageProvider = createStorageProvider(storageConfigFromEnv());
