import { Router, Request, Response } from 'express';
import { sep40Controller } from '../controllers/sep40.controller';

const router = Router();

/**
 * POST /sep40/rates
 *
 * Get swap rates for specified asset pairs.
 *
 * Request Body:
 * {
 *   "pairs": [
 *     { "sell_asset": "XLM", "buy_asset": "USDC" },
 *     { "sell_asset": "USDC", "buy_asset": "XLM" }
 *   ]
 * }
 *
 * Response:
 * {
 *   "rates": [
 *     {
 *       "sell_asset": "XLM",
 *       "buy_asset": "USDC",
 *       "rate": 0.12,
 *       "decimals": 7
 *     }
 *   ]
 * }
 */
router.post('/rates', async (req: Request, res: Response) => {
  try {
    const { pairs } = req.body;

    // Validate required parameters
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Request body must contain a "pairs" array with at least one asset pair',
      });
    }

    // Validate each pair
    for (const pair of pairs) {
      if (!pair.sell_asset || !pair.buy_asset) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Each pair must have "sell_asset" and "buy_asset" properties',
        });
      }
    }

    const swapRates = await sep40Controller.getSwapRates(pairs);
    res.json(swapRates);
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({
        error: 'internal_server_error',
        message: error.message,
      });
    } else {
      res.status(500).json({
        error: 'internal_server_error',
        message: 'An unexpected error occurred',
      });
    }
  }
});

/**
 * GET /sep40/pairs
 *
 * Get all supported asset pairs for swap rates.
 *
 * Response:
 * {
 *   "pairs": [
 *     { "sell_asset": "XLM", "buy_asset": "USDC" },
 *     { "sell_asset": "XLM", "buy_asset": "USDT" },
 *     ...
 *   ]
 * }
 */
router.get('/pairs', async (req: Request, res: Response) => {
  try {
    const pairs = await sep40Controller.getSupportedPairs();
    res.json({ pairs });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({
        error: 'internal_server_error',
        message: error.message,
      });
    } else {
      res.status(500).json({
        error: 'internal_server_error',
        message: 'An unexpected error occurred',
      });
    }
  }
});

export default router;
