import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_USD_RATES,
  convertFromUsd,
  fetchFiatRates,
  formatFiat,
  isSupportedFiat,
} from './fiat';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('fiat conversion', () => {
  it('converts USD amounts with the given rate table', () => {
    const rates = { ...FALLBACK_USD_RATES, EUR: 0.9, NGN: 1600 };
    expect(convertFromUsd(100, 'USD', rates)).toBe(100);
    expect(convertFromUsd(100, 'EUR', rates)).toBeCloseTo(90);
    expect(convertFromUsd(2.5, 'NGN', rates)).toBeCloseTo(4000);
  });

  it('recognises only the supported currencies', () => {
    expect(isSupportedFiat('BRL')).toBe(true);
    expect(isSupportedFiat('JPY')).toBe(false);
    expect(isSupportedFiat(undefined)).toBe(false);
  });

  it('formats with locale-appropriate symbols and separators', () => {
    expect(formatFiat(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatFiat(1234.5, 'GBP', 'en-GB')).toBe('£1,234.50');
    expect(formatFiat(1234.5, 'EUR', 'de-DE')).toMatch(/^1\.234,50\s€$/);
    expect(formatFiat(1234.5, 'BRL', 'pt-BR')).toMatch(/^R\$\s1\.234,50$/);
    expect(formatFiat(1234.5, 'NGN', 'en-NG')).toContain('₦');
  });
});

describe('fetchFiatRates', () => {
  it('requests USD pairs from the FX service and applies returned rates', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rates: [
          { sell_asset: 'USD', buy_asset: 'EUR', rate: 0.91 },
          { sell_asset: 'USD', buy_asset: 'NGN', rate: '1612.5' },
        ],
      }),
    ) as unknown as typeof fetch;

    const { rates, live } = await fetchFiatRates('http://api.test/', { fetchImpl });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://api.test/sep40/rates');
    expect(JSON.parse(init.body).pairs).toEqual([
      { sell_asset: 'USD', buy_asset: 'EUR' },
      { sell_asset: 'USD', buy_asset: 'GBP' },
      { sell_asset: 'USD', buy_asset: 'NGN' },
      { sell_asset: 'USD', buy_asset: 'BRL' },
    ]);
    expect(rates.EUR).toBe(0.91);
    expect(rates.NGN).toBe(1612.5);
    expect(rates.GBP).toBe(FALLBACK_USD_RATES.GBP);
    expect(live).toEqual(['USD', 'EUR', 'NGN']);
  });

  it('ignores unsupported, non-USD and non-positive entries', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rates: [
          { sell_asset: 'USD', buy_asset: 'JPY', rate: 150 },
          { sell_asset: 'EUR', buy_asset: 'GBP', rate: 0.85 },
          { sell_asset: 'USD', buy_asset: 'BRL', rate: 0 },
        ],
      }),
    ) as unknown as typeof fetch;

    const { rates, live } = await fetchFiatRates('http://api.test', { fetchImpl });
    expect(rates).toEqual(FALLBACK_USD_RATES);
    expect(live).toEqual(['USD']);
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await expect(fetchFiatRates('http://api.test', { fetchImpl })).rejects.toThrow(/HTTP 500/);
  });
});
