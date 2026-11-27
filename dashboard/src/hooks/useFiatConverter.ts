import { useCallback, useEffect, useState } from 'react';
import { usePreferencesStore } from '../store/walletStore';
import {
  DEFAULT_FIAT_CURRENCY,
  FALLBACK_USD_RATES,
  convertFromUsd as convert,
  fetchFiatRates,
  formatFiat,
  isSupportedFiat,
  type FiatCurrency,
  type FiatRates,
} from '../lib/fiat';

export interface UseFiatConverterOptions {
  /** Backend base URL. Without it the converter uses fallback rates only. */
  apiBaseUrl?: string;
  /** How often to refresh live rates; 0 disables polling. Default 60s. */
  refreshMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export interface UseFiatConverterResult {
  selectedCurrency: FiatCurrency;
  setSelectedCurrency: (code: string) => void;
  rates: FiatRates;
  /** True once the selected currency's rate came from the live FX service. */
  isLive: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  convertFromUsd: (usdAmount: number) => number;
  /** Converts a USD amount and formats it in the selected currency. */
  formatAmount: (usdAmount: number) => string;
}

/**
 * Display-currency conversion for USD-denominated values. The chosen currency
 * is persisted in the preferences store; rates come from the backend FX
 * service and fall back to static rates when it is unreachable.
 */
export function useFiatConverter(options: UseFiatConverterOptions = {}): UseFiatConverterResult {
  const { apiBaseUrl, refreshMs = 60_000, fetchImpl } = options;

  const stored = usePreferencesStore((s) => s.preferences.fiatCurrency);
  const setFiatCurrency = usePreferencesStore((s) => s.setFiatCurrency);
  const selectedCurrency: FiatCurrency = isSupportedFiat(stored) ? stored : DEFAULT_FIAT_CURRENCY;

  const [rates, setRates] = useState<FiatRates>(FALLBACK_USD_RATES);
  const [liveCurrencies, setLiveCurrencies] = useState<FiatCurrency[]>(['USD']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!apiBaseUrl) return;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setIsLoading(true);
      try {
        const result = await fetchFiatRates(apiBaseUrl, { fetchImpl, signal: current.signal });
        if (current.signal.aborted) return;
        setRates(result.rates);
        setLiveCurrencies(result.live);
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (current.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load exchange rates');
      } finally {
        if (!current.signal.aborted) setIsLoading(false);
      }
    };

    void load();
    const timer = refreshMs > 0 ? setInterval(() => void load(), refreshMs) : null;
    return () => {
      controller?.abort();
      if (timer) clearInterval(timer);
    };
  }, [apiBaseUrl, refreshMs, fetchImpl]);

  const setSelectedCurrency = useCallback(
    (code: string) => {
      if (isSupportedFiat(code)) setFiatCurrency(code);
    },
    [setFiatCurrency],
  );

  const convertFromUsd = useCallback(
    (usdAmount: number) => convert(usdAmount, selectedCurrency, rates),
    [selectedCurrency, rates],
  );

  const formatAmount = useCallback(
    (usdAmount: number) => formatFiat(convert(usdAmount, selectedCurrency, rates), selectedCurrency),
    [selectedCurrency, rates],
  );

  return {
    selectedCurrency,
    setSelectedCurrency,
    rates,
    isLive: liveCurrencies.includes(selectedCurrency),
    isLoading,
    error,
    lastUpdated,
    convertFromUsd,
    formatAmount,
  };
}
