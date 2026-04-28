/**
 * Sequence Number Manager
 * 
 * Manages Stellar account sequence numbers with Redis-based locking
 * to prevent conflicts across concurrent workers.
 */

import { AccountResponse } from '@stellar/stellar-sdk';
import { redis } from '../lib/redis';
import logger from '../utils/logger';
import { BatchPaymentError, BatchErrorType } from './batch-payment.types';

export class SequenceNumberManager {
  private redisPrefix: string;
  private lockTimeout: number;

  constructor(redisPrefix: string = 'stellar:seq', lockTimeoutSeconds: number = 30) {
    this.redisPrefix = redisPrefix;
    this.lockTimeout = lockTimeoutSeconds;
  }

  /**
   * Acquire a lock on the sequence number for a specific account
   * This prevents concurrent workers from using the same sequence number
   */
  async acquireLock(accountPublicKey: string): Promise<string> {
    const lockKey = `${this.redisPrefix}:lock:${accountPublicKey}`;
    const lockValue = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      // SET with NX (only if not exists) and EX (expiry)
      const result = await redis.set(lockKey, lockValue, 'EX', this.lockTimeout, 'NX');

      if (result === 'OK') {
        logger.debug(`Sequence lock acquired for account: ${accountPublicKey}`);
        return lockValue;
      }

      throw new BatchPaymentError(
        BatchErrorType.SEQUENCE_CONFLICT,
        `Failed to acquire sequence lock for account: ${accountPublicKey}. Another worker is processing.`
      );
    } catch (error) {
      if (error instanceof BatchPaymentError) {
        throw error;
      }
      logger.error(`Error acquiring sequence lock: ${error}`);
      throw new BatchPaymentError(
        BatchErrorType.SEQUENCE_CONFLICT,
        `Redis error while acquiring lock: ${error}`
      );
    }
  }

  /**
   * Release the sequence number lock
   */
  async releaseLock(accountPublicKey: string, lockValue: string): Promise<void> {
    const lockKey = `${this.redisPrefix}:lock:${accountPublicKey}`;

    try {
      // Only release if we still hold the lock (compare lockValue)
      const currentLock = await redis.get(lockKey);
      if (currentLock === lockValue) {
        await redis.del(lockKey);
        logger.debug(`Sequence lock released for account: ${accountPublicKey}`);
      }
    } catch (error) {
      logger.error(`Error releasing sequence lock: ${error}`);
      // Don't throw - lock will expire automatically
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
      logger.debug(`Sequence counter reset for account: ${accountPublicKey}`);
    } catch (error) {
      logger.error(`Error resetting sequence counter: ${error}`);
    }
  }

  /**
   * Fetch the current sequence number from the Stellar network
   */
  async fetchSequenceFromNetwork(
    accountPublicKey: string,
    horizonServer: any
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
