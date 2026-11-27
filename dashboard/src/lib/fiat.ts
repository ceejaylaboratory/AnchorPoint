/**
 * Fiat display currency support: the supported set, fallback FX rates, rate
 * fetching from the backend FX service (SEP-40 `/sep40/rates`), and
 * Intl-based formatting. All dashboard values are held in USD and converted
 * only for display.
 */

export const SUPPORTED_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'BRL'] as const;

export type FiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number];

export const DEFAULT_FIAT_CURRENCY: FiatCurrency = 'USD';

export const FIAT_CURRENCY_LABELS: Record<FiatCurrency, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  NGN: 'Nigerian Naira',
  BRL: 'Brazilian Real',
};

/** Units of each currency per 1 USD. Used until (or if) live rates load. */
export const FALLBACK_USD_RATES: Record<FiatCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  NGN: 1540,
  BRL: 5.1,
};

export type FiatRates = Record<FiatCurrency, number>;

export const isSupportedFiat = (code: unknown): code is FiatCurrency =>
  typeof code === 'string' && (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(code);

export const convertFromUsd = (usdAmount: number, currency: FiatCurrency, rates: FiatRates): number =>
  usdAmount * (rates[currency] ?? FALLBACK_USD_RATES[currency] ?? 1);

/**
 * Formats an amount already expressed in `currency`. Symbol placement,
 * separators and minor-unit digits follow the locale's conventions for that
 * currency.
 */
export const formatFiat = (amount: number, currency: FiatCurrency, locale?: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);

interface Sep40RatesResponse {
  rates?: { sell_asset?: string; buy_asset?: string; rate?: number | string }[];
}

/**
 * Pulls USD→fiat rates from the backend FX service. Currencies the service
 * does not price (or prices nonsensically) keep their fallback rate, so the
 * result is always complete. `live` lists the currencies that came back live.
 */
export async function fetchFiatRates(
  apiBaseUrl: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ rates: FiatRates; live: FiatCurrency[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const targets = SUPPORTED_FIAT_CURRENCIES.filter((c) => c !== 'USD');

  const res = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/sep40/rates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs: targets.map((c) => ({ sell_asset: 'USD', buy_asset: c })) }),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`FX rate request failed with HTTP ${res.status}`);

  const body = (await res.json()) as Sep40RatesResponse;
  const rates: FiatRates = { ...FALLBACK_USD_RATES };
  const live: FiatCurrency[] = ['USD'];

  for (const entry of body.rates ?? []) {
    const rate = Number(entry.rate);
    if (entry.sell_asset !== 'USD' || !isSupportedFiat(entry.buy_asset)) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rates[entry.buy_asset] = rate;
    live.push(entry.buy_asset);
  }

  return { rates, live };
}
