import { config } from './env';

export interface Sep38QuotesCacheConfig {
  indicativeQuoteExpirationSeconds: number;
  firmQuoteValiditySeconds: number;
  quoteCacheTtlSeconds: number;
  quoteCacheStaleTtlSeconds: number;
  assetsCacheTtlSeconds: number;
}

export const defaultSep38QuotesCacheConfig: Sep38QuotesCacheConfig = {
  indicativeQuoteExpirationSeconds: 60,
  firmQuoteValiditySeconds: 300,
  quoteCacheTtlSeconds: 30,
  quoteCacheStaleTtlSeconds: 30,
  assetsCacheTtlSeconds: 3600,
};

/**
 * Validates SEP-38 quote cache timeout settings.
 * Cache layers must not outlive indicative quote expiration.
 */
export function validateSep38QuotesCacheConfig(
  cacheConfig: Sep38QuotesCacheConfig,
): boolean {
  const {
    indicativeQuoteExpirationSeconds,
    firmQuoteValiditySeconds,
    quoteCacheTtlSeconds,
    quoteCacheStaleTtlSeconds,
    assetsCacheTtlSeconds,
  } = cacheConfig;

  if (
    indicativeQuoteExpirationSeconds < 15 ||
    indicativeQuoteExpirationSeconds > 300
  ) {
    return false;
  }

  if (firmQuoteValiditySeconds < 60 || firmQuoteValiditySeconds > 3600) {
    return false;
  }

  if (quoteCacheTtlSeconds < 5 || quoteCacheTtlSeconds > indicativeQuoteExpirationSeconds) {
    return false;
  }

  if (quoteCacheStaleTtlSeconds < 0) {
    return false;
  }

  if (quoteCacheTtlSeconds + quoteCacheStaleTtlSeconds > indicativeQuoteExpirationSeconds) {
    return false;
  }

  if (firmQuoteValiditySeconds < indicativeQuoteExpirationSeconds) {
    return false;
  }

  if (assetsCacheTtlSeconds < 60 || assetsCacheTtlSeconds > 86400) {
    return false;
  }

  return true;
}

export function getSep38QuotesCacheConfig(): Sep38QuotesCacheConfig {
  const cacheConfig: Sep38QuotesCacheConfig = {
    indicativeQuoteExpirationSeconds: config.SEP38_INDICATIVE_QUOTE_EXPIRATION_SECONDS,
    firmQuoteValiditySeconds: config.SEP38_FIRM_QUOTE_VALIDITY_SECONDS,
    quoteCacheTtlSeconds: config.SEP38_QUOTE_CACHE_TTL_SECONDS,
    quoteCacheStaleTtlSeconds: config.SEP38_QUOTE_CACHE_STALE_TTL_SECONDS,
    assetsCacheTtlSeconds: config.SEP38_ASSETS_CACHE_TTL_SECONDS,
  };

  if (!validateSep38QuotesCacheConfig(cacheConfig)) {
    throw new Error('Invalid SEP-38 quotes cache configuration');
  }

  return cacheConfig;
}

export function isQuoteExpired(quote: { expiration_time: number }, nowSeconds?: number): boolean {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return quote.expiration_time <= now;
}

export function buildQuoteExpirationTime(
  expirationSeconds: number,
  nowMs: number = Date.now(),
): number {
  return Math.floor(nowMs / 1000) + expirationSeconds;
}
