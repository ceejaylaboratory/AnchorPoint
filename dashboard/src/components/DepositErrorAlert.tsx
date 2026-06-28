import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface DepositError {
  type: 'validation' | 'network' | 'kyc' | 'server' | 'asset' | 'amount';
  title: string;
  message: string;
  details?: string;
  retryable?: boolean;
}

interface DepositErrorAlertProps {
  /** The error object to display */
  error: DepositError | null;
  /** Called when the user dismisses the alert */
  onDismiss?: () => void;
  /** Called when the user clicks retry */
  onRetry?: () => void;
  /** If true, shows a dismiss button */
  dismissible?: boolean;
}

const ERROR_COLORS: Record<DepositError['type'], string> = {
  validation: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  network: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  kyc: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  server: 'border-red-500/30 bg-red-500/10 text-red-300',
  asset: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  amount: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

const ERROR_ICONS: Record<DepositError['type'], 'alert' | 'network' | 'user' | 'server' | 'package' | 'dollar'> = {
  validation: 'alert',
  network: 'network',
  kyc: 'user',
  server: 'server',
  asset: 'package',
  amount: 'dollar',
};

export const DepositErrorAlert: React.FC<DepositErrorAlertProps> = ({
  error,
  onDismiss,
  onRetry,
  dismissible = true,
}) => {
  if (!error) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={`${error.type}-${error.title}`}
        initial={{ opacity: 0, y: -10, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -10, height: 0 }}
        transition={{ duration: 0.3 }}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${ERROR_COLORS[error.type]}`}
      >
        <AlertCircle
          size={18}
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        />

        <div className="flex-1">
          <h3 className="font-semibold text-sm mb-0.5">{error.title}</h3>
          <p className="text-sm leading-relaxed">{error.message}</p>
          {error.details && (
            <p className="text-xs mt-2 opacity-80">{error.details}</p>
          )}

          {(error.retryable && onRetry) && (
            <button
              onClick={onRetry}
              className="mt-2 text-xs font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:ring-current rounded"
              aria-label={`Retry ${error.type} operation`}
            >
              Try Again
            </button>
          )}
        </div>

        {dismissible && onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 p-0.5 rounded hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            aria-label="Dismiss error alert"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default DepositErrorAlert;
