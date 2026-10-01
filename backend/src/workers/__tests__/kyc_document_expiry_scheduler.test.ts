import cron from 'node-cron';
import { kycDocumentExpiryScheduler } from '../kyc_document_expiry_scheduler';
import { processKycExpirationGracePeriod } from '../../services/kyc.service';
import logger from '../../utils/logger';

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../../services/kyc.service', () => ({
  processKycExpirationGracePeriod: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

describe('KycDocumentExpiryScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    kycDocumentExpiryScheduler.stop();
  });

  describe('start', () => {
    it('should schedule a daily task at midnight', () => {
      kycDocumentExpiryScheduler.start();
      expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
      expect(logger.info).toHaveBeenCalledWith(
        'KYC document expiry scheduler started (running daily at midnight for 30-day notice)'
      );
    });

    it('should execute processKycExpirationGracePeriod with 30 days threshold when triggered', async () => {
      let scheduledCallback: Function = () => {};
      (cron.schedule as jest.Mock).mockImplementation((expression, callback) => {
        scheduledCallback = callback;
        return { stop: jest.fn() };
      });

      (processKycExpirationGracePeriod as jest.Mock).mockResolvedValue(5);

      kycDocumentExpiryScheduler.start();
      
      // Trigger the callback manually
      await scheduledCallback();

      expect(processKycExpirationGracePeriod).toHaveBeenCalledWith(30);
      expect(logger.info).toHaveBeenCalledWith('Processed 30-day KYC document expiration for 5 customers');
    });

    it('should handle errors gracefully during execution', async () => {
      let scheduledCallback: Function = () => {};
      (cron.schedule as jest.Mock).mockImplementation((expression, callback) => {
        scheduledCallback = callback;
        return { stop: jest.fn() };
      });

      const mockError = new Error('Database connection failed');
      (processKycExpirationGracePeriod as jest.Mock).mockRejectedValue(mockError);

      kycDocumentExpiryScheduler.start();
      
      // Trigger the callback manually
      await scheduledCallback();

      expect(logger.error).toHaveBeenCalledWith('Failed to run KYC document 30-day expiry task', {
        error: mockError.message,
      });
    });
  });

  describe('stop', () => {
    it('should stop the scheduled task if it exists', () => {
      const mockStop = jest.fn();
      (cron.schedule as jest.Mock).mockReturnValue({ stop: mockStop });

      kycDocumentExpiryScheduler.start();
      kycDocumentExpiryScheduler.stop();

      expect(mockStop).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('KYC document expiry scheduler stopped');
    });

    it('should not throw if stopping without starting', () => {
      expect(() => kycDocumentExpiryScheduler.stop()).not.toThrow();
      expect(logger.info).toHaveBeenCalledWith('KYC document expiry scheduler stopped');
    });
  });
});
