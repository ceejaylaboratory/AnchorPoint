import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

// Supported assets for SEP-24 transactions
const SUPPORTED_ASSETS = ['USDC', 'USD', 'BTC', 'ETH'];

interface DepositRequest {
  asset_code: string;
  account?: string;
  amount?: string;
  lang?: string;
}

interface WithdrawRequest {
  asset_code: string;
  account?: string;
  amount?: string;
  lang?: string;
  dest?: string;
  dest_extra?: string;
}

interface InteractiveResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

/**
 * POST /transactions/deposit/interactive
 * SEP-24 Interactive Deposit Endpoint
 * Returns a URL for the user to complete KYC/Deposit
 */
export const depositInteractive = (req: Request, res: Response): Response => {
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
  const response: InteractiveResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl.toString(),
    id: transactionId
  };

  return res.json(response);
};

/**
 * POST /transactions/withdraw/interactive
 * SEP-24 Interactive Withdraw Endpoint
 * Returns a URL for the user to complete KYC/Withdrawal
 */
export const withdrawInteractive = (req: Request, res: Response): Response => {
  const { asset_code, account, amount, lang = 'en', dest, dest_extra }: WithdrawRequest = req.body;

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
  const redirectUrl = new URL('/kyc-withdraw', baseUrl);
  redirectUrl.searchParams.append('transaction_id', transactionId);
  redirectUrl.searchParams.append('asset_code', asset_code);
  if (account) redirectUrl.searchParams.append('account', account);
  if (amount) redirectUrl.searchParams.append('amount', amount);
  if (dest) redirectUrl.searchParams.append('dest', dest);
  if (dest_extra) redirectUrl.searchParams.append('dest_extra', dest_extra);
  redirectUrl.searchParams.append('lang', lang);

  // Return interactive response
  const response: InteractiveResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl.toString(),
    id: transactionId
  };

  return res.json(response);
};
