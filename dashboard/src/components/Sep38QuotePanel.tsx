import React, { useState } from 'react';
import { Info } from 'lucide-react';
import Tooltip from './Tooltip';

type QuoteType = 'fixed' | 'indicative';

const Sep38QuotePanel: React.FC = () => {
  const [quoteType, setQuoteType] = useState<QuoteType>('fixed');
  const [sellAmount, setSellAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('');

  return (
    <div className="glass-card space-y-6 p-8">
      <div>
        <h3 className="mb-1 text-xl font-bold">SEP-38 Quote</h3>
        <p className="text-sm text-slate-400">Get a cross-border conversion quote from the anchor.</p>
      </div>

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
            You Send
          </label>
          <input
            id="sep38-sell"
            type="number"
            min="0"
            placeholder="0.00"
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div>
          <label htmlFor="sep38-buy" className="mb-2 block text-sm font-medium text-slate-400">
            You Receive
          </label>
          <input
            id="sep38-buy"
            type="number"
            min="0"
            placeholder="0.00"
            value={buyAmount}
            onChange={(e) => setBuyAmount(e.target.value)}
            className="input-field w-full"
          />
        </div>
      </div>

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
        <span>Quotes are valid for a limited time. Proceed promptly after requesting.</span>
      </div>

      <button
        type="button"
        className="btn-primary w-full rounded-lg px-6 py-3 text-sm font-semibold"
      >
        Get Quote
      </button>
    </div>
  );
};

export default Sep38QuotePanel;
