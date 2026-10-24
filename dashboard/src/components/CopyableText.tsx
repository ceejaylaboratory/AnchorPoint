import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyableTextProps {
  value: string;
  label?: string;
  truncate?: boolean;
  className?: string;
}

export const COPY_FEEDBACK_MS = 2000;

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const id = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(id);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate font-mono" title={value} data-testid="copyable-text-value">
        {truncate ? truncateHash(value) : value}
      </span>
      <span className="relative inline-flex shrink-0">
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          data-testid="copyable-text-btn"
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {copied ? (
            <Check size={12} className="text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy size={12} aria-hidden="true" />
          )}
        </button>
        {copied && (
          <span
            role="status"
            className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-medium text-emerald-400 shadow-lg"
          >
            Copied!
          </span>
        )}
      </span>
    </span>
  );
};

export default CopyableText;
