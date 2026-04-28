import { Request, Response } from 'express';
import { FeeService } from '../../services/fee.service';

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
    res.status(502).json({ error: message });
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
    res.status(502).json({ error: message });
  }
}

/**
 * GET /fees/calculate?asset=USDC&amount=100
 * Returns the calculated fee for a specific asset and amount using the
 * asset's configured fee strategy (flat / percentage / tiered).
 */
export function calculateAssetFee(req: Request, res: Response, feeService: FeeService): void {
  const assetCode = req.query.asset as string;
  const amountRaw = parseFloat(req.query.amount as string);

  if (!assetCode) {
    res.status(400).json({ error: 'asset query parameter is required' });
    return;
  }
  if (!Number.isFinite(amountRaw) || amountRaw < 0) {
    res.status(400).json({ error: 'amount must be a non-negative number' });
    return;
  }

  try {
    const result = feeService.calculateAssetFee(assetCode, amountRaw);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to calculate fee';
    res.status(400).json({ error: message });
  }
}
