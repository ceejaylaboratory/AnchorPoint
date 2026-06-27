import {
  createStorageProvider,
  GcsStorageProvider,
  MockStorageProvider,
  S3StorageProvider,
  StorageProviderError,
  storageConfigFromEnv,
  validateStorageProviderConfig,
} from './storage-provider.service';

describe('StorageProvider initialization', () => {
  describe('validateStorageProviderConfig', () => {
    it('accepts a valid mock configuration', () => {
      expect(validateStorageProviderConfig({ provider: 'mock', bucket: 'test-bucket' })).toEqual({
        provider: 'mock',
        bucket: 'test-bucket',
        region: undefined,
      });
    });

    it('accepts a valid S3 configuration', () => {
      expect(
        validateStorageProviderConfig({ provider: 's3', bucket: 'kyc-bucket', region: 'us-east-1' })
      ).toEqual({
        provider: 's3',
        bucket: 'kyc-bucket',
        region: 'us-east-1',
      });
    });

    it('accepts a valid GCS configuration', () => {
      expect(validateStorageProviderConfig({ provider: 'gcs', bucket: 'kyc-bucket' })).toEqual({
        provider: 'gcs',
        bucket: 'kyc-bucket',
        region: undefined,
      });
    });

    it('rejects missing provider', () => {
      expect(() => validateStorageProviderConfig({ bucket: 'b' })).toThrow(StorageProviderError);
      expect(() => validateStorageProviderConfig({ bucket: 'b' })).toThrow('STORAGE_PROVIDER is required');
    });

    it('rejects unsupported provider', () => {
      expect(() =>
        validateStorageProviderConfig({ provider: 'azure' as 'mock', bucket: 'b' })
      ).toThrow('Unsupported STORAGE_PROVIDER: azure');
    });

    it('rejects missing bucket', () => {
      expect(() => validateStorageProviderConfig({ provider: 'mock', bucket: '' })).toThrow(
        'STORAGE_BUCKET is required'
      );
    });

    it('rejects S3 configuration without region', () => {
      expect(() => validateStorageProviderConfig({ provider: 's3', bucket: 'b' })).toThrow(
        'STORAGE_REGION is required for S3'
      );
    });
  });

  describe('createStorageProvider', () => {
    it('creates a mock provider with mock configuration', () => {
      const provider = createStorageProvider({ provider: 'mock', bucket: 'dev-bucket' });
      expect(provider).toBeInstanceOf(MockStorageProvider);
    });

    it('creates an S3 provider when region is supplied', () => {
      const provider = createStorageProvider({
        provider: 's3',
        bucket: 'prod-bucket',
        region: 'eu-west-1',
      });
      expect(provider).toBeInstanceOf(S3StorageProvider);
    });

    it('creates a GCS provider with bucket only', () => {
      const provider = createStorageProvider({ provider: 'gcs', bucket: 'gcs-bucket' });
      expect(provider).toBeInstanceOf(GcsStorageProvider);
    });

    it('fails early when bucket is missing', () => {
      expect(() => createStorageProvider({ provider: 'mock', bucket: '  ' })).toThrow(
        StorageProviderError
      );
    });
  });

  describe('storageConfigFromEnv', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('defaults to mock provider in test environments', () => {
      process.env = { ...originalEnv };
      delete process.env.STORAGE_PROVIDER;
      delete process.env.STORAGE_BUCKET;

      expect(storageConfigFromEnv()).toEqual({
        provider: 'mock',
        bucket: 'mock-bucket',
        region: undefined,
      });
    });

    it('parses S3 environment variables', () => {
      process.env = {
        ...originalEnv,
        STORAGE_PROVIDER: 's3',
        STORAGE_BUCKET: 'anchor-kyc',
        STORAGE_REGION: 'us-west-2',
      };

      expect(storageConfigFromEnv()).toEqual({
        provider: 's3',
        bucket: 'anchor-kyc',
        region: 'us-west-2',
      });
    });
  });

  describe('MockStorageProvider', () => {
    it('generates mock presigned URLs and tracks uploaded keys', async () => {
      const provider = new MockStorageProvider('unit-test-bucket');
      const url = await provider.generatePresignedPutUrl('kyc/doc.pdf', 'application/pdf', 900);

      expect(url).toContain('unit-test-bucket.mock.storage');
      expect(url).toContain('kyc/doc.pdf');
      expect(await provider.objectExists('kyc/doc.pdf')).toBe(false);

      provider._markUploaded('kyc/doc.pdf');
      expect(await provider.objectExists('kyc/doc.pdf')).toBe(true);
    });

    it('rejects empty bucket at construction', () => {
      expect(() => new MockStorageProvider('')).toThrow('STORAGE_BUCKET is required');
    });
  });
});
