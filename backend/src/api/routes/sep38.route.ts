import { Router, Request, Response } from 'express';
import { sep38Controller } from '../controllers/sep38.controller';
import { metricsService } from '../../services/metrics.service';
import { fxAnalyticsService } from '../../services/fx_analytics.service';

const router = Router();

/**
 * GET /sep38/price
 * 
 * Get a price quote for exchanging one asset for another.
 * 
 * Query Parameters:
 * - source_asset: The asset code to sell (e.g., "USDC")
 * - source_amount: The amount of source asset to sell
 * - destination_asset: The asset code to buy (e.g., "XLM")
 * - context: Optional context for the price request (e.g., "SEP-24")
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
 * POST /quote
 * 
 * Get a firm price quote for exchanging one asset for another and persist it.
 * 
 * Request Body:
 * - source_asset: The asset code to sell (e.g., "USDC")
 * - source_amount: The amount of source asset to sell
 * - destination_asset: The asset code to buy (e.g., "XLM")
 * - context: Optional context for the price request
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
 * GET /sep38/assets
 * 
 * Get list of supported assets for trading.
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
 * GET /sep38/history
 * 
 * Get historical price data for an asset pair over the last 24 hours.
 * 
 * Query Parameters:
 * - source_asset: The asset code to sell (e.g., "USDC")
 * - destination_asset: The asset code to buy (e.g., "XLM")
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

/**
 * GET /sep38/prices/history
 *
 * Returns persisted FX rate history for an asset pair from the analytics
 * database (FxRateHistory table). Falls back to in-memory data when the
 * database is unavailable.
 *
 * Query Parameters:
 * - source_asset:      The sell-side asset code (e.g. "USDC")
 * - destination_asset: The buy-side asset code  (e.g. "XLM")
 * - hours:             Look-back window in hours (default: 24, max: 168)
 */
router.get('/prices/history', async (req: Request, res: Response) => {
  try {
    const { source_asset, destination_asset, hours } = req.query;

    if (!source_asset || !destination_asset) {
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'Missing required parameters: source_asset, destination_asset',
      });
    }

    const hoursBack = Math.min(
      168,
      Math.max(1, parseInt((hours as string) || '24', 10) || 24),
    );

    const history = await fxAnalyticsService.getHistory(
      source_asset as string,
      destination_asset as string,
      hoursBack,
    );

    return res.json(history);
  } catch (error) {
    if (error instanceof Error) {
      return res.status(500).json({
        error: 'internal_server_error',
        message: error.message,
      });
    }
    return res.status(500).json({
      error: 'internal_server_error',
      message: 'An unexpected error occurred',
    });
  }
});

export default router;
