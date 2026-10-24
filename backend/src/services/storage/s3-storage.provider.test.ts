import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageProvider } from './s3-storage.provider';
import { UploadStorageError } from '../upload-store.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
  HeadObjectCommand: jest.fn().mockImplementation((args) => args),
  PutObjectCommand: jest.fn().mockImplementation((args) => args),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const s3Error = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

describe('S3StorageProvider (storage/)', () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new S3StorageProvider();
  });

  describe('objectExists', () => {
    it('returns true when HEAD succeeds', async () => {
      mockSend.mockResolvedValue({});
      await expect(provider.objectExists('kyc/a.pdf')).resolves.toBe(true);
    });

    it('returns false when the object is missing', async () => {
      mockSend.mockRejectedValue(s3Error('NotFound', 404));
      await expect(provider.objectExists('kyc/a.pdf')).resolves.toBe(false);
    });

    it('propagates an S3 permission error as UploadStorageError', async () => {
      const accessDenied = s3Error('AccessDenied', 403);
      mockSend.mockRejectedValue(accessDenied);

      const error = await provider.objectExists('kyc/a.pdf').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UploadStorageError);
      expect(error).toMatchObject({
        code: 'storage_provider_error',
        operation: 'objectExists',
        originalError: accessDenied,
      });
    });
  });

  describe('generatePresignedPutUrl', () => {
    it('returns the signed URL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://bucket.s3.amazonaws.com/key?sig');
      await expect(provider.generatePresignedPutUrl('key', 'image/png', 900)).resolves.toBe(
        'https://bucket.s3.amazonaws.com/key?sig'
      );
    });

    it('propagates credential failures as UploadStorageError', async () => {
      const credentialsError = Object.assign(new Error('Could not load credentials from any providers'), {
        name: 'CredentialsProviderError',
      });
      (getSignedUrl as jest.Mock).mockRejectedValue(credentialsError);

      await expect(provider.generatePresignedPutUrl('key', 'image/png', 900)).rejects.toMatchObject({
        name: 'UploadStorageError',
        operation: 'generatePresignedPutUrl',
        originalError: credentialsError,
      });
    });
  });
});
