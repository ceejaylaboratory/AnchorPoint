import { StorageProvider } from './storage.provider';
import { UploadStorageError } from './upload-store.service';
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

    it('should propagate a generic unexpected error as UploadStorageError', async () => {
      const genericError = new Error('S3 connection timed out');
      (mockS3Client.send as jest.Mock).mockRejectedValue(genericError);

      await expect(storageProvider.objectExists('error-file.pdf')).rejects.toMatchObject({
        name: 'UploadStorageError',
        code: 'storage_provider_error',
        operation: 'objectExists',
        originalError: genericError,
      });
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should propagate an S3 permission error instead of reporting the object as missing', async () => {
      const accessDenied = Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      (mockS3Client.send as jest.Mock).mockRejectedValue(accessDenied);

      await expect(storageProvider.objectExists('kyc/file.pdf')).rejects.toBeInstanceOf(UploadStorageError);
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
