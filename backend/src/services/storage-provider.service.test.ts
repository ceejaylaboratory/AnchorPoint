import { MockStorageProvider, storageProvider } from './storage-provider.service';

describe('storage-provider.service', () => {
  describe('MockStorageProvider', () => {
    let mockProvider: MockStorageProvider;

    beforeEach(() => {
      mockProvider = new MockStorageProvider('test-mock-bucket');
    });

    it('should generate mock presigned URL', async () => {
      const url = await mockProvider.generatePresignedPutUrl('test-key', 'image/png', 3600);
      expect(url).toBe('https://test-mock-bucket.mock.storage/test-key?X-Mock-Signed=1');
    });

    it('should correctly check if object exists', async () => {
      expect(await mockProvider.objectExists('test-key')).toBe(false);
      mockProvider._markUploaded('test-key');
      expect(await mockProvider.objectExists('test-key')).toBe(true);
    });

    it('should use default mock bucket name if not specified', () => {
      const defaultProvider = new MockStorageProvider();
      expect(defaultProvider).toBeDefined();
    });
  });

  describe('default storageProvider instance', () => {
    it('should be defined', () => {
      expect(storageProvider).toBeDefined();
    });
  });
});
