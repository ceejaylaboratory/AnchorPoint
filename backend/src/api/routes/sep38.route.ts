import { Router, Request, Response } from 'express';
import { sep38Controller } from '../controllers/sep38.controller';
import { metricsService } from '../../services/metrics.service';

const router = Router();

/**
 * @swagger
 * /sep38/price:
 *   get:
 *     summary: Get an indicative price
 *     description: Returns an indicative price for exchanging one asset for another.
 *     tags: [SEP-38]
 *     parameters:
 *       - in: query
 *         name: source_asset
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset code to sell, e.g. USDC
 *       - in: query
 *         name: source_amount
 *         required: true
 *         schema:
 *           type: string
 *         description: Amount of source asset to sell
 *       - in: query
 *         name: destination_asset
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset code to buy, e.g. XLM
 *       - in: query
 *         name: context
 *         schema:
 *           type: string
 *         description: Context of the price request, e.g. sep6, sep24, sep31
 *     responses:
 *       200:
 *         description: Indicative price
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 source_asset:
 *                   type: string
 *                 source_amount:
 *                   type: string
 *                 destination_asset:
 *                   type: string
 *                 destination_amount:
 *                   type: string
 *                 price:
 *                   type: string
 *                 price_decimals:
 *                   type: integer
 *                 fee:
 *                   type: string
 *                 expiration_time:
 *                   type: integer
 *                   description: Unix timestamp (ms) when the price expires
 *                 context:
 *                   type: string
 *                 cached:
 *                   type: boolean
 *                 confidence:
 *                   type: number
 *                 sources_used:
 *                   type: integer
 *                 is_partial:
 *                   type: boolean
 *                 routing_path:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Missing required parameters
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
router.get('/price', async (req: Request, res: Response) => {
  try {
    const { source_asset, source_amount, destination_asset, context } = req.query;

    // Validate required parameters
    if (!source_asset || !source_amount || !destination_asset) {
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'Missing required parameters: source_asset, source_amount, destination_asset',
      });
    }

    const priceQuote = await sep38Controller.getPriceQuote(
      source_asset as string,
      source_amount as string,
      destination_asset as string,
      context as string,
    );

    res.json(priceQuote);
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
 * /sep38/quote:
 *   post:
 *     summary: Request a firm quote
 *     description: Returns a firm price quote and persists it so it can be referenced by a transaction.
 *     tags: [SEP-38]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - source_asset
 *               - source_amount
 *               - destination_asset
 *             properties:
 *               source_asset:
 *                 type: string
 *               source_amount:
 *                 type: string
 *               destination_asset:
 *                 type: string
 *               context:
 *                 type: string
 *     responses:
 *       200:
 *         description: Firm quote
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 source_asset:
 *                   type: string
 *                 source_amount:
 *                   type: string
 *                 destination_asset:
 *                   type: string
 *                 destination_amount:
 *                   type: string
 *                 price:
 *                   type: string
 *                 price_decimals:
 *                   type: integer
 *                 fee:
 *                   type: string
 *                 expiration_time:
 *                   type: integer
 *                   description: Unix timestamp (ms) when the price expires
 *                 context:
 *                   type: string
 *                 cached:
 *                   type: boolean
 *                 confidence:
 *                   type: number
 *                 sources_used:
 *                   type: integer
 *                 is_partial:
 *                   type: boolean
 *                 routing_path:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Missing required parameters
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
router.post('/quote', async (req: Request, res: Response) => {
  const start = Date.now();
  let statusLabel = 'success';
  try {
    metricsService.incrementSep38QuoteRequests('attempted');

    const { source_asset, source_amount, destination_asset, context } = req.body;

    if (!source_asset || !source_amount || !destination_asset) {
      statusLabel = 'bad_request';
      metricsService.incrementSep38QuoteRequests('bad_request');
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'Missing required parameters: source_asset, source_amount, destination_asset',
      });
    }

    const priceQuote = await sep38Controller.createQuote(
      source_asset,
      String(source_amount),
      destination_asset,
      context,
    );

    metricsService.incrementSep38QuoteRequests('success');
    res.json(priceQuote);
  } catch (error) {
    statusLabel = 'error';
    metricsService.incrementSep38QuoteRequests('error');
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
  } finally {
    const duration = (Date.now() - start) / 1000;
    metricsService.observeSep38QuoteDuration(statusLabel, duration);
  }
});

/**
 * @swagger
 * /sep38/assets:
 *   get:
 *     summary: List tradable assets
 *     tags: [SEP-38]
 *     responses:
 *       200:
 *         description: Supported assets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                       issuer:
 *                         type: string
 *                       asset_type:
 *                         type: string
 *                         enum:
 *                           - native
 *                           - credit_alphanum4
 *                           - credit_alphanum12
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       decimals:
 *                         type: integer
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
router.get('/assets', async (req: Request, res: Response) => {
  try {
    const assets = await sep38Controller.getSupportedAssets();
    res.json({ assets });
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
 * /sep38/history:
 *   get:
 *     summary: Get 24h price history
 *     description: Returns historical price data for an asset pair over the last 24 hours.
 *     tags: [SEP-38]
 *     parameters:
 *       - in: query
 *         name: source_asset
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset code to sell, e.g. USDC
 *       - in: query
 *         name: destination_asset
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset code to buy, e.g. XLM
 *     responses:
 *       200:
 *         description: Price history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prices:
 *                   type: object
 *                   properties:
 *                     source_asset:
 *                       type: string
 *                     destination_asset:
 *                       type: string
 *                     points:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           timestamp:
 *                             type: integer
 *                           price:
 *                             type: number
 *                     high_24h:
 *                       type: number
 *                     low_24h:
 *                       type: number
 *                     spread_24h:
 *                       type: number
 *                     average:
 *                       type: number
 *                     change_24h_percent:
 *                       type: number
 *       400:
 *         description: Missing required parameters
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
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { source_asset, destination_asset } = req.query;

    if (!source_asset || !destination_asset) {
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'Missing required parameters: source_asset, destination_asset',
      });
    }

    const historicalPrices = await sep38Controller.getPriceHistory(
      source_asset as string,
      destination_asset as string,
    );

    res.json({ prices: historicalPrices });
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
