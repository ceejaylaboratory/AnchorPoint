import { validateStorageConfigOnStartup } from './storage-provider.service';
import logger from '../utils/logger';

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('validateStorageConfigOnStartup', () => {
  const originalEnv = process.env;
  let exitMock: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    exitMock = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    (logger.error as jest.Mock).mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    exitMock.mockRestore();
  });

  it('fails if STORAGE_PROVIDER is missing', () => {
    delete process.env.STORAGE_PROVIDER;
    validateStorageConfigOnStartup();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('STORAGE_PROVIDER environment variable is missing'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('fails if STORAGE_PROVIDER is invalid', () => {
    process.env.STORAGE_PROVIDER = 'invalid-provider';
    validateStorageConfigOnStartup();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid STORAGE_PROVIDER: "invalid-provider"'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('fails if STORAGE_BUCKET is missing', () => {
    process.env.STORAGE_PROVIDER = 's3';
    delete process.env.STORAGE_BUCKET;
    validateStorageConfigOnStartup();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('STORAGE_BUCKET environment variable is missing'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('fails if S3 keys are missing', () => {
    process.env.STORAGE_PROVIDER = 's3';
    process.env.STORAGE_BUCKET = 'my-bucket';
    delete process.env.STORAGE_REGION;
    validateStorageConfigOnStartup();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Missing required S3 configuration keys'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('fails if GCS credentials are missing', () => {
    process.env.STORAGE_PROVIDER = 'gcs';
    process.env.STORAGE_BUCKET = 'my-bucket';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    validateStorageConfigOnStartup();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Missing required GCS configuration key'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('succeeds for valid S3 config', () => {
    process.env.STORAGE_PROVIDER = 's3';
    process.env.STORAGE_BUCKET = 'my-bucket';
    process.env.STORAGE_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    validateStorageConfigOnStartup();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('succeeds for valid GCS config', () => {
    process.env.STORAGE_PROVIDER = 'gcs';
    process.env.STORAGE_BUCKET = 'my-bucket';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/key.json';
    validateStorageConfigOnStartup();
    expect(exitMock).not.toHaveBeenCalled();
  });
});
