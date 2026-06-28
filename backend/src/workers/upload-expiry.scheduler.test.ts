import { uploadExpiryScheduler } from './upload-expiry.scheduler';
import cron from 'node-cron';
import { uploadStore } from '../services/upload-store.service';
import logger from '../utils/logger';

jest.mock('node-cron', () => ({
  schedule: jest.fn().mockImplementation((sched, cb) => {
    cb();
    return {
      stop: jest.fn(),
    };
  }),
}));

jest.mock('../services/upload-store.service', () => ({
  uploadStore: {
    expireStale: jest.fn().mockReturnValue(3),
  },
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

describe('UploadExpiryScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts the scheduler and processes stale uploads', () => {
    uploadExpiryScheduler.start();
    expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
    expect(uploadStore.expireStale).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Expired 3 stale KYC upload records'));
  });

  it('stops the scheduler if running', () => {
    uploadExpiryScheduler.start();
    uploadExpiryScheduler.stop();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Upload expiry scheduler stopped'));
  });
});
