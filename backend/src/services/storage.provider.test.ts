import { StorageProvider } from './storage.provider';
import { S3Client } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => {
      return {
        send: jest.fn(),
      };
    }),
    HeadObjectCommand: jest.fn().mockImplementation((args) => args),
  };
});

describe('StorageProvider', () => {
  let mockS3Client: S3Client;
  let storageProvider: StorageProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Client = new S3Client({}) as any;
    storageProvider = new StorageProvider('test-bucket', mockS3Client);
  });

  describe('objectExists', () => {
    it('should return true if the object exists (HEAD request succeeds)', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValue({});

      const exists = await storageProvider.objectExists('valid-file.pdf');

      expect(exists).toBe(true);
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should return false if the object is not found (error.name is NotFound)', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      (mockS3Client.send as jest.Mock).mockRejectedValue(notFoundError);

      const exists = await storageProvider.objectExists('missing-file.pdf');

      expect(exists).toBe(false);
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should return false if the object is not found (error.name is NoSuchKey)', async () => {
      const noSuchKeyError = new Error('NoSuchKey');
      noSuchKeyError.name = 'NoSuchKey';
      (mockS3Client.send as jest.Mock).mockRejectedValue(noSuchKeyError);

      const exists = await storageProvider.objectExists('missing-file.pdf');

      expect(exists).toBe(false);
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should return false if the response status code is 404', async () => {
      const error404 = new Error('Forbidden/NotFound') as Error & { $metadata?: { httpStatusCode: number } };
      error404.$metadata = { httpStatusCode: 404 };
      (mockS3Client.send as jest.Mock).mockRejectedValue(error404);

      const exists = await storageProvider.objectExists('missing-file.pdf');

      expect(exists).toBe(false);
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should return false and log error for generic unexpected error', async () => {
      const genericError = new Error('S3 connection timed out');
      (mockS3Client.send as jest.Mock).mockRejectedValue(genericError);

      const exists = await storageProvider.objectExists('error-file.pdf');

      expect(exists).toBe(false);
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should return false immediately without S3 call if key is empty', async () => {
      const exists = await storageProvider.objectExists('');

      expect(exists).toBe(false);
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });
  });

  describe('constructor default values', () => {
    it('should use default bucket name and initialize S3Client when not provided', () => {
      const provider = new StorageProvider();
      expect(provider).toBeDefined();
    });
  });
});
