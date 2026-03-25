import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  createDepositInteractiveUrl,
  createWithdrawInteractiveUrl,
  isSupportedAsset,
  normalizeAssetCode,
  SUPPORTED_ASSETS
} from '../../services/kyc.service';

const router = Router();

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
 * POST /transactions/deposit/interactive
 * SEP-24 Interactive Deposit Endpoint
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
  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
    return res.status(400).json({
      error: `Asset ${asset_code} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`
    });
  }

  // Generate unique transaction ID
  const transactionId = randomUUID();
  const baseUrl = process.env.INTERACTIVE_URL || 'http://localhost:3000';
  const redirectUrl = createDepositInteractiveUrl({
    baseUrl,
    transactionId,
    assetCode: normalizedAssetCode,
    account,
    amount,
    lang
  });

  // Return interactive response
  const response: DepositResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl.toString(),
    id: transactionId
  };

  res.json(response);
});

/**
 * POST /transactions/withdraw/interactive
 * SEP-24 Interactive Withdraw Endpoint
 * Returns a URL for the user to complete KYC/Withdraw
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
