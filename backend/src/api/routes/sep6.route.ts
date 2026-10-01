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

const depositQuerySchema = z
  .object({
    asset_code: z.string().min(1, 'asset_code is required'),
    /** Stellar account that should receive the deposited funds (optional per SEP-6). */
    account: z.string().optional(),
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string')
      .optional(),
    type: z.enum(['bank_account', 'crypto', 'cash', 'wire', 'mobile_money']).optional(),
    location_id: z.string().optional(),
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
  })
  .superRefine((data, ctx) => {
    if (data.memo && data.memo_type === 'id' && !/^\d+$/.test(data.memo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memo'],
        message: 'memo must be a positive integer string when memo_type is id',
      });
    }
    if (data.memo && data.memo_type === 'text' && Buffer.byteLength(data.memo, 'utf8') > 28) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memo'],
        message: 'memo must be at most 28 bytes when memo_type is text',
      });
    }
  });

const withdrawQuerySchema = z.object({
  asset_code: z.string().min(1, 'asset_code is required'),
  /** Stellar account that is initiating the withdrawal (optional per SEP-6). */
  account: z.string().optional(),
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string')
    .optional(),
  dest: z.string().min(1, 'dest is required'),
  dest_extra: z.string().optional(),
  type: z.enum(['bank_account', 'crypto', 'cash', 'wire', 'mobile_money']).optional(),
  location_id: z.string().optional(),
  /** Memo value to attach to withdrawal transaction. */
  memo: z.string().optional(),
  memo_type: z.enum(['text', 'id', 'hash']).optional(),
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

/**
 * @swagger
 * /sep6/info:
 *   get:
 *     summary: SEP-6 anchor info
 *     description: Lists assets enabled for non-interactive deposit and withdrawal, with limits, fees and required fields.
 *     tags: [SEP-6]
 *     responses:
 *       200:
 *         description: Supported deposit and withdrawal assets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deposit:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       enabled:
 *                         type: boolean
 *                       min_amount:
 *                         type: number
 *                       max_amount:
 *                         type: number
 *                       fee_fixed:
 *                         type: number
 *                       fee_percent:
 *                         type: number
 *                       fields:
 *                         type: object
 *                 withdraw:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       enabled:
 *                         type: boolean
 *                       min_amount:
 *                         type: number
 *                       max_amount:
 *                         type: number
 *                       fee_fixed:
 *                         type: number
 *                       fee_percent:
 *                         type: number
 *                       types:
 *                         type: object
 */
router.get('/info', sep6Info);

/**
 * @swagger
 * /sep6/deposit:
 *   get:
 *     summary: Initiate a SEP-6 deposit
 *     description: Creates a pending deposit transaction and returns instructions for sending funds to the anchor.
 *     tags: [SEP-6]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: asset_code
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset to deposit
 *       - in: query
 *         name: account
 *         schema:
 *           type: string
 *         description: Stellar account that receives the deposited funds
 *       - in: query
 *         name: amount
 *         schema:
 *           type: string
 *           pattern: ^\d+(\.\d+)?$
 *         description: Amount to deposit (positive decimal string)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum:
 *             - bank_account
 *             - crypto
 *             - cash
 *             - wire
 *             - mobile_money
 *         description: Deposit method
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *         description: Cash drop-off location ID
 *       - in: query
 *         name: email_address
 *         schema:
 *           type: string
 *           format: email
 *         description: Depositor email address
 *       - in: query
 *         name: first_name
 *         schema:
 *           type: string
 *         description: Depositor first name
 *       - in: query
 *         name: last_name
 *         schema:
 *           type: string
 *         description: Depositor last name
 *       - in: query
 *         name: memo
 *         schema:
 *           type: string
 *         description: Memo to attach to the Stellar payment
 *       - in: query
 *         name: memo_type
 *         schema:
 *           type: string
 *           enum:
 *             - text
 *             - id
 *             - hash
 *         description: Memo type
 *       - in: query
 *         name: callback_url
 *         schema:
 *           type: string
 *           format: uri
 *         description: URL the anchor POSTs status updates to
 *       - in: query
 *         name: lang
 *         schema:
 *           type: string
 *         description: Language code for human-readable messages
 *     responses:
 *       200:
 *         description: Deposit instructions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 how:
 *                   type: string
 *                 id:
 *                   type: string
 *                 eta:
 *                   type: integer
 *                 min_amount:
 *                   type: number
 *                 max_amount:
 *                   type: number
 *                 fee_fixed:
 *                   type: number
 *                 fee_percent:
 *                   type: number
 *                 fee_amount:
 *                   type: string
 *                 extra_info:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     memo:
 *                       type: string
 *                     memo_type:
 *                       type: string
 *                     receiving_account:
 *                       type: string
 *       400:
 *         description: Invalid query parameters or unsupported asset
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Failed to initiate deposit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get('/deposit', authMiddleware, validate({ query: depositQuerySchema }), sep6Deposit);

/**
 * @swagger
 * /sep6/withdraw:
 *   get:
 *     summary: Initiate a SEP-6 withdrawal
 *     description: Creates a pending withdrawal transaction and returns the anchor account and memo to pay.
 *     tags: [SEP-6]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: asset_code
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset to withdraw
 *       - in: query
 *         name: dest
 *         required: true
 *         schema:
 *           type: string
 *         description: Destination bank account or crypto address
 *       - in: query
 *         name: dest_extra
 *         schema:
 *           type: string
 *         description: Extra destination info, e.g. bank routing number
 *       - in: query
 *         name: account
 *         schema:
 *           type: string
 *         description: Stellar account initiating the withdrawal
 *       - in: query
 *         name: amount
 *         schema:
 *           type: string
 *           pattern: ^\d+(\.\d+)?$
 *         description: Amount to withdraw (positive decimal string)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum:
 *             - bank_account
 *             - crypto
 *             - cash
 *             - wire
 *             - mobile_money
 *         description: Withdrawal method
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *         description: Cash pick-up location ID
 *       - in: query
 *         name: memo
 *         schema:
 *           type: string
 *         description: Memo to attach to the Stellar payment
 *       - in: query
 *         name: memo_type
 *         schema:
 *           type: string
 *           enum:
 *             - text
 *             - id
 *             - hash
 *         description: Memo type
 *       - in: query
 *         name: callback_url
 *         schema:
 *           type: string
 *           format: uri
 *         description: URL the anchor POSTs status updates to
 *       - in: query
 *         name: lang
 *         schema:
 *           type: string
 *         description: Language code for human-readable messages
 *     responses:
 *       200:
 *         description: Withdrawal instructions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 account_id:
 *                   type: string
 *                 memo_type:
 *                   type: string
 *                 memo:
 *                   type: string
 *                 id:
 *                   type: string
 *                 eta:
 *                   type: integer
 *                 min_amount:
 *                   type: number
 *                 max_amount:
 *                   type: number
 *                 fee_fixed:
 *                   type: number
 *                 fee_percent:
 *                   type: number
 *                 fee_amount:
 *                   type: string
 *                 amount_out:
 *                   type: string
 *                 type:
 *                   type: string
 *                 extra_info:
 *                   type: object
 *       400:
 *         description: Invalid query parameters or unsupported asset
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Failed to initiate withdrawal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get('/withdraw', authMiddleware, validate({ query: withdrawQuerySchema }), sep6Withdraw);

/**
 * @swagger
 * /sep6/transaction:
 *   get:
 *     summary: Get a SEP-6 transaction
 *     description: Returns a single transaction. One of id, stellar_transaction_id or external_transaction_id is required.
 *     tags: [SEP-6]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         schema:
 *           type: string
 *         description: Anchor transaction ID
 *       - in: query
 *         name: stellar_transaction_id
 *         schema:
 *           type: string
 *         description: Stellar transaction hash
 *       - in: query
 *         name: external_transaction_id
 *         schema:
 *           type: string
 *         description: External transaction ID
 *     responses:
 *       200:
 *         description: Transaction details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     kind:
 *                       type: string
 *                       enum:
 *                         - deposit
 *                         - withdraw
 *                     status:
 *                       type: string
 *                     amount_in:
 *                       type: string
 *                     amount_out:
 *                       type: string
 *                     asset_code:
 *                       type: string
 *                     stellar_transaction_id:
 *                       type: string
 *                       nullable: true
 *                     external_transaction_id:
 *                       type: string
 *                       nullable: true
 *                     started_at:
 *                       type: string
 *                       format: date-time
 *                     completed_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: No transaction identifier provided
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Failed to fetch transaction
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get('/transaction', authMiddleware, validate({ query: transactionQuerySchema }), sep6GetTransaction);

/**
 * @swagger
 * /sep6/transactions:
 *   get:
 *     summary: List SEP-6 transactions
 *     description: Returns the authenticated account's SEP-6 transactions.
 *     tags: [SEP-6]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: asset_code
 *         schema:
 *           type: string
 *         description: Filter by asset
 *       - in: query
 *         name: limit
 *         schema:
 *           type: string
 *         description: Maximum number of transactions to return
 *       - in: query
 *         name: paging_id
 *         schema:
 *           type: string
 *         description: Return transactions older than this transaction ID
 *       - in: query
 *         name: no_older_than
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only return transactions started at or after this time
 *     responses:
 *       200:
 *         description: Transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       kind:
 *                         type: string
 *                         enum:
 *                           - deposit
 *                           - withdraw
 *                       status:
 *                         type: string
 *                       amount_in:
 *                         type: string
 *                       amount_out:
 *                         type: string
 *                       asset_code:
 *                         type: string
 *                       stellar_transaction_id:
 *                         type: string
 *                         nullable: true
 *                       external_transaction_id:
 *                         type: string
 *                         nullable: true
 *                       started_at:
 *                         type: string
 *                         format: date-time
 *                       completed_at:
 *                         type: string
 *                         format: date-time
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Failed to fetch transactions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get('/transactions', authMiddleware, validate({ query: transactionsQuerySchema }), sep6GetTransactions);

export default router;
