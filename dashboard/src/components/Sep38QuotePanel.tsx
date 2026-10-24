import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Info, RefreshCw, CheckCircle2, AlertCircle, ArrowRightLeft } from 'lucide-react';
import Tooltip from './Tooltip';

export type QuoteType = 'fixed' | 'indicative';

export interface Sep38Quote {
  id: string;
  price: string;
  sellAmount: string;
  buyAmount: string;
  sellAsset: string;
  buyAsset: string;
  quoteType: QuoteType;
  expiresAt: string;
  totalDurationSeconds: number;
}

export interface Sep38QuotePanelProps {
  apiBaseUrl?: string;
  initialValiditySeconds?: number;
  onFetchQuote?: (params: {
    sellAmount: string;
    buyAmount: string;
    quoteType: QuoteType;
    sellAsset?: string;
    buyAsset?: string;
  }) => Promise<Sep38Quote>;
  onSubmitQuote?: (quote: Sep38Quote) => Promise<void>;
  autoRefresh?: boolean;
}

export const Sep38QuotePanel: React.FC<Sep38QuotePanelProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  initialValiditySeconds = 30,
  onFetchQuote,
  onSubmitQuote,
  autoRefresh = true,
}) => {
  const [quoteType, setQuoteType] = useState<QuoteType>('fixed');
  const [sellAmount, setSellAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  // Asset pair is fixed for this panel; only the amounts are editable.
  const [sellAsset] = useState('USDC');
  const [buyAsset] = useState('USD');

  const [quote, setQuote] = useState<Sep38Quote | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialValiditySeconds);
  const [totalValiditySeconds, setTotalValiditySeconds] = useState<number>(initialValiditySeconds);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const EXPIRY_WARNING_SECONDS = 30;
  const showExpiryWarning = quote !== null && remainingSeconds <= EXPIRY_WARNING_SECONDS && remainingSeconds > 0;

  const trackQuoteRefreshed = useCallback((reason: 'expiry' | 'manual' | 'warning') => {
    try {
      window.dispatchEvent(
        new CustomEvent('anchor:analytics', {
          detail: { event: 'quote_refreshed', reason, timestamp: new Date().toISOString() },
        }),
      );
    } catch {
      // Analytics must never break the quote flow.
    }
  }, []);

  const lastRequestedParams = useRef<{
    sellAmount: string;
    buyAmount: string;
    quoteType: QuoteType;
    sellAsset: string;
    buyAsset: string;
  } | null>(null);

  // Helper to fetch or compute quote
  const executeFetchQuote = useCallback(
    async (isBackgroundRefresh = false, refreshReason: 'expiry' | 'manual' | 'warning' = 'expiry') => {
      const currentSell = sellAmount.trim();
      const currentBuy = buyAmount.trim();

      if (!currentSell && !currentBuy) {
        setError('Please enter a sell or receive amount to request a quote');
        return;
      }

      setError(null);
      setSuccessMessage(null);

      if (isBackgroundRefresh) {
        setIsRefreshing(true);
      } else {
        setIsFetching(true);
      }

      try {
        let fetchedQuote: Sep38Quote;

        if (onFetchQuote) {
          fetchedQuote = await onFetchQuote({
            sellAmount: currentSell,
            buyAmount: currentBuy,
            quoteType,
            sellAsset,
            buyAsset,
          });
        } else {
          // Attempt API call if endpoint exists, otherwise fallback to local calculation
          try {
            const token = localStorage.getItem('authToken');
            const res = await fetch(`${apiBaseUrl}/sep38/quote`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                sell_amount: currentSell || undefined,
                buy_amount: currentBuy || undefined,
                sell_asset: sellAsset,
                buy_asset: buyAsset,
                context: quoteType,
              }),
            });

            if (res.ok) {
              const data = await res.json();
              const validity = initialValiditySeconds;
              fetchedQuote = {
                id: data.id || `quote_${Date.now()}`,
                price: data.price || '1.00',
                sellAmount: data.sell_amount || currentSell || '100.00',
                buyAmount: data.buy_amount || currentBuy || '100.00',
                sellAsset: data.sell_asset || sellAsset,
                buyAsset: data.buy_asset || buyAsset,
                quoteType,
                expiresAt: data.expires_at || new Date(Date.now() + validity * 1000).toISOString(),
                totalDurationSeconds: validity,
              };
            } else {
              throw new Error(`Quote request failed with status ${res.status}`);
            }
          } catch {
            // Local realistic mock conversion
            const rate = quoteType === 'fixed' ? 0.9985 : 1.0;
            const numericSell = parseFloat(currentSell) || (parseFloat(currentBuy) ? parseFloat(currentBuy) / rate : 100);
            const numericBuy = parseFloat(currentBuy) || numericSell * rate;
            const duration = initialValiditySeconds;

            fetchedQuote = {
              id: `quote_${Date.now().toString(36)}`,
              price: rate.toFixed(4),
              sellAmount: numericSell.toFixed(2),
              buyAmount: numericBuy.toFixed(2),
              sellAsset,
              buyAsset,
              quoteType,
              expiresAt: new Date(Date.now() + duration * 1000).toISOString(),
              totalDurationSeconds: duration,
            };
          }
        }

        setQuote(fetchedQuote);
        setSellAmount(fetchedQuote.sellAmount);
        setBuyAmount(fetchedQuote.buyAmount);
        setTotalValiditySeconds(fetchedQuote.totalDurationSeconds || initialValiditySeconds);
        setRemainingSeconds(fetchedQuote.totalDurationSeconds || initialValiditySeconds);

        if (isBackgroundRefresh) {
          trackQuoteRefreshed(refreshReason);
        }

        lastRequestedParams.current = {
          sellAmount: fetchedQuote.sellAmount,
          buyAmount: fetchedQuote.buyAmount,
          quoteType: fetchedQuote.quoteType,
          sellAsset: fetchedQuote.sellAsset,
          buyAsset: fetchedQuote.buyAsset,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to retrieve quote');
      } finally {
        setIsFetching(false);
        setIsRefreshing(false);
      }
    },
    [sellAmount, buyAmount, quoteType, sellAsset, buyAsset, onFetchQuote, apiBaseUrl, initialValiditySeconds, trackQuoteRefreshed]
  );

  // Countdown timer effect
  useEffect(() => {
    if (!quote || isRefreshing || isFetching) {
      return;
    }

    if (remainingSeconds <= 0) {
      // Check if inputs have not changed
      const last = lastRequestedParams.current;
      const inputsUnchanged =
        last !== null &&
        last.sellAmount === sellAmount &&
        last.buyAmount === buyAmount &&
        last.quoteType === quoteType &&
        last.sellAsset === sellAsset &&
        last.buyAsset === buyAsset;

      if (autoRefresh && inputsUnchanged) {
        executeFetchQuote(true);
      }
      return;
    }

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [quote, remainingSeconds, isRefreshing, isFetching, autoRefresh, executeFetchQuote, sellAmount, buyAmount, quoteType, sellAsset, buyAsset]);

  // Handle user input changes - clear expired quote if parameters change
  const handleSellChange = (val: string) => {
    setSellAmount(val);
    if (quote && lastRequestedParams.current && lastRequestedParams.current.sellAmount !== val) {
      // User modified input
      setError(null);
    }
  };

  const handleBuyChange = (val: string) => {
    setBuyAmount(val);
    if (quote && lastRequestedParams.current && lastRequestedParams.current.buyAmount !== val) {
      setError(null);
    }
  };

  const handleSubmitQuote = async () => {
    if (!quote || isRefreshing || isFetching || isSubmitting) return;

    if (remainingSeconds <= 0) {
      setError('Quote has expired. Refreshing quote...');
      executeFetchQuote(true);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (onSubmitQuote) {
        await onSubmitQuote(quote);
      } else {
        // Default simulated submit or API call
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      setSuccessMessage(`Conversion quote #${quote.id.slice(0, 8)} accepted successfully!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quote execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Circular progress calculations
  const progressPercent =
    totalValiditySeconds > 0
      ? Math.max(0, Math.min(100, (remainingSeconds / totalValiditySeconds) * 100))
      : 0;

  const circleRadius = 14;
  const circumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  const getTimerColorClass = () => {
    if (remainingSeconds > 10) return 'text-emerald-400 stroke-emerald-400';
    if (remainingSeconds > 5) return 'text-amber-400 stroke-amber-400';
    return 'text-rose-400 stroke-rose-400';
  };

  const getTimerBgColorClass = () => {
    if (remainingSeconds > 10) return 'bg-emerald-400';
    if (remainingSeconds > 5) return 'bg-amber-400';
    return 'bg-rose-400';
  };

  return (
    <div className="glass-card space-y-6 p-8 relative">
      <div>
        <h3 className="mb-1 text-xl font-bold">SEP-38 Quote</h3>
        <p className="text-sm text-slate-400">Get a real-time cross-border conversion quote from the anchor.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-red-400" role="alert">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-sm text-emerald-400">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-400">Quote Type</span>
          <Tooltip content="Choose how the conversion price is determined for your transaction.">
            <button
              type="button"
              aria-label="Quote type info"
              className="text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
            >
              <Info size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>

        <div className="flex gap-3" role="group" aria-label="Select quote type">
          <label className="flex flex-1 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-[:checked]:border-primary/40 has-[:checked]:bg-primary/10 border-slate-700 hover:border-slate-600">
            <input
              type="radio"
              name="quoteType"
              value="fixed"
              checked={quoteType === 'fixed'}
              disabled={isFetching || isRefreshing || isSubmitting}
              onChange={() => setQuoteType('fixed')}
              className="mt-0.5 accent-primary"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm">Fixed</span>
                <Tooltip content="Price is locked in at time of quote. You'll receive exactly this amount.">
                  <button
                    type="button"
                    aria-label="Fixed quote info"
                    tabIndex={0}
                    className="text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                  >
                    <Info size={12} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Guaranteed rate at execution</p>
            </div>
          </label>

          <label className="flex flex-1 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-[:checked]:border-primary/40 has-[:checked]:bg-primary/10 border-slate-700 hover:border-slate-600">
            <input
              type="radio"
              name="quoteType"
              value="indicative"
              checked={quoteType === 'indicative'}
              disabled={isFetching || isRefreshing || isSubmitting}
              onChange={() => setQuoteType('indicative')}
              className="mt-0.5 accent-primary"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm">Indicative</span>
                <Tooltip content="Price may change slightly at execution. Final amount depends on market conditions.">
                  <button
                    type="button"
                    aria-label="Indicative quote info"
                    tabIndex={0}
                    className="text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                  >
                    <Info size={12} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Estimated rate, may vary at execution</p>
            </div>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="sep38-sell" className="mb-2 block text-sm font-medium text-slate-400">
            You Send ({sellAsset})
          </label>
          <input
            id="sep38-sell"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={sellAmount}
            disabled={isFetching || isRefreshing || isSubmitting}
            onChange={(e) => handleSellChange(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div>
          <label htmlFor="sep38-buy" className="mb-2 block text-sm font-medium text-slate-400">
            You Receive ({buyAsset})
          </label>
          <input
            id="sep38-buy"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={buyAmount}
            disabled={isFetching || isRefreshing || isSubmitting}
            onChange={(e) => handleBuyChange(e.target.value)}
            className="input-field w-full"
          />
        </div>
      </div>

      {/* Real-time Quote Details and Countdown Indicator */}
      {quote && (
        <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <ArrowRightLeft size={14} className="text-primary" />
              <span>Conversion Rate: 1 {quote.sellAsset} = {quote.price} {quote.buyAsset}</span>
            </div>

            {/* Countdown Badge / Progress Ring */}
            <div className="flex items-center gap-2">
              <div
                className="relative flex items-center justify-center"
                role="progressbar"
                aria-valuenow={remainingSeconds}
                aria-valuemin={0}
                aria-valuemax={totalValiditySeconds}
                aria-label="Quote validity countdown"
              >
                <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                  <circle
                    cx="18"
                    cy="18"
                    r={circleRadius}
                    className="stroke-slate-700 fill-none"
                    strokeWidth="3"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r={circleRadius}
                    className={`fill-none transition-all duration-1000 ${getTimerColorClass()}`}
                    strokeWidth="3"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                  />
                </svg>
                <span className={`absolute text-[10px] font-bold ${getTimerColorClass()}`}>
                  {remainingSeconds}s
                </span>
              </div>

              <div className="text-right">
                <div className="text-xs font-medium text-slate-300">
                  {remainingSeconds > 0 ? (
                    <span>Valid for <strong className={getTimerColorClass()}>{remainingSeconds}s</strong></span>
                  ) : (
                    <span className="text-rose-400 font-semibold">Quote Expired</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {isRefreshing ? 'Refreshing Quote...' : 'Auto-refreshes on expiration'}
                </div>
              </div>
            </div>
          </div>

          {/* Linear Timer Bar */}
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${getTimerBgColorClass()}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
            <span>Quote ID: <code className="text-slate-300">{quote.id}</code></span>
            <button
              type="button"
              disabled={isRefreshing || isFetching || isSubmitting}
              onClick={() => executeFetchQuote(true, 'manual')}
              className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
              <span>Refresh Now</span>
            </button>
          </div>
        </div>
      )}

      {/* Expiry warning: shown during the final 30 seconds with a quick refresh action */}
      {showExpiryWarning && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
        >
          <span>Quote expiring in {remainingSeconds}s.</span>
          <button
            type="button"
            disabled={isRefreshing || isFetching || isSubmitting}
            onClick={() => executeFetchQuote(true, 'warning')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Refresh Quote</span>
          </button>
        </div>
      )}

      {/* Informational Banner when no quote */}
      {!quote && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
          <Tooltip content="Quotes expire after a short window. Start your transaction promptly.">
            <button
              type="button"
              aria-label="Quote validity info"
              tabIndex={0}
              className="text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
            >
              <Info size={14} aria-hidden="true" />
            </button>
          </Tooltip>
          <span>Quotes are valid for {initialValiditySeconds} seconds with real-time automatic countdown and refresh.</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        {!quote ? (
          <button
            type="button"
            onClick={() => executeFetchQuote(false)}
            disabled={isFetching || (!sellAmount && !buyAmount)}
            className="btn-primary w-full rounded-lg px-6 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFetching ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Fetching Quote...</span>
              </>
            ) : (
              <span>Get Quote</span>
            )}
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => executeFetchQuote(true, 'manual')}
              disabled={isRefreshing || isFetching || isSubmitting}
              className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:border-slate-600 hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              <span>{isRefreshing ? 'Refreshing...' : 'New Quote'}</span>
            </button>

            <button
              type="button"
              onClick={handleSubmitQuote}
              disabled={isRefreshing || isFetching || isSubmitting || remainingSeconds <= 0}
              className="btn-primary flex-1 rounded-lg px-6 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRefreshing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Refreshing Quote...</span>
                </>
              ) : isSubmitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Executing Conversion...</span>
                </>
              ) : (
                <span>Accept & Submit Quote</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sep38QuotePanel;
