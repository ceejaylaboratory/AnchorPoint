import { Request, Response } from 'express';
import { FeeService } from '../../services/fee.service';
import { toDecimal } from '../../utils/decimal';

/**
 * GET /fees/stats
 * Returns raw network fee statistics from Horizon.
 */
export async function getFeeStats(req: Request, res: Response, feeService: FeeService): Promise<void> {
  try {
    const stats = await feeService.getFeeStats();
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch fee stats';
    res.status(502).json({
      error: {
        code: 'BAD_GATEWAY',
        message,
      },
    });
  }
}

/**
 * GET /fees/estimate?operations=1
 * Returns an estimated transaction fee for the given number of operations.
 */
export async function estimateFee(req: Request, res: Response, feeService: FeeService): Promise<void> {
  const raw = parseInt(req.query.operations as string, 10);
  const operationCount = Number.isFinite(raw) && raw > 0 ? raw : 1;

  try {
    const estimate = await feeService.estimateFee(operationCount);
    res.json(estimate);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to estimate fee';
    res.status(502).json({
      error: {
        code: 'BAD_GATEWAY',
        message,
      },
    });
  }
}

/**
 * GET /fees/calculate?asset=USDC&amount=100&timestamp=2026-10-15T00:00:00Z
 * Returns the calculated fee for a specific asset and amount using the
 * versioned fee schedule active at the transaction's created_at timestamp.
 */
export async function calculateAssetFee(req: Request, res: Response, feeService: FeeService): Promise<void> {
  const assetCode = req.query.asset as string;
  const amountRaw = req.query.amount as string;
  const timestampRaw = (req.query.timestamp || req.query.created_at || req.query.effective_at) as string | undefined;
  const amount = amountRaw ? toDecimal(amountRaw) : null;

  if (!assetCode) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'asset query parameter is required',
        details: { field: 'asset' },
      },
    });
    return;
  }
  if (!amountRaw || !amount || !amount.isFinite() || amount.isNegative()) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'amount must be a non-negative number',
        details: { field: 'amount' },
      },
    });
    return;
  }

  let effectiveAt: Date | undefined;
  if (timestampRaw) {
    effectiveAt = new Date(timestampRaw);
    if (isNaN(effectiveAt.getTime())) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'invalid timestamp query parameter format',
          details: { field: 'timestamp' },
        },
      });
      return;
    }
  }

  try {
    const result = await feeService.calculateAssetFee(assetCode, amountRaw, effectiveAt);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to calculate fee';
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message,
      },
    });
  }
}
