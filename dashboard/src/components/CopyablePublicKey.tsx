import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyablePublicKeyProps {
  publicKey: string;
  label?: string;
}

const COPY_RESET_MS = 1800;

const shortenPublicKey = (publicKey: string) => {
  if (publicKey.length <= 16) return publicKey;
  return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
};

export const CopyablePublicKey = ({
  publicKey,
  label = 'Public key',
}: CopyablePublicKeyProps) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const displayKey = useMemo(() => shortenPublicKey(publicKey), [publicKey]);

  useEffect(() => {
    if (copyState === 'idle') return undefined;

    const timeoutId = window.setTimeout(() => setCopyState('idle'), COPY_RESET_MS);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

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
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {copyState === 'copied' ? (
          <Check size={16} className="text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? `${label} copied to clipboard.` : ''}
        {copyState === 'failed' ? `Unable to copy ${label.toLowerCase()}.` : ''}
      </span>
    </div>
  );
};

export default CopyablePublicKey;
