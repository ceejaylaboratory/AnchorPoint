import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  getInfo,
  createTransaction,
  getTransaction,
} from "../controllers/sep31.controller";

const router = Router();

// Body schema for POST /sep31/transactions
const createTransactionBodySchema = z.object({
  asset_code: z.string().min(1),
  amount: z.string().min(1),
  sender_info: z.record(z.string(), z.string()),
  receiver_info: z.record(z.string(), z.string()),
  callback: z.string().url().optional(),
});

/**
 * @swagger
 * /sep31/info:
 *   get:
 *     summary: SEP-31 anchor info
 *     description: Returns receivable assets with limits, fees and required sender/receiver KYC fields.
 *     tags: [SEP-31]
 *     responses:
 *       200:
 *         description: Receivable assets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 receive:
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
 *                       sender_info_needed:
 *                         type: object
 *                       receiver_info_needed:
 *                         type: object
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get("/info", getInfo);

/**
 * @swagger
 * /sep31/transactions:
 *   post:
 *     summary: Create a SEP-31 payment
 *     description: Initiates a new cross-border payment.
 *     tags: [SEP-31]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset_code
 *               - amount
 *               - sender_info
 *               - receiver_info
 *             properties:
 *               asset_code:
 *                 type: string
 *               amount:
 *                 type: string
 *               sender_info:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *               receiver_info:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *               callback:
 *                 type: string
 *                 description: URL for status callbacks
 *                 format: uri
 *     responses:
 *       201:
 *         description: Payment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 stellar_account_id:
 *                   type: string
 *       400:
 *         description: Invalid request or unsupported asset
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
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.post(
  "/transactions",
  authMiddleware,
  validate({ body: createTransactionBodySchema }),
  createTransaction,
);

/**
 * @swagger
 * /sep31/transactions/{id}:
 *   get:
 *     summary: Get a SEP-31 payment
 *     tags: [SEP-31]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *     responses:
 *       200:
 *         description: Payment details
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
 *                     status:
 *                       type: string
 *                     amount_in:
 *                       type: string
 *                     amount_out:
 *                       type: string
 *                       nullable: true
 *                     amount_fee:
 *                       type: string
 *                       nullable: true
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
 *                       nullable: true
 *                     last_status_update:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     status_history:
 *                       type: array
 *                       items:
 *                         type: object
 *                     refunded:
 *                       type: boolean
 *                     required_info_message:
 *                       type: string
 *                       nullable: true
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
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get("/transactions/:id", authMiddleware, getTransaction);

export default router;
