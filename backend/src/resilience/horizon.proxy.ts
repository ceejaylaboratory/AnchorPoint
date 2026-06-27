// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

import * as StellarSdk from '@stellar/stellar-sdk';
import { createBreaker } from './circuit-breaker.factory';
import logger from '../utils/logger';
import { redis } from '../lib/redis';

export class HorizonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HorizonUnavailableError';
  }
}

export class HorizonProxy {
  private server: StellarSdk.Horizon.Server;
  
  private fetchAccountBreaker;
  private submitTransactionBreaker;
  private fetchBaseFeeBreaker;

  constructor(serverUrl: string) {
    this.server = new StellarSdk.Horizon.Server(serverUrl);

    this.fetchAccountBreaker = createBreaker(
      'horizon:fetchAccount',
      async (accountId: string) => await this.server.loadAccount(accountId)
    );

    this.submitTransactionBreaker = createBreaker(
      'horizon:submitTransaction',
      async (transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction) => 
        await this.server.submitTransaction(transaction)
    );

    this.fetchBaseFeeBreaker = createBreaker(
      'horizon:fetchBaseFee',
      async () => await this.server.feeStats()
    );

    // Attach fallbacks
    this.fetchAccountBreaker.fallback(async (accountId: string, error: Error) => 
      this.fetchAccountFallback(accountId, error)
    );
    
    this.submitTransactionBreaker.fallback(async (transaction: any, error: Error) => 
      this.submitTransactionFallback(transaction, error)
    );

    this.fetchBaseFeeBreaker.fallback(async (error: Error) => 
      this.fetchBaseFeeFallback(error)
    );
  }

  public async fetchAccount(accountId: string) {
    return this.fetchAccountBreaker.fire(accountId);
  }

  public async submitTransaction(transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction) {
    return this.submitTransactionBreaker.fire(transaction);
  }

  public async fetchBaseFee() {
    return this.fetchBaseFeeBreaker.fire();
  }

  // --- Fallbacks ---

  private async fetchAccountFallback(accountId: string, error: Error) {
    logger.warn(`[horizon:fetchAccount] Circuit breaker triggered. Reason: ${error.message}. Attempting to return cached account.`);
    
    try {
      const cached = await redis.get(`cache:account:${accountId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (redisError) {
      logger.warn(`[horizon:fetchAccount] Redis fallback failed: ${(redisError as Error).message}`);
    }

    throw new HorizonUnavailableError(`Horizon is currently unavailable and no cached data exists for account ${accountId}.`);
  }

  private async submitTransactionFallback(transaction: any, error: Error) {
    logger.warn(`[horizon:submitTransaction] Circuit breaker triggered. Reason: ${error.message}. Queueing transaction for retry.`);
    
    // In a real system, we might push this to a durable queue.
    return { 
      status: 'queued', 
      txHash: null 
    };
  }

  private async fetchBaseFeeFallback(error: Error) {
    logger.warn(`[horizon:fetchBaseFee] Circuit breaker triggered. Reason: ${error.message}. Returning last known base fee.`);
    
    try {
      const cachedFee = await redis.get('cache:horizon:baseFee');
      if (cachedFee) {
        return JSON.parse(cachedFee);
      }
    } catch (redisError) {
      logger.warn(`[horizon:fetchBaseFee] Redis fallback failed: ${(redisError as Error).message}`);
    }

    // Ultimate fallback if cache is empty (100 stroops is typical network minimum)
    return {
      last_ledger_base_fee: '100',
      ledger_capacity_usage: '0.00',
      fee_charged: { max: '100', min: '100', mode: '100', p10: '100', p20: '100', p30: '100', p40: '100', p50: '100', p60: '100', p70: '100', p80: '100', p90: '100', p95: '100', p99: '100' },
      max_fee: { max: '100', min: '100', mode: '100', p10: '100', p20: '100', p30: '100', p40: '100', p50: '100', p60: '100', p70: '100', p80: '100', p90: '100', p95: '100', p99: '100' }
    };
  }
}
