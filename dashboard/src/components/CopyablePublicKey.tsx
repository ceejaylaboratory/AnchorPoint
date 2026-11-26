import React, { useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import { COPY_FEEDBACK_MS, useCopyFeedback } from '../hooks/useCopyFeedback';

interface CopyablePublicKeyProps {
  publicKey: string;
  label?: string;
}

// Re-exported for existing tests and consumers.
export { COPY_FEEDBACK_MS };

const shortenPublicKey = (publicKey: string) => {
  if (publicKey.length <= 16) return publicKey;
  return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
};

export const CopyablePublicKey: React.FC<CopyablePublicKeyProps> = ({
  publicKey,
  label = 'Public key',
}) => {
  const { state, copy } = useCopyFeedback();
  const displayKey = useMemo(() => shortenPublicKey(publicKey), [publicKey]);
  const isCopied = state === 'copied';

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <code className="block truncate font-mono text-xs text-slate-200" title={publicKey}>
          {displayKey}
        </code>
      </div>

      <div className="relative shrink-0">
        {/*
          A native <button> already activates on Enter and Space, so the copy
          affordance is keyboard-operable without a key handler that would
          double-fire alongside the synthesised click.
        */}
        <button
          type="button"
          onClick={() => void copy(publicKey)}
          aria-label={`Copy ${label.toLowerCase()}`}
          data-testid="copyable-public-key-btn"
          data-copy-state={state}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {isCopied ? (
            <Check size={16} className="text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
        </button>

        {state !== 'idle' && (
          <span
            data-testid="copy-tooltip"
            data-state={state}
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium shadow-lg ${
              isCopied
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-200'
            }`}
          >
            {isCopied ? 'Copied!' : 'Copy failed'}
          </span>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {isCopied ? `${label} copied to clipboard.` : ''}
        {state === 'failed' ? `Unable to copy ${label.toLowerCase()}.` : ''}
      </span>
    </div>
  );
};

export default CopyablePublicKey;
