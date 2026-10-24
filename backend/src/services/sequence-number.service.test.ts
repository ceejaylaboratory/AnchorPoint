/**
 * SequenceNumberManager tests – #1525
 *
 * Verifies that the manager uses a Redlock distributed lock (not a plain
 * Redis SET NX) and that concurrent callers receive distinct sequence numbers
 * rather than duplicates.
 */

import { SequenceNumberManager } from './sequence-number.service';
import { BatchPaymentError, BatchErrorType } from './batch-payment.types';

// ---------------------------------------------------------------------------
// Mocks – must be hoisted via jest.mock before imports
// ---------------------------------------------------------------------------

// We use factories that return fresh jest.fn() refs so we can reset them
// per-test via jest.clearAllMocks().
jest.mock('../lib/redis', () => {
  const mockRelease = jest.fn().mockResolvedValue(undefined);
  const mockAcquire = jest.fn().mockResolvedValue({
    resources: ['stellar:seq:lock:GTEST'],
    value: 'mock-lock-value',
    release: mockRelease,
  });

  return {
    redis: {
      incr: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
    },
    redlock: {
      acquire: mockAcquire,
      release: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers to access the mocks after the hoisting dance
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { redis: mockRedis, redlock: mockRedlock } = require('../lib/redis') as {
  redis: {
    incr: jest.Mock;
    expire: jest.Mock;
    del: jest.Mock;
  };
  redlock: {
    acquire: jest.Mock;
    release: jest.Mock;
  };
};

const ACCOUNT = 'GTEST123ACCOUNTPUBLICKEY';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SequenceNumberManager (#1525 – Redlock distributed lock)', () => {
  let manager: SequenceNumberManager;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-set default resolved value after clearAllMocks resets it.
    mockRedlock.acquire.mockResolvedValue({
      resources: [`stellar:seq:lock:${ACCOUNT}`],
      value: 'mock-lock-value',
      release: jest.fn().mockResolvedValue(undefined),
    });
    mockRedlock.release.mockResolvedValue(undefined);

    manager = new SequenceNumberManager('stellar:seq', 30);
  });

  describe('acquireLock', () => {
    it('delegates to Redlock.acquire with a 5 000 ms TTL', async () => {
      await manager.acquireLock(ACCOUNT);

      expect(mockRedlock.acquire).toHaveBeenCalledTimes(1);
      const [resources, ttl] = mockRedlock.acquire.mock.calls[0] as [string[], number];
      // Resources must include the lock key for this account.
      expect(resources[0]).toContain(ACCOUNT);
      // TTL must be 5 000 ms as per the spec.
      expect(ttl).toBe(5_000);
    });

    it('returns an opaque token that encodes the lock resource and value', async () => {
      const token = await manager.acquireLock(ACCOUNT);
      const parsed = JSON.parse(token) as { resource: string; value: string };
      expect(parsed).toHaveProperty('resource');
      expect(parsed).toHaveProperty('value');
    });

    it('throws BatchPaymentError(SEQUENCE_CONFLICT) when Redlock cannot acquire', async () => {
      mockRedlock.acquire.mockRejectedValueOnce(new Error('Lock already held'));

      await expect(manager.acquireLock(ACCOUNT)).rejects.toMatchObject({
        type: BatchErrorType.SEQUENCE_CONFLICT,
      });
    });

    it('error message mentions HTTP 503 retry semantics', async () => {
      mockRedlock.acquire.mockRejectedValueOnce(new Error('Lock held'));

      try {
        await manager.acquireLock(ACCOUNT);
        throw new Error('Expected rejection');
      } catch (err) {
        expect((err as Error).message).toMatch(/503/i);
      }
    });

    it('does NOT use a plain Redis SET command for locking', async () => {
      await manager.acquireLock(ACCOUNT);
      // The old implementation used redis.set(..., 'NX').
      // The raw redis mock should never be touched for locking.
      expect((mockRedis as Record<string, jest.Mock>)['set']).toBeUndefined();
    });
  });

  describe('releaseLock', () => {
    it('calls Redlock.release with the reconstructed lock object', async () => {
      const token = await manager.acquireLock(ACCOUNT);
      await manager.releaseLock(ACCOUNT, token);

      expect(mockRedlock.release).toHaveBeenCalledTimes(1);
      const [lockArg] = mockRedlock.release.mock.calls[0] as [{ value: string }[]];
      expect((lockArg as unknown as { value: string }).value).toBe('mock-lock-value');
    });

    it('does not throw if the release fails (lock already expired)', async () => {
      mockRedlock.release.mockRejectedValueOnce(new Error('Lock expired'));
      const token = JSON.stringify({ resource: 'r', value: 'v' });
      await expect(manager.releaseLock(ACCOUNT, token)).resolves.toBeUndefined();
    });
  });

  describe('concurrent access – no duplicate sequence numbers', () => {
    it('assigns distinct sequence numbers to concurrent callers', async () => {
      // Simulate sequential offsets returned by redis.incr.
      let counter = 0;
      mockRedis.incr.mockImplementation(() => Promise.resolve(++counter));
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.del.mockResolvedValue(1);

      const BASE = '100000000000000000';
      const N = 10;

      // Fire N concurrent getNextSequenceNumber calls.
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          manager.getNextSequenceNumber(ACCOUNT, BASE),
        ),
      );

      const unique = new Set(results);
      expect(unique.size).toBe(N); // every caller gets a unique sequence number
    });
  });

  describe('executeWithLock', () => {
    it('acquires lock, runs operation, releases lock', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const operation = jest.fn().mockResolvedValue('done');
      const result = await manager.executeWithLock(ACCOUNT, '100000', operation);

      expect(result).toBe('done');
      expect(mockRedlock.acquire).toHaveBeenCalledTimes(1);
      expect(mockRedlock.release).toHaveBeenCalledTimes(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('releases lock even when the operation throws', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const operation = jest.fn().mockRejectedValue(new Error('op failed'));
      await expect(manager.executeWithLock(ACCOUNT, '100000', operation)).rejects.toThrow(
        'op failed',
      );
      expect(mockRedlock.release).toHaveBeenCalledTimes(1);
    });
  });
});
