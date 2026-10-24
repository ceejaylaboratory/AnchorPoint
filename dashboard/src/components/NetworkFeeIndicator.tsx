import { useCallback, useEffect, useState } from 'react';
import { Fuel } from 'lucide-react';

interface NetworkFeeIndicatorProps {
  apiBaseUrl?: string;
  refreshIntervalMs?: number;
}

export const FEE_THRESHOLDS = { low: 1000, medium: 5000 };

export function feeLevel(baseFeeStroops: number): 'low' | 'medium' | 'high' {
  if (baseFeeStroops < FEE_THRESHOLDS.low) return 'low';
  if (baseFeeStroops < FEE_THRESHOLDS.medium) return 'medium';
  return 'high';
}

async function fetchBaseFee(apiBaseUrl: string): Promise<number> {
  try {
    const res = await fetch(`${apiBaseUrl}/network/fee`);
    if (res.ok) {
      const data = await res.json();
      const v = Number(data.baseFee ?? data.fee ?? data.last_ledger_base_fee);
      if (Number.isFinite(v) && v >= 0) return v;
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch('https://horizon-testnet.stellar.org/fee_stats');
    if (res.ok) {
      const data = await res.json();
      const v = Number(data?.last_ledger_base_fee ?? data?.fee_charged?.mode);
      if (Number.isFinite(v) && v >= 0) return v;
    }
  } catch {
    /* fall through */
  }
  return 100;
}

export const NetworkFeeIndicator: React.FC<NetworkFeeIndicatorProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  refreshIntervalMs = 30000,
}) => {
  const [baseFee, setBaseFee] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setBaseFee(await fetchBaseFee(apiBaseUrl));
  }, [apiBaseUrl]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshIntervalMs]);

  const level = baseFee === null ? 'low' : feeLevel(baseFee);
  const color =
    level === 'low'
      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      : level === 'medium'
        ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
        : 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  const dot = level === 'low' ? 'bg-emerald-400' : level === 'medium' ? 'bg-amber-400' : 'bg-rose-500';

  return (
    <div
      data-testid="network-fee-indicator"
      data-fee-level={level}
      role="status"
      aria-live="polite"
      title={`Current Stellar network base fee: ${baseFee ?? '…'} stroops`}
      className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 sm:flex ${color}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      <Fuel size={14} aria-hidden="true" />
      <span className="text-xs font-semibold font-mono" data-testid="network-fee-value">
        {baseFee === null ? 'Fee …' : `${baseFee.toLocaleString()} stroops`}
      </span>
    </div>
  );
};

export default NetworkFeeIndicator;
