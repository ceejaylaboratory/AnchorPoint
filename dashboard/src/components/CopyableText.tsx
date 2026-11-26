import React from 'react';
import { Check, Copy } from 'lucide-react';
import {
  COPY_FEEDBACK_MS,
  useCopyFeedback,
} from '../hooks/useCopyFeedback';

interface CopyableTextProps {
  value: string;
  label?: string;
  truncate?: boolean;
  className?: string;
}

// Kept as a named export so existing consumers do not need to change imports.
export { COPY_FEEDBACK_MS };

export function truncateHash(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export const CopyableText: React.FC<CopyableTextProps> = ({
  value,
  label = 'Value',
  truncate = true,
  className = '',
}) => {
  const { state, copy } = useCopyFeedback();
  const isCopied = state === 'copied';

  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate font-mono" title={value} data-testid="copyable-text-value">
        {truncate ? truncateHash(value) : value}
      </span>
      <span className="relative inline-flex shrink-0">
        <button
          type="button"
          onClick={() => void copy(value)}
          aria-label={`Copy ${label.toLowerCase()}`}
          data-testid="copyable-text-btn"
          data-copy-state={state}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {isCopied ? (
            <Check size={12} className="text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy size={12} aria-hidden="true" />
          )}
        </button>

        {state !== 'idle' && (
          <span
            data-testid="copy-tooltip"
            data-state={state}
            // The live region below announces the result; the bubble is decorative.
            aria-hidden="true"
            className={`pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-medium shadow-lg ${
              isCopied
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-200'
            }`}
          >
            {isCopied ? 'Copied!' : 'Copy failed'}
          </span>
        )}

        <span className="sr-only" aria-live="polite">
          {isCopied ? `${label} copied to clipboard.` : ''}
          {state === 'failed' ? `Unable to copy ${label.toLowerCase()}.` : ''}
        </span>
      </span>
    </span>
  );
};

export default CopyableText;
