import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { QuoteStatus } from '@prisma/client';
import {
  createWithdrawInteractiveUrl,
  createDepositInteractiveUrl,
  isSupportedAsset,
  normalizeAssetCode,
  SUPPORTED_ASSETS,
} from '../../services/kyc.service';
import prisma from '../../lib/prisma';
import { isValidStellarPublicKey } from '../../utils/stellar-address';
import { sep24MetricsMiddleware } from '../middleware/sep24-metrics.middleware';
import { Sep24Service, Sep24MemoType } from '../../services/sep24.service';

const router = Router();

router.use(sep24MetricsMiddleware);

const ALLOWED_CALLBACK_PROTOCOLS = ['https:'];

function isValidCallbackUrl(callback: unknown): boolean {
  if (typeof callback !== 'string') return false;
  try {
    const url = new URL(callback);
    return ALLOWED_CALLBACK_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

interface InteractiveRequest {
  asset_code: string;
  account?: string;
  amount?: string;
  lang?: string;
  quote_id?: string;
  redirect_url?: string;
  on_change_callback?: string;
  callback?: string;
  memo?: string;
  memo_type?: string;
}

const VALID_MEMO_TYPES: Sep24MemoType[] = ['text', 'id', 'hash'];

function validateMemoFields(memo: string | undefined, memoType: string | undefined): string | null {
  if (memo === undefined) return null;

  const resolvedMemoType = memoType ?? 'text';
  if (!VALID_MEMO_TYPES.includes(resolvedMemoType as Sep24MemoType)) {
    return 'memo_type must be one of text, id, hash';
  }

  if (!Sep24Service.validateMemo(memo, resolvedMemoType as Sep24MemoType)) {
    return `memo is invalid for memo_type ${resolvedMemoType}`;
  }

  return null;
}

interface InteractiveResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

const unsupportedAssetResponse = (assetCode: string) => ({
  error: `Asset ${assetCode} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`,
});

const invalidAccountResponse = () => ({
  error: 'account must be a valid Stellar public key',
});

const getBaseInteractiveUrl = (): string => process.env.INTERACTIVE_URL || 'http://localhost:3000';

const hasInvalidAccount = (account: unknown): boolean =>
  account !== undefined && !isValidStellarPublicKey(account);

// Helper to convert Date to Unix epoch seconds
const toEpochSeconds = (date: Date | null | undefined): number | null => {
  if (date === null || date === undefined) return null;
  return Math.floor(date.getTime() / 1000);
};

/**
 * @swagger
 * /sep24/transactions/deposit/interactive:
 * post:
 * summary: Interactive Deposit
 * description: SEP-24 Interactive Deposit Endpoint. Returns a URL for the user to complete KYC/Deposit.
 * tags: [SEP-24]
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required:
 *           - asset_code
 *         properties:
 *           asset_code:
 *             type: string
 *             description: Asset code to deposit (e.g., USDC, USD, BTC, ETH)
 *             example: USDC
 *           account:
 *             type: string
 *             description: Stellar Ed25519 public key (G...)
 *           amount:
 *             type: string
 *             description: Amount to deposit
 *           lang:
 *             type: string
 *             description: Language preference for the UI
 *             default: en
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
  const { asset_code, account, amount, lang = 'en', quote_id, redirect_url, on_change_callback, callback, memo, memo_type }: InteractiveRequest = req.body;

  const allowedDomains = process.env.SEP24_ALLOWED_CALLBACK_DOMAINS
    ? process.env.SEP24_ALLOWED_CALLBACK_DOMAINS.split(',').filter(Boolean)
    : [];

  if (redirect_url && allowedDomains.length > 0 && !Sep24Service.validateCallbackUrl(redirect_url, allowedDomains)) {
    return res.status(400).json({ error: 'invalid redirect_url domain' });
  }

  if (on_change_callback && allowedDomains.length > 0 && !Sep24Service.validateCallbackUrl(on_change_callback, allowedDomains)) {
    return res.status(400).json({ error: 'invalid on_change_callback domain' });
  }

  const memoError = validateMemoFields(memo, memo_type);
  if (memoError) {
    return res.status(400).json({ error: memoError });
  }

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required',
    });
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
    return res.status(400).json(unsupportedAssetResponse(asset_code));
  }

  if (hasInvalidAccount(account)) {
    return res.status(400).json(invalidAccountResponse());
  }

  if (callback !== undefined && !isValidCallbackUrl(callback)) {
    return res.status(400).json({ error: 'callback must be a valid HTTPS URL' });
  }

  if (quote_id) {
    const quote = await prisma.quote.findUnique({ where: { id: quote_id } });
    if (!quote) {
      return res.status(400).json({ error: 'Quote not found' });
    }
    if (quote.status === QuoteStatus.EXPIRED || (quote.expiresAt && new Date() > quote.expiresAt)) {
      return res.status(400).json({ error: 'Quote has expired' });
    }
  }

  const transactionId = randomUUID();

  const partnerCallback = on_change_callback || callback;
  if (partnerCallback) {
    await Sep24Service.storeCallback(transactionId, {
      callbackUrl: partnerCallback,
      kind: 'deposit',
      assetCode: normalizedAssetCode,
      amount,
      account,
    });
  }

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
 * post:
 * summary: Interactive Withdrawal
 * description: SEP-24 Interactive Withdraw Endpoint. Returns a URL for the user to complete KYC/Withdraw.
 * tags: [SEP-24]
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required:
 *           - asset_code
 *         properties:
 *           asset_code:
 *             type: string
 *             description: Asset code to withdraw (e.g., USDC, USD, BTC, ETH)
 *               example: USDC
 *           account:
 *             type: string
 *             description: Destination Stellar Ed25519 public key (G...)
 *           amount:
 *             type: string
 *             description: Amount to withdraw
 *           lang:
 *             type: string
 *             description: Language preference for the UI
 *             default: en
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
 *                   description: URL for user to complete withdraw
 *                 id:
 *                   type: string
 *                   description: Unique transaction identifier
 *       400:
 *         description: Invalid request parameters
 */
router.post('/transactions/withdraw/interactive', async (req: Request, res: Response) => {
  const { asset_code, account, amount, lang = 'en', quote_id, redirect_url, on_change_callback, callback, memo, memo_type }: InteractiveRequest = req.body;

  const allowedDomains = process.env.SEP24_ALLOWED_CALLBACK_DOMAINS
    ? process.env.SEP24_ALLOWED_CALLBACK_DOMAINS.split(',').filter(Boolean)
    : [];

  if (redirect_url && allowedDomains.length > 0 && !Sep24Service.validateCallbackUrl(redirect_url, allowedDomains)) {
    return res.status(400).json({ error: 'invalid redirect_url domain' });
  }

  if (on_change_callback && allowedDomains.length > 0 && !Sep24Service.validateCallbackUrl(on_change_callback, allowedDomains)) {
    return res.status(400).json({ error: 'invalid on_change_callback domain' });
  }

  const memoError = validateMemoFields(memo, memo_type);
  if (memoError) {
    return res.status(400).json({ error: memoError });
  }

  if (!asset_code) {
    return res.status(400).json({
      error: 'asset_code is required',
    });
  }

  const normalizedAssetCode = normalizeAssetCode(asset_code);
  if (!isSupportedAsset(normalizedAssetCode)) {
    return res.status(400).json(unsupportedAssetResponse(asset_code));
  }

  if (hasInvalidAccount(account)) {
    return res.status(400).json(invalidAccountResponse());
  }

  if (callback !== undefined && !isValidCallbackUrl(callback)) {
    return res.status(400).json({ error: 'callback must be a valid HTTPS URL' });
  }

  if (quote_id) {
    const quote = await prisma.quote.findUnique({ where: { id: quote_id } });
    if (!quote) {
      return res.status(400).json({ error: 'Quote not found' });
    }
    if (quote.status === QuoteStatus.EXPIRED || (quote.expiresAt && new Date() > quote.expiresAt)) {
      return res.status(400).json({ error: 'Quote has expired' });
    }
  }

  const transactionId = randomUUID();

  const partnerCallback = on_change_callback || callback;
  if (partnerCallback) {
    await Sep24Service.storeCallback(transactionId, {
      callbackUrl: partnerCallback,
      kind: 'withdrawal',
      assetCode: normalizedAssetCode,
      amount,
      account,
    });
  }

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
 * /sep24/transaction:
 * get:
 * summary: SEP-24 Transaction Status
 * description: SEP-24 Transaction Status Endpoint. Returns details of a specific transaction by id, stellar_transaction_id, or external_transaction_id.
 * tags: [SEP-24]
 * parameters:
 *   - in: query
 *     name: id
 *     schema:
 *       type: string
 *     description: Anchor transaction ID
 *   - in: query
 *     name: stellar_transaction_id
 *     schema:
 *       type: string
 *     description: Stellar transaction hash
 *   - in: query
 *     name: external_transaction_id
 *     schema:
 *       type: string
 *       description: External transaction ID
 *     responses:
 *       200:
 *         description: Transaction details
 *       400:
 *         description: Missing query parameter or missing stellar transaction hash
 *       404:
 *         description: Transaction not found
 */
router.get('/transaction', async (req: Request, res: Response) => {
  const { id, stellar_transaction_id, external_transaction_id } = req.query as Record<string, string>;

  if (!id && !stellar_transaction_id && !external_transaction_id) {
    return res.status(400).json({ error: 'One of id, stellar_transaction_id, or external_transaction_id is required' });
  }

  try {
    const transaction = await prisma.transaction.findFirst({
      where: {
        ...(id && { id }),
        ...(stellar_transaction_id && { stellarTxId: stellar_transaction_id }),
        ...(external_transaction_id && { externalId: external_transaction_id }),
      },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Strict null check guard for stellar transaction hash
    const stellarTxHash = transaction.stellarTxId ?? stellar_transaction_id ?? null;
    if (!stellarTxHash) {
      return res.status(400).json({ error: 'Stellar transaction hash is missing or invalid' });
    }

    const stored = await Sep24Service.getCallback(transaction.id);
    const validHash: string = stellarTxHash;

    const startedAt = toEpochSeconds((transaction as any).startedAt ?? transaction.createdAt);
    const completedAt = toEpochSeconds((transaction as any).completedAt ?? transaction.updatedAt);

    return res.json({
      transaction: {
        id: transaction.id,
        kind: transaction.type.toLowerCase(),
        status: transaction.status.toLowerCase(),
        amount_in: transaction.type === 'DEPOSIT' ? transaction.amount : undefined,
        started_at: startedAt ?? 0,
        ...(completedAt !== null ? { completed_at: completedAt } : {}),
        stellar_transaction_id: validHash,
        external_transaction_id: transaction.externalId ?? undefined,
        claimable_balance_id: stored?.claimableBalanceId ?? (transaction as any).claimableBalanceId ?? undefined,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

/**
 * @swagger
 * /sep24/transactions/{id}/status:
 *   patch:
 *     summary: Update SEP-24 transaction status and notify partner webhook
 *     description: >
 *       Updates deposit/withdrawal status and emits an idempotent partner webhook
 *       (Idempotency-Key header, Redis delivery-hash dedupe, retry queue).
 *     tags: [SEP-24]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *               previous_status:
 *                 type: string
 *               claimable_balance_id:
 *                 type: string
 *                 description: Stellar claimable balance ID for deposit redemptions
 *               callback:
 *                 type: string
 *                 description: Optional override callback URL when not stored at interactive start
 *     responses:
 *       200:
 *         description: Status updated and webhook handled
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Transaction / callback not found
 */
router.patch('/transactions/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, previous_status, callback: callbackOverride, claimable_balance_id } = req.body as {
    status?: string;
    previous_status?: string;
    callback?: string;
    claimable_balance_id?: string;
  };

  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'status is required' });
  }

  const stored = await Sep24Service.getCallback(id);
  const callbackUrl = (typeof callbackOverride === 'string' && isValidCallbackUrl(callbackOverride)
    ? callbackOverride
    : stored?.callbackUrl) ?? null;

  if (!callbackUrl) {
    return res.status(404).json({
      error: 'No partner callback configured for this transaction',
    });
  }

  if (claimable_balance_id && stored) {
    stored.claimableBalanceId = claimable_balance_id;
    await Sep24Service.storeCallback(id, stored);
  }

  const effectiveClaimableBalanceId = claimable_balance_id || stored?.claimableBalanceId;
  const previousStatus = previous_status ?? 'pending_user';
  const kind = stored?.kind ?? 'deposit';

  let updatedTransaction = null;
  try {
    updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: { status: status.toUpperCase() },
    });
  } catch {
    // Transaction may not exist yet (interactive-only flow); still notify partner.
  }

  const isClaimableEvent = status.toLowerCase() === 'pending_external' || !!effectiveClaimableBalanceId;

  const webhookDelivery = await Sep24Service.notifyStatusChange({
    transactionId: id,
    kind,
    previousStatus,
    nextStatus: status,
    callbackUrl,
    claimableBalanceId: effectiveClaimableBalanceId,
    event: isClaimableEvent ? 'sep24.transaction.claimable' : 'sep24.transaction.status_changed',
    amount: stored?.amount ?? updatedTransaction?.amount,
    assetCode: stored?.assetCode ?? updatedTransaction?.assetCode,
    stellarTransactionId: updatedTransaction?.stellarTxId ?? undefined,
    externalTransactionId: updatedTransaction?.externalId ?? undefined,
  });

  return res.json({
    id,
    status,
    previous_status: previousStatus,
    claimable_balance_id: effectiveClaimableBalanceId,
    webhook: webhookDelivery,
  });
});

export default router;