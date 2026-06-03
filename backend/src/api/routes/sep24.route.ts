import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  createWithdrawInteractiveUrl,
  createDepositInteractiveUrl,
  isSupportedAsset,
  normalizeAssetCode,
  SUPPORTED_ASSETS,
} from '../../services/kyc.service';
import {
  InteractiveTokenError,
  validateInteractiveToken,
} from '../../services/sep24-interactive-token.service';
import prisma from '../../lib/prisma';
import logger from '../../utils/logger';
import { sensitiveApiLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

interface InteractiveRequest {
  asset_code: string;
  account?: string;
  amount?: string;
  lang?: string;
  quote_id?: string;
}

interface InteractiveResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

const unsupportedAssetResponse = (assetCode: string) => ({
  error: `Asset ${assetCode} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`,
});

const getBaseInteractiveUrl = (): string => process.env.INTERACTIVE_URL || 'http://localhost:3000';

/**
 * @swagger
 * /sep24/transactions/deposit/interactive:
 *   post:
 *     summary: Interactive Deposit
 *     description: SEP-24 Interactive Deposit Endpoint. Returns a URL for the user to complete KYC/Deposit.
 *     tags: [SEP-24]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset_code
 *             properties:
 *               asset_code:
 *                 type: string
 *                 description: Asset code to deposit (e.g., USDC, USD, BTC, ETH)
 *                 example: USDC
 *               account:
 *                 type: string
 *                 description: Stellar account address
 *               amount:
 *                 type: string
 *                 description: Amount to deposit
 *               lang:
 *                 type: string
 *                 description: Language preference for the UI
 *                 default: en
 *     responses:
 *       200:
 *         description: Interactive deposit URL generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   example: interactive_customer_info_needed
 *                 url:
 *                   type: string
 *                   description: URL for user to complete deposit
 *                 id:
 *                   type: string
 *                   description: Unique transaction identifier
 *       400:
 *         description: Invalid request parameters
 */
router.post('/transactions/deposit/interactive', sensitiveApiLimiter, async (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en', quote_id }: InteractiveRequest = req.body;

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required',
    });
  }

  // Validate Stellar account address if provided
  if (account) {
    try {
      const isValidAccount = /^G[A-Z0-9]{55}$/.test(account);
      if (!isValidAccount) {
        logger.warn('Invalid Stellar account address format', { account, ip: req.ip });
        return res.status(400).json({
          error: 'Invalid Stellar account address format',
        });
      }
    } catch (error) {
      logger.warn('Invalid Stellar account address format', { account, ip: req.ip, error: (error as Error).message });
      return res.status(400).json({
        error: 'Invalid Stellar account address format',
      });
    }
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
    logger.warn('Unsupported asset code requested', { asset_code, ip: req.ip });
    return res.status(400).json(unsupportedAssetResponse(asset_code));
  }

  if (quote_id) {
    const quote = await prisma.quote.findUnique({ where: { id: quote_id } });
    if (!quote) {
      return res.status(400).json({ error: 'Quote not found' });
    }
    if (new Date() > quote.expiresAt) {
      return res.status(400).json({ error: 'Quote has expired' });
    }
  }

  const transactionId = randomUUID();
  const response: InteractiveResponse = {
    type: 'interactive_customer_info_needed',
    url: createDepositInteractiveUrl({
      baseUrl: getBaseInteractiveUrl(),
      transactionId,
      assetCode: normalizedAssetCode,
      account,
      amount,
      lang,
    }),
    id: transactionId,
  };

  return res.json(response);
});

/**
 * @swagger
 * /sep24/transactions/withdraw/interactive:
 *   post:
 *     summary: Interactive Withdrawal
 *     description: SEP-24 Interactive Withdraw Endpoint. Returns a URL for the user to complete KYC/Withdraw.
 *     tags: [SEP-24]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset_code
 *             properties:
 *               asset_code:
 *                 type: string
 *                 description: Asset code to withdraw (e.g., USDC, USD, BTC, ETH)
 *                 example: USDC
 *               account:
 *                 type: string
 *                 description: Destination Stellar account address
 *               amount:
 *                 type: string
 *                 description: Amount to withdraw
 *               lang:
 *                 type: string
 *                 description: Language preference for the UI
 *                 default: en
 *     responses:
 *       200:
 *         description: Interactive withdrawal URL generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   example: interactive_customer_info_needed
 *                 url:
 *                   type: string
 *                   description: URL for user to complete withdrawal
 *                 id:
 *                   type: string
 *                   description: Unique transaction identifier
 *       400:
 *         description: Invalid request parameters
 */
router.post('/transactions/withdraw/interactive', sensitiveApiLimiter, async (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en', quote_id }: InteractiveRequest = req.body;

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required',
    });
  }

  // Validate Stellar account address if provided
  if (account) {
    try {
      const isValidAccount = /^G[A-Z0-9]{55}$/.test(account);
      if (!isValidAccount) {
        logger.warn('Invalid Stellar account address format', { account, ip: req.ip });
        return res.status(400).json({
          error: 'Invalid Stellar account address format',
        });
      }
    } catch (error) {
      logger.warn('Invalid Stellar account address format', { account, ip: req.ip, error: (error as Error).message });
      return res.status(400).json({
        error: 'Invalid Stellar account address format',
      });
    }
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
    logger.warn('Unsupported asset code requested', { asset_code, ip: req.ip });
    return res.status(400).json(unsupportedAssetResponse(asset_code));
  }

  if (quote_id) {
    const quote = await prisma.quote.findUnique({ where: { id: quote_id } });
    if (!quote) {
      return res.status(400).json({ error: 'Quote not found' });
    }
    if (new Date() > quote.expiresAt) {
      return res.status(400).json({ error: 'Quote has expired' });
    }
  }

  const transactionId = randomUUID();
  const response: InteractiveResponse = {
    type: 'interactive_customer_info_needed',
    url: createWithdrawInteractiveUrl({
      baseUrl: getBaseInteractiveUrl(),
      transactionId,
      assetCode: normalizedAssetCode,
      account,
      amount,
      lang,
    }),
    id: transactionId,
  };

  return res.json(response);
});

/**
 * @swagger
 * /sep24/interactive/validate:
 *   get:
 *     summary: Validate SEP-24 interactive URL token
 *     description: Validates the short-lived JWT embedded in a SEP-24 interactive URL before starting the hosted flow.
 *     tags: [SEP-24]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT token from the interactive URL query string
 *     responses:
 *       200:
 *         description: Token is valid
 *       401:
 *         description: Token is invalid or expired
 */
router.get('/interactive/validate', sensitiveApiLimiter, (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    const claims = validateInteractiveToken(token);

    return res.json({
      transaction_id: claims.jti,
      account: claims.sub || undefined,
      asset_code: claims.data.asset,
      amount: claims.data.amount,
      lang: claims.data.lang,
      flow: claims.data.flow,
      expires_at: new Date(claims.exp * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof InteractiveTokenError) {
      logger.warn('SEP-24 interactive token rejected', { reason: error.message });
      return res.status(401).json({ error: error.message });
    }

    logger.error('SEP-24 interactive token validation failed unexpectedly', { error });
    return res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
