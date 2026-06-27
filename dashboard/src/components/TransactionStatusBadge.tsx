import type { FC } from 'react';
import { CheckCircle2, Clock, Loader2, XCircle, Ban } from 'lucide-react';

export type TransactionStatus = 'Completed' | 'Pending' | 'Processing' | 'Failed' | 'Cancelled';

interface StatusConfig {
  label: string;
  className: string;
  Icon: typeof CheckCircle2;
}

const STATUS_CONFIG: Record<TransactionStatus, StatusConfig> = {
  Completed: {
    label: 'Completed',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    Icon: CheckCircle2,
  },
  Pending: {
    label: 'Pending',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Icon: Clock,
  },
  Processing: {
    label: 'Processing',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    Icon: Loader2,
  },
  Failed: {
    label: 'Failed',
    className: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    Icon: XCircle,
  },
  Cancelled: {
    label: 'Cancelled',
    className: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    Icon: Ban,
  },
};

interface TransactionStatusBadgeProps {
  status: TransactionStatus;
  /** Show icon alongside label (default: true) */
  showIcon?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const TransactionStatusBadge: FC<TransactionStatusBadgeProps> = ({
  status,
  showIcon = true,
  className = '',
}) => {
  const config = STATUS_CONFIG[status];
  const { Icon } = config;

  return (
    <span
      role="status"
      aria-label={`Transaction status: ${config.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${config.className} ${className}`}
    >
      {showIcon && (
        <Icon
          size={11}
          aria-hidden="true"
          className={status === 'Processing' ? 'animate-spin' : ''}
        />
      )}
      {config.label}
    </span>
  );
};

export default TransactionStatusBadge;
