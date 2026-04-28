import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  createWithdrawInteractiveUrl,
  createDepositInteractiveUrl,
  isSupportedAsset,
  normalizeAssetCode,
  SUPPORTED_ASSETS,
} from '../../services/kyc.service';
import prisma from '../../lib/prisma';

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
router.post('/transactions/deposit/interactive', async (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en', quote_id }: InteractiveRequest = req.body;

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required',
    });
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
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
router.post('/transactions/withdraw/interactive', async (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en', quote_id }: InteractiveRequest = req.body;

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required',
    });
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
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

export default router;
