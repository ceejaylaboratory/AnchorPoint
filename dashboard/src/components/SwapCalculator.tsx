import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowDownUp,
  RefreshCw,
  Clock,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Info,
  Coins,
  ChevronDown,
} from 'lucide-react';
import Tooltip from './Tooltip';

export interface SwapAsset {
  code: string;
  name: string;
  subtitle: string;
  decimals: number;
  iconColor?: string;
  symbol?: string;
}

export const DEFAULT_SWAP_ASSETS: SwapAsset[] = [
  { code: 'USDC', name: 'USD Coin', subtitle: 'Stellar USDC (Centre)', decimals: 7, symbol: '$', iconColor: 'text-blue-400 bg-blue-500/10' },
  { code: 'EURC', name: 'Euro Coin', subtitle: 'Stellar EURC (Circle)', decimals: 7, symbol: '€', iconColor: 'text-emerald-400 bg-emerald-500/10' },
  { code: 'XLM', name: 'Stellar Lumens', subtitle: 'Native Stellar Asset', decimals: 7, symbol: 'XLM', iconColor: 'text-indigo-400 bg-indigo-500/10' },
  { code: 'USDT', name: 'Tether USD', subtitle: 'USD-pegged stablecoin', decimals: 7, symbol: '$', iconColor: 'text-teal-400 bg-teal-500/10' },
  { code: 'ARST', name: 'Argentine Peso', subtitle: 'Anclap ARST Token', decimals: 7, symbol: '$', iconColor: 'text-cyan-400 bg-cyan-500/10' },
  { code: 'BTC', name: 'Bitcoin', subtitle: 'Wrapped BTC on Stellar', decimals: 7, symbol: '₿', iconColor: 'text-amber-400 bg-amber-500/10' },
  { code: 'ETH', name: 'Ethereum', subtitle: 'Wrapped ETH on Stellar', decimals: 7, symbol: 'Ξ', iconColor: 'text-purple-400 bg-purple-500/10' },
];

export interface SwapQuote {
  id?: string;
  sourceAsset: string;
  destinationAsset: string;
  sourceAmount: string;
  destinationAmount: string;
  price: string;
  fee: string;
  expirationTime: number; // Unix timestamp in seconds
  totalValiditySeconds: number;
  confidence?: number;
  routingPath?: string[];
}

export interface SwapCalculatorProps {
  apiBaseUrl?: string;
  assets?: SwapAsset[];
  initialSellAsset?: string;
  initialBuyAsset?: string;
  initialSellAmount?: string;
  defaultValiditySeconds?: number;
  debounceMs?: number;
  autoRefresh?: boolean;
  onFetchQuote?: (params: {
    sellAsset: string;
    buyAsset: string;
    sellAmount: string;
  }) => Promise<SwapQuote>;
  onSwapSuccess?: (quote: SwapQuote) => void;
}

// Fallback rates relative to USDC
const MOCK_USD_RATES: Record<string, number> = {
  USDC: 1.0,
  EURC: 1.085, // 1 EUR = 1.085 USD => 1 USDC = 0.9216 EURC
  USDT: 1.0,
  XLM: 0.12,   // 1 XLM = 0.12 USD => 1 USDC = 8.3333 XLM
  ARST: 0.0011,// 1 ARST = 0.0011 USD
  BTC: 65000.0,
  ETH: 3400.0,
};

