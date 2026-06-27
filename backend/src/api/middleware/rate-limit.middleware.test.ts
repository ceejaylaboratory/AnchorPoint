import { Request, Response, NextFunction } from 'express';
import { submissionLimiterOptions } from './rate-limit.middleware';
import * as StellarSdk from '@stellar/stellar-sdk';

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    TransactionBuilder: {
      fromXDR: jest.fn(),
    },
  };
});

describe('Rate Limit Middleware', () => {
  describe('submissionLimiter keyGenerator', () => {
    let mockReq: Partial<Request>;

    beforeEach(() => {
      mockReq = {
        body: {},
        ip: '127.0.0.1',
      };
      jest.clearAllMocks();
    });

    it('should use source account from valid XDR', () => {
      const xdr = 'valid-xdr';
      mockReq.body = { xdr };
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue({ source: 'G_SOURCE' });

      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);
      expect(key).toBe('G_SOURCE');
      expect(StellarSdk.TransactionBuilder.fromXDR).toHaveBeenCalled();
    });

    it('should handle FeeBumpTransaction source account', () => {
      const xdr = 'feebump-xdr';
      mockReq.body = { xdr };
      const mockFeeBump = Object.create(StellarSdk.FeeBumpTransaction.prototype);
      Object.defineProperty(mockFeeBump, 'innerTransaction', { value: { source: 'G_INNER' } });


      
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockFeeBump);

      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);
      expect(key).toBe('G_INNER');
    });

    it('should fallback to IP if XDR is missing', () => {
      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);
      expect(key).toBe('127.0.0.1');
    });

    it('should fallback to IP if XDR parsing fails', () => {
      mockReq.body = { xdr: 'invalid' };
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockImplementation(() => {
        throw new Error('invalid');
      });

      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);

      expect(key).toBe('127.0.0.1');
    });

    it('should fallback to unknown if IP is missing', () => {
      (mockReq as any).ip = undefined;
      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);

      expect(key).toBe('unknown');
    });
  });

  describe('createRateLimiter', () => {
    it('should create a limiter with default options', () => {
      const { createRateLimiter } = require('./rate-limit.middleware');
      const limiter = createRateLimiter();
      expect(limiter).toBeDefined();
    });
  });

  describe('publicLimiter', () => {
    it('should export a shared public Redis-backed limiter', () => {
      const { publicLimiter } = require('./rate-limit.middleware');
      expect(publicLimiter).toBeDefined();
    });
  });
});


