export interface StorageProvider {
  generatePresignedPutUrl(key: string, contentType: string, expiresIn: number): Promise<string>;
  objectExists(key: string): Promise<boolean>;
}
