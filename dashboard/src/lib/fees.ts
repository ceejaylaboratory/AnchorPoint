export type FeeType = 'flat' | 'percentage' | 'tiered';

export interface FeeEstimate {
  assetCode: string;
  feeType: FeeType;
  inputAmount: number;
  feeAmount: number;
  feeFixed: number;
  feePercent: number;
  feeMinimum: number;
}

export interface PayoutBreakdown {
  amount: number;
  fixedFee: number;
  percentFee: number;
  totalFee: number;
  netPayout: number;
}

const round = (value: number, precision = 7): number =>
  Number.parseFloat(value.toFixed(precision));

/**
 * Computes the net payout for a withdrawal amount given the anchor's fee
 * configuration. The breakdown follows `Amount - Fixed Fee - % Fee = You Receive`,
 * floored by the anchor's configured `feeMinimum` so the preview never understates
 * what the anchor will actually charge.
 */
export function computePayoutBreakdown(amount: number, fee: FeeEstimate): PayoutBreakdown {
  const fixedFee = round(fee.feeFixed);
  const percentFee = round(amount * fee.feePercent);
  const totalFee = round(Math.max(fixedFee + percentFee, fee.feeMinimum));
  const netPayout = round(amount - totalFee);

  return {
    amount: round(amount),
    fixedFee,
    percentFee,
    totalFee,
    netPayout,
  };
}

/**
 * Fetches the anchor's fee estimate for a given asset and amount.
 * Uses the backend `/fees/calculate` endpoint (SEP-24 fee estimation).
 */
export async function fetchFeeEstimate(
  apiBaseUrl: string,
  assetCode: string,
  amount: string,
): Promise<FeeEstimate> {
  const params = new URLSearchParams({ asset: assetCode, amount });
  const token = localStorage.getItem('authToken');
  const base = apiBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/fees/calculate?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    throw new Error(`Fee estimate request failed with status ${res.status}`);
  }

  const data = await res.json();

  return {
    assetCode: data.assetCode ?? assetCode,
    feeType: data.feeType ?? 'flat',
    inputAmount: Number(data.inputAmount ?? amount),
    feeAmount: Number(data.feeAmount ?? 0),
    feeFixed: Number(data.feeFixed ?? 0),
    feePercent: Number(data.feePercent ?? 0),
    feeMinimum: Number(data.feeMinimum ?? 0),
  };
}
