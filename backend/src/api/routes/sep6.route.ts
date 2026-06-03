import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  sep6Info,
  sep6Deposit,
  sep6Withdraw,
  sep6GetTransaction,
  sep6GetTransactions,
} from '../controllers/sep6.controller';

const router = Router();

const depositQuerySchema = z.object({
  asset_code: z.string().min(1, 'asset_code is required'),
  /** Stellar account that should receive the deposited funds (optional per SEP-6). */
  account: z.string().optional(),
  amount: z.string().optional(),
  email_address: z.string().email().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  /** Memo value the sender should attach to their Stellar payment. */
  memo: z.string().optional(),
  /** Memo type: text (default), id, or hash. */
  memo_type: z.enum(['text', 'id', 'hash']).optional(),
  /** URL the anchor should POST status updates to (SEP-6 §4.1). */
  callback_url: z.string().url().optional(),
  lang: z.string().optional(),
});

const withdrawQuerySchema = z.object({
  asset_code: z.string().min(1, 'asset_code is required'),
  /** Stellar account that is initiating the withdrawal (optional per SEP-6). */
  account: z.string().optional(),
  amount: z.string().optional(),
  dest: z.string().min(1, 'dest is required'),
  dest_extra: z.string().optional(),
  type: z.enum(['bank_account', 'crypto']).optional(),
  /** URL the anchor should POST status updates to (SEP-6 §4.1). */
  callback_url: z.string().url().optional(),
  lang: z.string().optional(),
});

const transactionQuerySchema = z.object({
  id: z.string().optional(),
  stellar_transaction_id: z.string().optional(),
  external_transaction_id: z.string().optional(),
});

const transactionsQuerySchema = z.object({
  asset_code: z.string().optional(),
  limit: z.string().optional(),
  paging_id: z.string().optional(),
  no_older_than: z.string().datetime({ offset: true }).optional(),
});

// GET /sep6/info — public, no auth required
router.get('/info', sep6Info);

// GET /sep6/deposit — requires SEP-10 auth
router.get('/deposit', authMiddleware, validate({ query: depositQuerySchema }), sep6Deposit);

// GET /sep6/withdraw — requires SEP-10 auth
router.get('/withdraw', authMiddleware, validate({ query: withdrawQuerySchema }), sep6Withdraw);

// GET /sep6/transaction — requires SEP-10 auth
router.get('/transaction', authMiddleware, validate({ query: transactionQuerySchema }), sep6GetTransaction);

// GET /sep6/transactions — requires SEP-10 auth
router.get('/transactions', authMiddleware, validate({ query: transactionsQuerySchema }), sep6GetTransactions);

export default router;