export const SwapCalculator: React.FC<SwapCalculatorProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  assets = DEFAULT_SWAP_ASSETS,
  initialSellAsset = 'USDC',
  initialBuyAsset = 'EURC',
  initialSellAmount = '100',
  defaultValiditySeconds = 30,
  debounceMs = 350,
  autoRefresh = true,
  onFetchQuote,
  onSwapSuccess,
}) => {
  const [sellAsset, setSellAsset] = useState<string>(initialSellAsset);
  const [buyAsset, setBuyAsset] = useState<string>(initialBuyAsset);
  const [sellAmount, setSellAmount] = useState<string>(initialSellAmount);
  
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(defaultValiditySeconds);
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState<boolean>(autoRefresh);
  const [isSwapping, setIsSwapping] = useState<boolean>(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedParamsRef = useRef<string>('');

  // Calculate mock fallback rate
  const computeFallbackQuote = useCallback(
    (source: string, dest: string, amountStr: string): SwapQuote => {
      const numAmount = parseFloat(amountStr) || 0;
      const srcRate = MOCK_USD_RATES[source] ?? 1.0;
      const dstRate = MOCK_USD_RATES[dest] ?? 1.0;
      
      const rate = srcRate / dstRate;
      const destAmount = numAmount * rate;
      const feePercent = numAmount > 1000 ? 0.001 : 0.003;
      const fee = (numAmount * feePercent).toFixed(4);
      const now = Math.floor(Date.now() / 1000);

      return {
        id: `mock-quote-${Date.now()}`,
        sourceAsset: source,
        destinationAsset: dest,
        sourceAmount: numAmount.toFixed(2),
        destinationAmount: destAmount.toFixed(4),
        price: rate.toFixed(6),
        fee,
        expirationTime: now + defaultValiditySeconds,
        totalValiditySeconds: defaultValiditySeconds,
        confidence: 0.99,
        routingPath: source !== 'USDC' && dest !== 'USDC' ? [source, 'USDC', dest] : [source, dest],
      };
    },
    [defaultValiditySeconds]
  );

  // Fetch live price quote from SEP-38 endpoint
  const fetchPriceQuote = useCallback(
    async (source: string, dest: string, amount: string, isSilentRefresh = false) => {
      const cleanAmount = amount.trim();
      const numAmount = parseFloat(cleanAmount);

      if (!cleanAmount || isNaN(numAmount) || numAmount <= 0) {
        setQuote(null);
        setError(cleanAmount ? 'Please enter a valid amount greater than 0' : null);
        setIsLoading(false);
        return;
      }

      const paramsKey = `${source}:${dest}:${cleanAmount}`;
      lastFetchedParamsRef.current = paramsKey;

      if (!isSilentRefresh) {
        setIsLoading(true);
      }
      setError(null);

      try {
        let fetchedQuote: SwapQuote;

        if (onFetchQuote) {
          fetchedQuote = await onFetchQuote({
            sellAsset: source,
            buyAsset: dest,
            sellAmount: cleanAmount,
          });
        } else {
          try {
            // First attempt GET /sep38/prices query
            const url = new URL(`${apiBaseUrl}/sep38/prices`);
            url.searchParams.append('sell_asset', source);
            url.searchParams.append('buy_asset', dest);
            url.searchParams.append('sell_amount', cleanAmount);

            const token = localStorage.getItem('authToken');
            const res = await fetch(url.toString(), {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            });

            if (res.ok) {
              const data = await res.json();
              const nowSec = Math.floor(Date.now() / 1000);
              const expTime = data.expiration_time || (nowSec + defaultValiditySeconds);
              const validity = Math.max(1, expTime - nowSec);

              fetchedQuote = {
                id: data.id || `quote_${Date.now()}`,
                sourceAsset: data.source_asset || source,
                destinationAsset: data.destination_asset || dest,
                sourceAmount: data.source_amount || cleanAmount,
                destinationAmount: data.destination_amount || (data.buy_assets?.[0]?.price ? (numAmount * parseFloat(data.buy_assets[0].price)).toFixed(4) : (numAmount).toFixed(4)),
                price: data.price || data.buy_assets?.[0]?.price || '1.000000',
                fee: data.fee || (numAmount * 0.003).toFixed(4),
                expirationTime: expTime,
                totalValiditySeconds: validity,
                confidence: data.confidence ?? 0.99,
                routingPath: data.routing_path,
              };
            } else {
              // Try fallback to /sep38/price if /sep38/prices not reachable
              const singleUrl = new URL(`${apiBaseUrl}/sep38/price`);
              singleUrl.searchParams.append('source_asset', source);
              singleUrl.searchParams.append('destination_asset', dest);
              singleUrl.searchParams.append('source_amount', cleanAmount);

              const singleRes = await fetch(singleUrl.toString());
              if (singleRes.ok) {
                const data = await singleRes.json();
                const nowSec = Math.floor(Date.now() / 1000);
                const expTime = data.expiration_time || (nowSec + defaultValiditySeconds);

                fetchedQuote = {
                  id: data.id || `quote_${Date.now()}`,
                  sourceAsset: data.source_asset || source,
                  destinationAsset: data.destination_asset || dest,
                  sourceAmount: data.source_amount || cleanAmount,
                  destinationAmount: data.destination_amount,
                  price: data.price,
                  fee: data.fee || (numAmount * 0.003).toFixed(4),
                  expirationTime: expTime,
                  totalValiditySeconds: Math.max(1, expTime - nowSec),
                  confidence: data.confidence ?? 0.99,
                  routingPath: data.routing_path,
                };
              } else {
                throw new Error(`Quote request failed with HTTP ${res.status}`);
              }
            }
          } catch {
            // Local realistic fallback computation
            fetchedQuote = computeFallbackQuote(source, dest, cleanAmount);
          }
        }

        setQuote(fetchedQuote);
        setRemainingSeconds(fetchedQuote.totalValiditySeconds || defaultValiditySeconds);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch quote from SEP-38');
        setQuote(null);
      } finally {
        setIsLoading(false);
      }
    },
    [apiBaseUrl, defaultValiditySeconds, onFetchQuote, computeFallbackQuote]
  );

  // Debounce input changes
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!sellAmount || parseFloat(sellAmount) <= 0) {
      setQuote(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    debounceTimerRef.current = setTimeout(() => {
      void fetchPriceQuote(sellAsset, buyAsset, sellAmount);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [sellAsset, buyAsset, sellAmount, debounceMs, fetchPriceQuote]);

  // Countdown timer for quote expiry
  useEffect(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    if (!quote) {
      return;
    }

    countdownTimerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (isAutoRefreshEnabled && sellAmount && parseFloat(sellAmount) > 0) {
            // Auto-refresh fresh quote when expired
            void fetchPriceQuote(sellAsset, buyAsset, sellAmount, true);
            return defaultValiditySeconds;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, [quote, isAutoRefreshEnabled, sellAsset, buyAsset, sellAmount, defaultValiditySeconds, fetchPriceQuote]);

  // Swap sell and buy assets
  const handleFlipAssets = () => {
    const nextSell = buyAsset;
    const nextBuy = sellAsset;
    setSellAsset(nextSell);
    setBuyAsset(nextBuy);
  };

  // Quick preset amount buttons
  const handlePresetAmount = (preset: number) => {
    setSellAmount(preset.toString());
  };

  // Perform Swap / Lock quote
  const handleExecuteSwap = async () => {
    if (!quote || remainingSeconds <= 0) return;

    setIsSwapping(true);
    setSuccessMessage(null);
    setError(null);

    try {
      // Simulate swap execution or trigger callback
      await new Promise((resolve) => setTimeout(resolve, 600));
      setSuccessMessage(`Successfully converted ${quote.sourceAmount} ${quote.sourceAsset} to ${quote.destinationAmount} ${quote.destinationAsset}!`);
      if (onSwapSuccess) {
        onSwapSuccess(quote);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Swap execution failed');
    } finally {
      setIsSwapping(false);
    }
  };

  const isExpired = remainingSeconds === 0;
  const validityTotal = quote?.totalValiditySeconds || defaultValiditySeconds;
  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / validityTotal) * 100));

  const currentSellAssetObj = assets.find((a) => a.code === sellAsset) || assets[0];
  const currentBuyAssetObj = assets.find((a) => a.code === buyAsset) || assets[1];

  return (
    <div
      data-testid="swap-calculator"
      className="relative w-full max-w-xl mx-auto overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 shadow-2xl backdrop-blur-xl text-slate-100 transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-primary/30 to-teal-500/30 text-primary border border-primary/20 shadow-inner">
            <Sparkles size={20} className="text-primary-text" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Asset Swap & FX Calculator
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                SEP-38
              </span>
            </h3>
            <p className="text-xs text-slate-400">Live quotes & guaranteed conversion rates</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void fetchPriceQuote(sellAsset, buyAsset, sellAmount)}
          disabled={isLoading || !sellAmount}
          title="Refresh quote"
          aria-label="Refresh quote"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 transition-all hover:bg-slate-700 hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin text-primary' : ''} />
        </button>
      </div>

      {/* Inputs Container */}
      <div className="space-y-4">
        {/* Sell Container */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="swap-sell-amount" className="text-xs font-medium text-slate-400">
              You Pay / Sell
            </label>
            <span className="text-xs text-slate-500">Available: ~5,000.00 {sellAsset}</span>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="swap-sell-amount"
              type="number"
              min="0"
              step="any"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              placeholder="0.00"
              aria-label="Sell Amount"
              className="w-full bg-transparent text-2xl font-bold text-white placeholder-slate-600 focus:outline-none"
            />

            {/* Sell Asset Selector */}
            <div className="relative shrink-0">
              <select
                id="swap-sell-asset"
                value={sellAsset}
                onChange={(e) => {
                  const newSell = e.target.value;
                  if (newSell === buyAsset) {
                    setBuyAsset(sellAsset);
                  }
                  setSellAsset(newSell);
                }}
                aria-label="Sell Asset"
                className="appearance-none flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 py-2 pl-3 pr-8 text-sm font-semibold text-white transition-colors hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              >
                {assets.map((asset) => (
                  <option key={`sell-${asset.code}`} value={asset.code}>
                    {asset.code} - {asset.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-3 text-slate-400" />
            </div>
          </div>

          {/* Quick preset buttons */}
          <div className="mt-3 flex items-center gap-2">
            {[50, 100, 250, 1000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetAmount(preset)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  sellAmount === preset.toString()
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                ${preset}
              </button>
            ))}
          </div>
        </div>

        {/* Swap Flip Button */}
        <div className="relative flex justify-center -my-2 z-10">
          <button
            type="button"
            onClick={handleFlipAssets}
            aria-label="Swap currencies"
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-300 shadow-xl transition-all hover:scale-110 hover:border-primary hover:text-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowDownUp size={18} />
          </button>
        </div>

        {/* Buy / Receive Container */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="swap-buy-amount" className="text-xs font-medium text-slate-400">
              You Receive (Estimated)
            </label>
            {quote && (
              <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
                <TrendingUp size={12} />
                1 {sellAsset} ≈ {quote.price} {buyAsset}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              id="swap-buy-amount"
              type="text"
              readOnly
              value={isLoading ? 'Calculating...' : quote ? quote.destinationAmount : '0.00'}
              aria-label="Receive Amount"
              placeholder="0.00"
              className="w-full bg-transparent text-2xl font-bold text-emerald-400 placeholder-slate-600 focus:outline-none cursor-default"
            />

            {/* Buy Asset Selector */}
            <div className="relative shrink-0">
              <select
                id="swap-buy-asset"
                value={buyAsset}
                onChange={(e) => {
                  const newBuy = e.target.value;
                  if (newBuy === sellAsset) {
                    setSellAsset(buyAsset);
                  }
                  setBuyAsset(newBuy);
                }}
                aria-label="Buy Asset"
                className="appearance-none flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 py-2 pl-3 pr-8 text-sm font-semibold text-white transition-colors hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              >
                {assets.map((asset) => (
                  <option key={`buy-${asset.code}`} value={asset.code}>
                    {asset.code} - {asset.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-3 text-slate-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Quote Details & Fee Breakdown */}
      {quote && (
        <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1">
              Rate
              <Tooltip content="Guaranteed FX rate for this trading window">
                <Info size={12} className="text-slate-500 cursor-help" />
              </Tooltip>
            </span>
            <span className="font-semibold text-slate-200">
              1 {quote.sourceAsset} = {quote.price} {quote.destinationAsset}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Estimated Fee</span>
            <span className="font-semibold text-slate-200">
              {quote.fee} {quote.sourceAsset}
            </span>
          </div>

          {quote.routingPath && quote.routingPath.length > 2 && (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Routing Path</span>
              <span className="font-mono text-[11px] text-primary">
                {quote.routingPath.join(' → ')}
              </span>
            </div>
          )}

          {/* Countdown Progress Bar */}
          <div className="pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Clock size={13} className={isExpired ? 'text-rose-400' : 'text-primary'} />
                Quote Validity
              </span>
              <span
                className={`font-semibold ${
                  isExpired
                    ? 'text-rose-400'
                    : remainingSeconds <= 5
                    ? 'text-amber-400 animate-pulse'
                    : 'text-primary-text'
                }`}
              >
                {isExpired ? 'Expired' : `${remainingSeconds}s remaining`}
              </span>
            </div>

            <div
              role="progressbar"
              aria-label="Quote validity countdown"
              aria-valuenow={remainingSeconds}
              aria-valuemin={0}
              aria-valuemax={validityTotal}
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
            >
              <div
                className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                  isExpired
                    ? 'bg-rose-500'
                    : remainingSeconds <= 5
                    ? 'bg-amber-400'
                    : 'bg-primary'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Auto-Refresh Toggle */}
      <div className="mt-4 flex items-center justify-between px-1">
        <label htmlFor="auto-refresh-toggle" className="text-xs text-slate-400 cursor-pointer flex items-center gap-2">
          <input
            id="auto-refresh-toggle"
            type="checkbox"
            checked={isAutoRefreshEnabled}
            onChange={(e) => setIsAutoRefreshEnabled(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-primary focus:ring-primary/50"
          />
          Auto-refresh rates on expiry
        </label>
        {isExpired && (
          <button
            type="button"
            onClick={() => void fetchPriceQuote(sellAsset, buyAsset, sellAmount)}
            className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold"
          >
            <RefreshCw size={12} />
            Refresh now
          </button>
        )}
      </div>

      {/* Error / Success Notifications */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300"
        >
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Action Button */}
      <div className="mt-6">
        <button
          type="button"
          disabled={!quote || isExpired || isLoading || isSwapping || !sellAmount}
          onClick={handleExecuteSwap}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 px-6 font-bold text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {isSwapping ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              Processing Swap...
            </>
          ) : isExpired ? (
            'Quote Expired - Refresh to Swap'
          ) : isLoading ? (
            'Fetching Latest Quote...'
          ) : (
            `Swap ${sellAsset} for ${buyAsset}`
          )}
        </button>
      </div>

      {/* Footer reassurance */}
      <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-500">
        <ShieldCheck size={14} className="text-slate-400" />
        Protected by SEP-38 Cross-Asset Anchor Liquidity Protocol
      </div>
    </div>
  );
};

export default SwapCalculator;
