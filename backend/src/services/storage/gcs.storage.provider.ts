import { Storage } from '@google-cloud/storage';
import type { StorageProvider } from './storage.provider';

export class GcsStorageProvider implements StorageProvider {
  private storage: Storage;
  private bucketName: string;

  constructor(bucketName: string, storage?: Storage) {
    this.bucketName = bucketName;
    this.storage = storage ?? new Storage();
  }

  async getSignedUploadUrl(
    key: string,
    mimeType: string,
    expiresIn = 900,
  ): Promise<string> {
    const [url] = await this.storage
      .bucket(this.bucketName)
      .file(key)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresIn * 1000,
        contentType: mimeType,
      });
    return url;
  }
}
