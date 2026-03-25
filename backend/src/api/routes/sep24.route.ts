import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { config } from '../../config/env';
import { depositInteractive, withdrawInteractive } from '../controllers/sep24.controller';

const router = Router();

/**
 * POST /transactions/deposit/interactive
 * SEP-24 Interactive Deposit Endpoint
 */
router.post('/transactions/deposit/interactive', depositInteractive);

  // Generate unique transaction ID
  const transactionId = randomUUID();

  // Build redirect URL with transaction parameters
  const baseUrl = config.INTERACTIVE_URL;
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
 * POST /transactions/withdraw/interactive
 * SEP-24 Interactive Withdraw Endpoint
 */
router.post('/transactions/withdraw/interactive', withdrawInteractive);

export default router;
