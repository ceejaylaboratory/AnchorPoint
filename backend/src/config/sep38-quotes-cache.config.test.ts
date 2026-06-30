import {
  buildQuoteExpirationTime,
  defaultSep38QuotesCacheConfig,
  isQuoteExpired,
  validateSep38QuotesCacheConfig,
} from './sep38-quotes-cache.config';

describe('SEP-38 quotes cache configuration', () => {
  it('accepts the default cache timeout settings', () => {
    expect(validateSep38QuotesCacheConfig(defaultSep38QuotesCacheConfig)).toBe(true);
  });

  it('rejects cache TTL that exceeds indicative quote expiration', () => {
    expect(
      validateSep38QuotesCacheConfig({
        ...defaultSep38QuotesCacheConfig,
        quoteCacheTtlSeconds: 90,
      }),
    ).toBe(false);
  });

  it('rejects stale TTL that pushes total cache lifetime past quote expiration', () => {
    expect(
      validateSep38QuotesCacheConfig({
        ...defaultSep38QuotesCacheConfig,
        quoteCacheStaleTtlSeconds: 45,
      }),
    ).toBe(false);
  });

  it('rejects firm quote validity shorter than indicative expiration', () => {
    expect(
      validateSep38QuotesCacheConfig({
        ...defaultSep38QuotesCacheConfig,
        firmQuoteValiditySeconds: 30,
      }),
    ).toBe(false);
  });

  it('detects expired quotes by expiration_time', () => {
    const now = 1_700_000_000;

    expect(isQuoteExpired({ expiration_time: now - 1 }, now)).toBe(true);
    expect(isQuoteExpired({ expiration_time: now }, now)).toBe(true);
    expect(isQuoteExpired({ expiration_time: now + 1 }, now)).toBe(false);
  });

  it('builds quote expiration timestamps from configured seconds', () => {
    const nowMs = 1_700_000_000_000;

    expect(buildQuoteExpirationTime(60, nowMs)).toBe(Math.floor(nowMs / 1000) + 60);
  });
});
