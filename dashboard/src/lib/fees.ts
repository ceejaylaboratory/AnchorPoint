import BigNumber from 'bignumber.js';

/**
 * Configure BigNumber globally for this module.
 *
 * - ROUND_DOWN (1) on intermediate values matches Stellar's truncation behaviour
 *   for stroops (7 decimal places max).
 * - EXPONENTIAL_AT extended past Stellar's 7-decimal precision so values like
 *   1e-7 are always rendered as "0.0000001" in string output.
 */
BigNumber.config({
  DECIMAL_PLACES: 7,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
  EXPONENTIAL_AT: [-20, 20],
});

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

/**
 * Round a BigNumber to 7 decimal places using ROUND_DOWN (Stellar stroop
 * convention) and return as a plain JS number.
 *
 * The conversion back to `number` is safe here because all Stellar amounts
 * fit comfortably within JavaScript's 53-bit mantissa at 7 decimal precision.
 */
const toStellarNumber = (bn: BigNumber): number =>
  bn.dp(7, BigNumber.ROUND_DOWN).toNumber();

/**
 * Computes the net payout for a withdrawal amount given the anchor's fee
 * configuration. All arithmetic is performed with BigNumber to prevent
 * floating-point rounding artefacts (e.g. 0.1 + 0.2 ≠ 0.3 in IEEE 754).
 *
 * The breakdown follows `Amount - Fixed Fee - % Fee = You Receive`, floored
 * by the anchor's configured `feeMinimum` so the preview never understates
 * what the anchor will actually charge.
 */
export function computePayoutBreakdown(amount: number, fee: FeeEstimate): PayoutBreakdown {
  const bnAmount = new BigNumber(amount);
  const bnFixed = new BigNumber(fee.feeFixed);
  const bnPercent = new BigNumber(fee.feePercent);
  const bnMinimum = new BigNumber(fee.feeMinimum);

  const fixedFee = bnFixed.dp(7, BigNumber.ROUND_DOWN);
  // Multiply amount × feePercent; feePercent is already a decimal (e.g. 0.005 for 0.5%)
  const percentFee = bnAmount.multipliedBy(bnPercent).dp(7, BigNumber.ROUND_DOWN);
  const totalFee = BigNumber.max(fixedFee.plus(percentFee), bnMinimum).dp(7, BigNumber.ROUND_DOWN);
  const netPayout = bnAmount.minus(totalFee).dp(7, BigNumber.ROUND_DOWN);

  return {
    amount: toStellarNumber(bnAmount),
    fixedFee: toStellarNumber(fixedFee),
    percentFee: toStellarNumber(percentFee),
    totalFee: toStellarNumber(totalFee),
    netPayout: toStellarNumber(netPayout),
  };
}

/**
 * Format a numeric token amount as a clean string for UI display.
 *
 * - Always uses fixed-point notation (never exponential).
 * - Trims trailing zeros after the decimal point.
 * - Respects Stellar's 7-decimal maximum.
 *
 * Examples:
 *   formatTokenAmount(0.0000001)  → "0.0000001"
 *   formatTokenAmount(1e-7)       → "0.0000001"
 *   formatTokenAmount(100.5000)   → "100.5"
 *   formatTokenAmount(0)          → "0"
 */
export function formatTokenAmount(amount: number | string): string {
  const bn = new BigNumber(amount);
  if (bn.isNaN()) return '0';
  // toFixed(7) gives us 7dp, then strip trailing zeros
  return bn.dp(7, BigNumber.ROUND_DOWN).toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
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
