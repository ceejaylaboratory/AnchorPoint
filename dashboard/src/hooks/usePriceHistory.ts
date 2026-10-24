import { useState, useEffect } from 'react';

export interface PricePoint {
  timestamp: number;
  price: number;
}

interface UsePriceHistoryOptions {
  duration?: string; // e.g., '24h'
  refreshInterval?: number; // ms
}

const DEFAULT_DURATION = '24h';

export function usePriceHistory(
  sourceAsset: string,
  destinationAsset: string,
  options: UsePriceHistoryOptions = {},
): {
  data: PricePoint[] | null;
  loading: boolean;
  error: string | null;
} {
  const { duration = DEFAULT_DURATION, refreshInterval } = options;
  const [data, setData] = useState<PricePoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    // A new asset pair invalidates whatever was loaded for the previous one;
    // drop it so the chart shows a loading state instead of stale/blank data.
    setData(null);

    const fetchPriceHistory = async (background = false) => {
      // Background refreshes keep the current chart on screen.
      if (!background) setLoading(true);
      setError(null);
      try {
        const url = `/api/sep38/price-history?source_asset=${encodeURIComponent(sourceAsset)}&destination_asset=${encodeURIComponent(destinationAsset)}&duration=${encodeURIComponent(duration)}`;
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Failed to fetch price history: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (Array.isArray(result.data) === false) {
          throw new Error('Invalid response format: expected data array');
        }

        // Ensure data has timestamp and price fields
        const parsedData: PricePoint[] = result.data.map((item: any) => {
          return {
            timestamp: Number(item.timestamp),
            price: Number(item.price),
          };
        });

        if (isMounted) {
          setData(parsedData);
        }
      } catch (err) {
        if (isMounted && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPriceHistory();

    if (refreshInterval && refreshInterval > 0) {
      const intervalId = setInterval(() => fetchPriceHistory(true), refreshInterval);
      return () => {
        isMounted = false;
        clearInterval(intervalId);
        controller.abort();
      };
    }

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [sourceAsset, destinationAsset, duration, refreshInterval]);

  return { data, loading, error };
}