import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { config } from '../../config/env';
import { depositInteractive, withdrawInteractive } from '../controllers/sep24.controller';
import {
  createDepositInteractiveUrl,
  createWithdrawInteractiveUrl,
  isSupportedAsset,
  normalizeAssetCode
} from '../../services/kyc.service';

const router = Router();

// Supported assets for deposit
const SUPPORTED_ASSETS = ['USDC', 'USD', 'BTC', 'ETH'];

interface DepositRequest {
  asset_code: string;
  account?: string;
  amount?: string;
  lang?: string;
}

interface DepositResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

/**
 * @swagger
 * /sep24/transactions/deposit/interactive:
 *   post:
 *     summary: SEP-24 Interactive Deposit
 *     description: Returns a URL for the user to complete KYC and deposit flow
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
 *         description: Interactive deposit URL generated successfully
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
 *         description: Invalid request - missing or unsupported asset_code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/transactions/deposit/interactive', (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en' }: DepositRequest = req.body;

  // Validate required fields
  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required'
    });
  }

  // Validate asset
  if (!SUPPORTED_ASSETS.includes(asset_code.toUpperCase())) {
    return res.status(400).json({
      error: `Asset ${asset_code} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`
    });
  }

  // Generate unique transaction ID
  const transactionId = randomUUID();

  // Build redirect URL with transaction parameters
  const baseUrl = process.env.INTERACTIVE_URL || 'http://localhost:3000';
  const redirectUrl = new URL('/kyc-deposit', baseUrl);
  redirectUrl.searchParams.append('transaction_id', transactionId);
  redirectUrl.searchParams.append('asset_code', asset_code);
  if (account) redirectUrl.searchParams.append('account', account);
  if (amount) redirectUrl.searchParams.append('amount', amount);
  redirectUrl.searchParams.append('lang', lang);

  // Return interactive response
  const response: DepositResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl.toString(),
    id: transactionId
  };

  res.json(response);
});

/**
 * @swagger
 * /sep24/transactions/withdraw/interactive:
 *   post:
 *     summary: SEP-24 Interactive Withdraw
 *     description: Returns a URL for the user to complete KYC and withdrawal flow
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
 *         description: Interactive withdraw URL generated successfully
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
 *         description: Invalid request - missing or unsupported asset_code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/transactions/withdraw/interactive', (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en' }: DepositRequest = req.body;

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required'
    });
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
    return res.status(400).json({
      error: `Asset ${asset_code} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`
    });
  }

  const transactionId = randomUUID();
  const baseUrl = process.env.INTERACTIVE_URL || 'http://localhost:3000';
  const redirectUrl = createWithdrawInteractiveUrl({
    baseUrl,
    transactionId,
    assetCode: normalizedAssetCode,
    account,
    amount,
    lang
  });

  const response: DepositResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl,
    id: transactionId
  };

  res.json(response);
});

export default router;
