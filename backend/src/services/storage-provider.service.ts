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
