import { describe, expect, it } from 'vitest';
import { computePayoutBreakdown, formatTokenAmount } from './fees';
import type { FeeEstimate } from './fees';

const makeFee = (overrides: Partial<FeeEstimate> = {}): FeeEstimate => ({
  assetCode: 'USDC',
  feeType: 'tiered',
  inputAmount: 100,
  feeAmount: 1,
  feeFixed: 0.5,
  feePercent: 0.005,
  feeMinimum: 0,
  ...overrides,
});

describe('computePayoutBreakdown', () => {
  it('computes net payout as Amount - Fixed Fee - % Fee', () => {
    const breakdown = computePayoutBreakdown(100, makeFee());

    expect(breakdown.amount).toBe(100);
    expect(breakdown.fixedFee).toBe(0.5);
    expect(breakdown.percentFee).toBe(0.5);
    expect(breakdown.totalFee).toBe(1);
    expect(breakdown.netPayout).toBe(99);
  });

  it('returns a negative net payout when fees exceed the amount', () => {
    const breakdown = computePayoutBreakdown(5, makeFee({ feeFixed: 10, feePercent: 0, feeAmount: 10 }));

    expect(breakdown.netPayout).toBe(-5);
  });

  it('returns zero net payout when fees equal the amount', () => {
    const breakdown = computePayoutBreakdown(0.5, makeFee({ feeFixed: 0.5, feePercent: 0, feeAmount: 0.5 }));

    expect(breakdown.netPayout).toBe(0);
  });

  it('handles flat-fee-only assets with no percentage component', () => {
    const breakdown = computePayoutBreakdown(120, makeFee({ feeFixed: 0.5, feePercent: 0, feeAmount: 0.5, feeType: 'flat' }));

    expect(breakdown.fixedFee).toBe(0.5);
    expect(breakdown.percentFee).toBe(0);
    expect(breakdown.netPayout).toBe(119.5);
  });

  it('avoids floating-point dust when computing the breakdown', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754 — BigNumber must return exactly 0.3
    const breakdown = computePayoutBreakdown(100, makeFee({ feeFixed: 0.1, feePercent: 0.002, feeAmount: 0 }));

    // percentFee = 100 × 0.002 = 0.2; totalFee = 0.1 + 0.2 = 0.3 (exact)
    expect(breakdown.totalFee).toBe(0.3);
    expect(breakdown.netPayout).toBe(99.7);
  });

  it('maintains 7-decimal precision for dust amounts', () => {
    // Minimum Stellar stroop: 0.0000001
    const breakdown = computePayoutBreakdown(0.0000001, makeFee({ feeFixed: 0, feePercent: 0, feeAmount: 0 }));

    expect(breakdown.amount).toBe(0.0000001);
    expect(breakdown.netPayout).toBe(0.0000001);
  });

  it('rounds down at the 7th decimal (stroop boundary)', () => {
    // 1.00000005 should truncate to 1.0000000 at 7dp with ROUND_DOWN
    const breakdown = computePayoutBreakdown(1.00000005, makeFee({ feeFixed: 0, feePercent: 0, feeAmount: 0 }));

    expect(breakdown.amount).toBe(1);
  });

  it('handles zero amount without throwing', () => {
    const breakdown = computePayoutBreakdown(0, makeFee({ feeFixed: 0.5, feePercent: 0.005 }));

    expect(breakdown.amount).toBe(0);
    expect(breakdown.fixedFee).toBe(0.5);
    expect(breakdown.percentFee).toBe(0);
    expect(breakdown.netPayout).toBe(-0.5);
  });

  it('applies feeMinimum when fixed + % fee is below the minimum', () => {
    // feeMinimum = 1, but fixed 0.1 + % 0 = 0.1 → totalFee should be 1
    const breakdown = computePayoutBreakdown(50, makeFee({ feeFixed: 0.1, feePercent: 0, feeAmount: 0, feeMinimum: 1 }));

    expect(breakdown.totalFee).toBe(1);
    expect(breakdown.netPayout).toBe(49);
  });

  it('classic 0.1 + 0.2 IEEE 754 pitfall returns exact 0.3', () => {
    // This would be 0.30000000000000004 with native float arithmetic
    const breakdown = computePayoutBreakdown(1, makeFee({ feeFixed: 0.1, feePercent: 0.2, feeAmount: 0 }));

    // 0.1 (fixed) + 0.2 (1 × 0.2 percent) = 0.3 exactly
    expect(breakdown.totalFee).toBe(0.3);
  });

  it('handles 7th decimal transition correctly', () => {
    // Amount: 100, feePercent: 0.00000001 → percentFee = 0.000001 (7dp)
    const breakdown = computePayoutBreakdown(100, makeFee({ feeFixed: 0, feePercent: 0.00000001 }));

    expect(breakdown.percentFee).toBe(0.000001);
  });

  it('computes percentage fee for 120.5 without float drift', () => {
    const breakdown = computePayoutBreakdown(120.5, makeFee({ feeFixed: 0.5, feePercent: 0.005 }));

    expect(breakdown.percentFee).toBe(0.6025);
    expect(breakdown.netPayout).toBe(119.3975);
  });
});

// ---------------------------------------------------------------------------
// formatTokenAmount
// ---------------------------------------------------------------------------
describe('formatTokenAmount', () => {
  it('formats a normal amount without trailing zeros', () => {
    expect(formatTokenAmount(100.5)).toBe('100.5');
  });

  it('formats the minimum stroop amount without exponential notation', () => {
    expect(formatTokenAmount(0.0000001)).toBe('0.0000001');
    expect(formatTokenAmount(1e-7)).toBe('0.0000001');
  });

  it('strips trailing zeros', () => {
    expect(formatTokenAmount(100.5000)).toBe('100.5');
    expect(formatTokenAmount(1.0)).toBe('1');
  });

  it('formats zero as "0"', () => {
    expect(formatTokenAmount(0)).toBe('0');
  });

  it('accepts string input', () => {
    expect(formatTokenAmount('1.23456789')).toBe('1.2345678');
  });

  it('returns "0" for NaN input', () => {
    expect(formatTokenAmount(NaN)).toBe('0');
  });

  it('never uses exponential notation for large amounts', () => {
    expect(formatTokenAmount(1_000_000_000)).toBe('1000000000');
  });
});
