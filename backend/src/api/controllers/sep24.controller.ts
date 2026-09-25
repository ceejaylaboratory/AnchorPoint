import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import cron from 'node-cron';
import logger from '../../utils/logger';

// Supported assets for SEP-24 transactions
const SUPPORTED_ASSETS = ['USDC', 'USD', 'BTC', 'ETA'];

// Session expiry: 15 minutes (SEP-24 interactive sessions must be short-lived)
export const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

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
  expires_at: string; // ISO-8601 expiry timestamp per SEP-24 §3.1
}

// ── In-memory session store ───────────────────────────────────────────────────
// For production deployments this should be backed by Redis or the database.
// The store maps transactionId → expiry timestamp (ms since epoch).
export interface Sep24Session {
  transactionId: string;
  assetCode: string;
  kind: 'deposit' | 'withdraw';
  account?: string;
  expiresAt: number; // Unix timestamp in ms
}

export const sep24Sessions = new Map<string, Sep24Session>();

/**
 * Checks whether a session exists and has not yet expired.
 * Returns the session if valid, or null if missing / expired.
 */
export function getActiveSession(transactionId: string): Sep24Session | null {
  const session = sep24Sessions.get(transactionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sep24Sessions.delete(transactionId);
    return null;
  }
  return session;
}

/**
 * Removes all sessions whose expiry time is in the past.
 * Called periodically by the background cron job.
 */
export function purgeExpiredSessions(): number {
  const now = Date.now();
  let purgedCount = 0;
  for (const [id, session] of sep24Sessions) {
    if (now > session.expiresAt) {
      sep24Sessions.delete(id);
      purgedCount++;
    }
  }
  if (purgedCount > 0) {
    logger.info(`[SEP-24] Purged ${purgedCount} expired interactive session(s)`);
  }
  return purgedCount;
}

// ── Background cron: purge expired sessions every minute ─────────────────────
let _cronStarted = false;

export function startSep24SessionPurgeCron(): void {
  if (_cronStarted) return;
  _cronStarted = true;

  cron.schedule('*/1 * * * *', () => {
    try {
      purgeExpiredSessions();
    } catch (err) {
      logger.error('[SEP-24] Session purge cron error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info('[SEP-24] Interactive session expiry cron started (every 1 min)');
}

// ── Helper ────────────────────────────────────────────────────────────────────

function isAssetSupported(assetCode: string): boolean {
  return SUPPORTED_ASSETS.includes(assetCode.toUpperCase());
}

/**
 * POST /transactions/deposit/interactive
 * SEP-24 Interactive Deposit Endpoint
 * Returns a URL for the user to complete KYC/Deposit.
 * Sessions expire after 15 minutes; stale sessions are rejected.
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
  if (!isAssetSupported(asset_code)) {
    return res.status(400).json({
      error: `Asset ${asset_code} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`
    });
  }

  // Generate unique transaction ID
  const transactionId = randomUUID();

  // Compute session expiry
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const expiresAtIso = new Date(expiresAt).toISOString();

  // Persist session so /interact can validate it later
  sep24Sessions.set(transactionId, {
    transactionId,
    assetCode: asset_code.toUpperCase(),
    kind: 'deposit',
    account,
    expiresAt,
  });

  // Build redirect URL with transaction parameters
  const baseUrl = process.env.INTERACTIVE_URL || 'http://localhost:3000';
  const redirectUrl = new URL('/kyc-deposit', baseUrl);
  redirectUrl.searchParams.append('transaction_id', transactionId);
  redirectUrl.searchParams.append('asset_code', asset_code);
  if (account) redirectUrl.searchParams.append('account', account);
  if (amount) redirectUrl.searchParams.append('amount', amount);
  redirectUrl.searchParams.append('lang', lang);

  // Return interactive response with expiry
  const response: InteractiveResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl.toString(),
    id: transactionId,
    expires_at: expiresAtIso,
  };

  return res.json(response);
};

/**
 * POST /transactions/withdraw/interactive
 * SEP-24 Interactive Withdraw Endpoint
 * Returns a URL for the user to complete KYC/Withdrawal.
 * Sessions expire after 15 minutes; stale sessions are rejected.
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
  if (!isAssetSupported(asset_code)) {
    return res.status(400).json({
      error: `Asset ${asset_code} is not supported. Supported assets: ${SUPPORTED_ASSETS.join(', ')}`
    });
  }

  // Generate unique transaction ID
  const transactionId = randomUUID();

  // Compute session expiry
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const expiresAtIso = new Date(expiresAt).toISOString();

  // Persist session so /interact can validate it later
  sep24Sessions.set(transactionId, {
    transactionId,
    assetCode: asset_code.toUpperCase(),
    kind: 'withdraw',
    account,
    expiresAt,
  });

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

  // Return interactive response with expiry
  const response: InteractiveResponse = {
    type: 'interactive_customer_info_needed',
    url: redirectUrl.toString(),
    id: transactionId,
    expires_at: expiresAtIso,
  };

  return res.json(response);
};

/**
 * GET /transactions/:id/interact
 * Validates that a SEP-24 interactive session is still active before
 * redirecting the user into the KYC flow.  Returns 410 Gone when the
 * session has expired so the client knows to restart the flow.
 */
export const validateInteractiveSession = (req: Request, res: Response): Response => {
  const { id } = req.params as { id: string };

  if (!id) {
    return res.status(400).json({ error: 'transaction_id is required' });
  }

  const session = getActiveSession(id);

  if (!session) {
    return res.status(410).json({
      error: 'session_expired',
      message: 'This interactive session has expired. Please restart the flow.',
    });
  }

  return res.json({
    transaction_id: session.transactionId,
    asset_code: session.assetCode,
    kind: session.kind,
    expires_at: new Date(session.expiresAt).toISOString(),
  });
};
