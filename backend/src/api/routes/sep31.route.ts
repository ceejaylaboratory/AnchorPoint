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
 * GET /sep31/info
 * Returns supported assets and required KYC fields — no auth required.
 */
router.get("/info", getInfo);

/**
 * POST /sep31/transactions
 * Initiates a new SEP-31 cross-border payment.
 */
router.post(
  "/transactions",
  authMiddleware,
  validate({ body: createTransactionBodySchema }),
  createTransaction,
);

/**
 * GET /sep31/transactions/:id
 * Retrieves a SEP-31 transaction by ID.
 */
router.get("/transactions/:id", authMiddleware, getTransaction);

export default router;
