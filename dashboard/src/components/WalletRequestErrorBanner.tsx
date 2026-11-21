import React from 'react';
import { AlertTriangle, RefreshCcw, X } from 'lucide-react';
import type { WalletSigningError } from '../lib/wallet/signingGuard';

const TITLES: Record<WalletSigningError['code'], string> = {
  timeout: 'Wallet did not respond',
  cancelled: 'Request cancelled',
  disconnected: 'Wallet disconnected',
  account_changed: 'Wallet account changed',
  failed: 'Wallet request failed',
};

interface WalletRequestErrorBannerProps {
  error: WalletSigningError;
  onRetry: () => void;
  onDismiss?: () => void;
}

/** Explains why a wallet prompt ended and offers a retry. */
export const WalletRequestErrorBanner: React.FC<WalletRequestErrorBannerProps> = ({
  error,
  onRetry,
  onDismiss,
}) => (
  <div
    role="alert"
    data-testid="wallet-request-error"
    data-error-code={error.code}
    className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm"
  >
    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-rose-200">{TITLES[error.code]}</p>
      <p className="mt-1 text-rose-300">{error.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
      >
        <RefreshCcw size={14} aria-hidden="true" />
        Try Again
      </button>
    </div>
    {onDismiss ? (
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss wallet error"
        className="rounded p-1 text-rose-300 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
      >
        <X size={14} aria-hidden="true" />
      </button>
    ) : null}
  </div>
);

export default WalletRequestErrorBanner;
