import { Router, Request, Response } from 'express';
import { sep38Controller } from '../controllers/sep38.controller';

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
      parseFloat(source_amount as string),
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
  try {
    const { source_asset, source_amount, destination_asset, context } = req.body;

    // Validate required parameters
    if (!source_asset || !source_amount || !destination_asset) {
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'Missing required parameters: source_asset, source_amount, destination_asset',
      });
    }

    const priceQuote = await sep38Controller.createQuote(
      source_asset,
      parseFloat(source_amount),
      destination_asset,
      context,
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

export default router;
