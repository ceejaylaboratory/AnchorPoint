import { Router, Request, Response } from 'express';
import { sep40Controller } from '../controllers/sep40.controller';

const router = Router();

/**
 * @swagger
 * /sep40/rates:
 *   post:
 *     summary: Get swap rates
 *     description: Returns swap rates for the requested asset pairs.
 *     tags: [SEP-40]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pairs
 *             properties:
 *               pairs:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - sell_asset
 *                     - buy_asset
 *                   properties:
 *                     sell_asset:
 *                       type: string
 *                       example: XLM
 *                     buy_asset:
 *                       type: string
 *                       example: USDC
 *     responses:
 *       200:
 *         description: Swap rates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sell_asset:
 *                         type: string
 *                       buy_asset:
 *                         type: string
 *                       rate:
 *                         type: number
 *                       decimals:
 *                         type: integer
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       pair:
 *                         type: string
 *                       reason:
 *                         type: string
 *       400:
 *         description: Missing or malformed pairs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error code
 *                 message:
 *                   type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error code
 *                 message:
 *                   type: string
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
 * @swagger
 * /sep40/pairs:
 *   get:
 *     summary: List supported swap pairs
 *     tags: [SEP-40]
 *     responses:
 *       200:
 *         description: Supported asset pairs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pairs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     required:
 *                       - sell_asset
 *                       - buy_asset
 *                     properties:
 *                       sell_asset:
 *                         type: string
 *                         example: XLM
 *                       buy_asset:
 *                         type: string
 *                         example: USDC
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error code
 *                 message:
 *                   type: string
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
