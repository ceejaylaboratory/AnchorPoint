import { URL } from 'url';
import { redis } from '../lib/redis';
import { RedisService } from './redis.service';
import {
  notifySep24StatusChange,
  type Sep24CallbackDeliveryResult,
  type Sep24CallbackNotifyInput,
} from './sep24CallbackNotifier';

const CALLBACK_KEY_PREFIX = 'sep24:callback:';
const CALLBACK_TTL_SECONDS = 24 * 60 * 60;

/**
 * Converts a Date (or date-like value) to a UTC Unix epoch timestamp in seconds.
 * Returns 0 for null/undefined/empty/invalid values per SEP-24 timestamp handling.
 */
export function toSep24Timestamp(date?: Date | string | number | null): number {
  if (date === null || date === undefined || date === '') return 0;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.floor(parsed.getTime() / 1000);
}

/**
 * Normalizes SEP-24 `started_at` / `completed_at` fields to integer Unix timestamps.
 */
function toSep24CallbackInputWithUnixTimestamps(input: Sep24CallbackNotifyInput): Sep24CallbackNotifyInput {
  const result = { ...input } as Record<string, unknown>;
  for (const key of ['started_at', 'completed_at'] as const) {
    if (key in result) {
      const value = result[key];
      result[key] = value === null || value === undefined || value === ''
        ? 0
        : toSep24Timestamp(value as Date | string | number);
    }
  }
  return result as unknown as Sep24CallbackNotifyInput;
}

export interface Sep24StoredCallback {
  callbackUrl: string;
  kind: 'deposit' | 'withdrawal';
  assetCode?: string;
  amount?: string;
  account?: string;
  claimableBalanceId?: string;
}

export type Sep24MemoType = 'text' | 'id' | 'hash';

export class Sep24Service {
  /**
   * Validates a Stellar transaction memo against the byte-length/format rules
   * for the given memo type (SEP-24 supports text, id, and hash memos).
   *
   * @param memo The memo value to validate.
   * @param memoType The memo type: 'text' (max 28 bytes UTF-8), 'id' (uint64), or 'hash' (32-byte hex).
   * @returns boolean true if the memo is valid for the given type.
   */
  public static validateMemo(memo: string, memoType: Sep24MemoType): boolean {
    if (!memo) return false;

    switch (memoType) {
      case 'text':
        return Buffer.byteLength(memo, 'utf8') <= 28;
      case 'id': {
        if (!/^\d+$/.test(memo)) return false;
        try {
          const value = BigInt(memo);
          return value >= BigInt(0) && value <= BigInt('18446744073709551615');
        } catch {
          return false;
        }
      }
      case 'hash':
        return /^[0-9a-fA-F]{64}$/.test(memo);
      default:
        return false;
    }
  }

  /**
   * Validates a callback or redirect URL against a whitelist of allowed domains.
   *
   * @param url The URL to validate.
   * @param allowedDomains Array of allowed hostnames (e.g., ['example.com']).
   * @returns boolean true if valid, false if invalid or not allowed.
   */
  public static validateCallbackUrl(url: string, allowedDomains: string[]): boolean {
    if (!url) return false;

    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return false;
      }

      if (!allowedDomains || allowedDomains.length === 0) {
        return true; // If no whitelist is defined, allow (or you can restrict default)
      }

      const hostname = parsedUrl.hostname.toLowerCase();

      return allowedDomains.some((domain) => {
        const d = domain.trim().toLowerCase();
        if (!d) return false;
        return hostname === d || hostname.endsWith(`.${d}`);
      });
    } catch {
      return false; // Invalid URL format
    }
  }

  /**
   * Persists the partner on_change_callback / callback URL for a SEP-24
   * interactive deposit or withdrawal (24h TTL in Redis).
   */
  public static async storeCallback(
    transactionId: string,
    data: Sep24StoredCallback,
    redisService: RedisService = new RedisService(redis as any)
  ): Promise<void> {
    await redisService.setJSON(`${CALLBACK_KEY_PREFIX}${transactionId}`, data, CALLBACK_TTL_SECONDS);
  }

  public static async getCallback(
    transactionId: string,
    redisService: RedisService = new RedisService(redis as any)
  ): Promise<Sep24StoredCallback | null> {
    return redisService.getJSON<Sep24StoredCallback>(`${CALLBACK_KEY_PREFIX}${transactionId}`);
  }

  /**
   * Notifies the partner callback for a SEP-24 deposit/withdrawal status change
   * using idempotent webhook delivery (Idempotency-Key + Redis dedup + retry queue).
   */
  public static async notifyStatusChange(
    input: Sep24CallbackNotifyInput
  ): Promise<Sep24CallbackDeliveryResult> {
    return notifySep24StatusChange(toSep24CallbackInputWithUnixTimestamps(input));
  }

  /**
   * Notifies the partner callback for a SEP-24 deposit using a claimable balance
   * with the claimable_balance_id required for redemption.
   */
  public static async notifyClaimableBalance(
    transactionId: string,
    claimableBalanceId: string,
    callbackUrlOverride?: string,
    redisService: RedisService = new RedisService(redis as any)
  ): Promise<Sep24CallbackDeliveryResult> {
    const stored = await this.getCallback(transactionId, redisService);
    const callbackUrl = callbackUrlOverride || stored?.callbackUrl;

    if (stored) {
      stored.claimableBalanceId = claimableBalanceId;
      await this.storeCallback(transactionId, stored, redisService);
    }

    if (!callbackUrl) {
      return {
        delivered: false,
        skipped: true,
        attempts: 0,
        idempotencyKey: `sep24:${transactionId}:claimable`,
        error: 'No callback URL configured',
      };
    }

    return notifySep24StatusChange({
      transactionId,
      kind: stored?.kind ?? 'deposit',
      previousStatus: 'pending_anchor',
      nextStatus: 'pending_external',
      callbackUrl,
      claimableBalanceId,
      amount: stored?.amount,
      assetCode: stored?.assetCode,
      event: 'sep24.transaction.claimable',
    });
  }
}