/**
 * Sequence Number Manager
 * 
 * Manages Stellar account sequence numbers with Redlock distributed locking
 * to prevent conflicts across concurrent workers.
 */

import { redis, redlock } from '../lib/redis';
import logger from '../utils/logger';
import { BatchPaymentError, BatchErrorType } from './batch-payment.types';

/** Redlock lock TTL in milliseconds (5 seconds as specified in #1525). */
const LOCK_TTL_MS = 5_000;

/** How many times Redlock should retry before giving up (inherited from redlock instance config). */

type SequenceAccount = {
  sequenceNumber: () => string;
};

type HorizonSequenceServer = {
  loadAccount: (accountPublicKey: string) => Promise<SequenceAccount>;
};

export class SequenceNumberManager {
  private redisPrefix: string;
  private lockTimeout: number;

  constructor(redisPrefix: string = 'stellar:seq', lockTimeoutSeconds: number = 30) {
    this.redisPrefix = redisPrefix;
    this.lockTimeout = lockTimeoutSeconds;
  }

  /**
   * Acquire a Redlock distributed lock on the sequence number for a specific
   * account. Uses Redlock (not plain SET NX) so the lock is safe across
   * multiple Redis nodes and concurrent processes.
   *
   * Returns the raw lock token string so the caller can release it later.
   * Throws a BatchPaymentError with type SEQUENCE_CONFLICT and HTTP-503
   * semantics when the lock cannot be acquired after retries.
   */
  async acquireLock(accountPublicKey: string): Promise<string> {
    const lockKey = `${this.redisPrefix}:lock:${accountPublicKey}`;

    try {
      const lock = await redlock.acquire([lockKey], LOCK_TTL_MS);
      logger.debug(`Sequence lock acquired for account: ${accountPublicKey}`);
      // Encode the Redlock resource + value so releaseLock can reconstruct it.
      return JSON.stringify({ resource: lock.resources[0], value: lock.value });
    } catch (error) {
      logger.warn(
        `Failed to acquire distributed sequence lock for ${accountPublicKey}: ${error}`,
      );
      throw new BatchPaymentError(
        BatchErrorType.SEQUENCE_CONFLICT,
        `Service busy – could not acquire sequence lock for account: ${accountPublicKey}. ` +
          `Please retry (HTTP 503).`,
      );
    }
  }

  /**
   * Release the Redlock distributed lock.
   *
   * Accepts the opaque token returned by `acquireLock`. Safe to call even if
   * the lock has already expired – Redlock will simply no-op.
   */
  async releaseLock(accountPublicKey: string, lockToken: string): Promise<void> {
    try {
      const { resource, value } = JSON.parse(lockToken) as {
        resource: string;
        value: string;
      };
      // Reconstruct a minimal lock-shaped object that Redlock's release accepts.
      await redlock.release({ resources: [resource], value } as any);
      logger.debug(`Sequence lock released for account: ${accountPublicKey}`);
    } catch (error) {
      logger.error(`Error releasing sequence lock for ${accountPublicKey}: ${error}`);
      // Don't throw – lock will expire automatically via TTL.
    }
  }

  /**
   * Get the next sequence number for an account with atomic increment
   * This ensures concurrent workers get unique sequence numbers
   */
  async getNextSequenceNumber(accountPublicKey: string, currentSequence: string): Promise<string> {
    const seqKey = `${this.redisPrefix}:counter:${accountPublicKey}`;

    try {
      // Atomically increment and get the sequence number offset
      const offset = await redis.incr(seqKey);
      
      // Set expiry on the counter to prevent unbounded growth
      await redis.expire(seqKey, this.lockTimeout * 2);

      // Calculate actual sequence number
      const baseSequence = BigInt(currentSequence);
      const nextSequence = baseSequence + BigInt(offset);

      logger.debug(
        `Next sequence for ${accountPublicKey}: ${nextSequence} (offset: ${offset})`
      );

      return nextSequence.toString();
    } catch (error) {
      logger.error(`Error getting next sequence number: ${error}`);
      throw new BatchPaymentError(
        BatchErrorType.SEQUENCE_CONFLICT,
        `Failed to get next sequence number: ${error}`
      );
    }
  }

  /**
   * Reset the sequence counter for an account
   * Call this after successful transaction to sync with actual blockchain state
   */
  async resetSequenceCounter(accountPublicKey: string, newBaseSequence: string): Promise<void> {
    const seqKey = `${this.redisPrefix}:counter:${accountPublicKey}`;

    try {
      // Delete the counter - next request will start from 1
      await redis.del(seqKey);
      logger.debug(
        `Sequence counter reset for account: ${accountPublicKey} at base sequence ${newBaseSequence}`
      );
    } catch (error) {
      logger.error(`Error resetting sequence counter: ${error}`);
    }
  }

  /**
   * Fetch the current sequence number from the Stellar network
   */
  async fetchSequenceFromNetwork(
    accountPublicKey: string,
    horizonServer: HorizonSequenceServer
  ): Promise<string> {
    try {
      const account = await horizonServer.loadAccount(accountPublicKey);
      return account.sequenceNumber();
    } catch (error) {
      logger.error(`Failed to fetch sequence from network: ${error}`);
      throw new BatchPaymentError(
        BatchErrorType.NETWORK_ERROR,
        `Failed to load account from Stellar network: ${error}`
      );
    }
  }

  /**
   * Safely execute a sequence-number-sensitive operation with locking
   */
  async executeWithLock<T>(
    accountPublicKey: string,
    baseSequence: string,
    operation: (sequenceNumber: string) => Promise<T>
  ): Promise<T> {
    const lockValue = await this.acquireLock(accountPublicKey);

    try {
      const result = await operation(
        await this.getNextSequenceNumber(accountPublicKey, baseSequence)
      );
      return result;
    } finally {
      await this.releaseLock(accountPublicKey, lockValue);
    }
  }
}
