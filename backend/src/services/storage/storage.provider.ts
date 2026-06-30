export interface StorageProvider {
  /**
   * Generate a signed URL for uploading a file directly to storage.
   * @param key        Object key / path within the bucket
   * @param mimeType   Content-Type the client will upload with
   * @param expiresIn  URL validity in seconds (default 900)
   */
  getSignedUploadUrl(key: string, mimeType: string, expiresIn?: number): Promise<string>;
}
