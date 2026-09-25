import { Router, Request, Response, NextFunction } from "express";
import {
  createSep31Transaction,
  getSep31Transaction,
  getSep31Info,
} from "./service";
import {
  validateTransactionRequest,
  validateReceiverInfo,
} from "./validation";
import { Sep31TransactionRequest, Sep31ErrorResponse, Sep31Config } from "./types";
import { configService } from "../services/config.service";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────

function sep31Error(
  res: Response,
  status: number,
  message: string,
  id?: string
): void {
  const body: Sep31ErrorResponse = { error: message };
  if (id) body.id = id;
  res.status(status).json(body);
}

/**
 * Returns the current SEP-31 configuration from the dynamic SystemConfig.
 * When the config service is unavailable or SEP-31 settings haven't been
 * seeded yet, the underlying service and validation functions fall back to
 * sensible hard-coded defaults.
 */
function getSep31Config(): Sep31Config {
  return configService.getSep31Config() as unknown as Sep31Config;
}

// ─── GET /sep31/info ───────────────────────────────────────────────────────
/**
 * Returns anchor capabilities and required fields for SEP-31 senders.
 * No authentication required.
 * The asset list and fee values are sourced from the dynamic SystemConfig.
 */
router.get("/info", (_req: Request, res: Response) => {
  res.json(getSep31Info(getSep31Config()));
});

// ─── POST /sep31/transactions ──────────────────────────────────────────────
/**
 * Initiates a new cross-border payment transaction.
 *
 * The sending anchor POSTs this with sender/receiver KYC identifiers and the
 * payment amount. The response contains the Stellar account, memo, and a
 * transparent fee breakdown.
 *
 * Amount limits and asset-support checks are validated against the dynamic
 * SystemConfig.
 *
 * Requires a valid SEP-10 JWT (enforced by the auth middleware applied in
 * app.ts before mounting this router).
 */
router.post(
  "/transactions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Partial<Sep31TransactionRequest>;
      const sep31Config = getSep31Config();

      // ── Field validation (against SystemConfig-driven limits) ──────────
      const { valid, errors } = validateTransactionRequest(body, sep31Config);
      if (!valid) {
        const firstError = errors[0];
        return sep31Error(
          res,
          400,
          `${firstError.field}: ${firstError.message}`
        );
      }

      // ── Receiver info validation (when receiver_id is not provided) ────
      if (!body.receiver_id && body.receiver_info) {
        const infoErrors = validateReceiverInfo(body.receiver_info);
        if (infoErrors.length > 0) {
          return sep31Error(
            res,
            400,
            infoErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          );
        }
      }

      // ── Create transaction with config-driven fees ─────────────────────
      const result = await createSep31Transaction(
        body as Sep31TransactionRequest,
        sep31Config
      );

      return res.status(201).json(result);
    } catch (err) {
      if (err instanceof Error && /^quote_(not_found|expired|already_used)/.test(err.message)) {
        return sep31Error(res, 400, err.message);
      }
      next(err);
    }
  }
);

// ─── GET /sep31/transactions/:id ──────────────────────────────────────────
/**
 * Returns the current state of a SEP-31 transaction.
 *
 * Used by the sending anchor to poll for status updates after initiating the
 * Stellar payment.
 */
router.get(
  "/transactions/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== "string") {
        return sep31Error(res, 400, "Transaction ID is required.");
      }

      const transaction = await getSep31Transaction(id);

      if (!transaction) {
        return sep31Error(res, 404, "Transaction not found.", id);
      }

      return res.json({ transaction });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /sep31/transactions/:id ────────────────────────────────────────
/**
 * Allows the sending anchor to update customer info fields on a transaction
 * that is in the `pending_customer_info_update` status.
 */
router.patch(
  "/transactions/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const transaction = await getSep31Transaction(id);

      if (!transaction) {
        return sep31Error(res, 404, "Transaction not found.", id);
      }

      if (transaction.status !== "pending_customer_info_update") {
        return sep31Error(
          res,
          400,
          `Transaction cannot be updated in status "${transaction.status}". ` +
            `Only transactions in "pending_customer_info_update" can be patched.`
        );
      }

      // Merge updated fields (sender_info / receiver_info only)
      const { sender_info, receiver_info } = req.body as Partial<Sep31TransactionRequest>;

      if (receiver_info) {
        const infoErrors = validateReceiverInfo(receiver_info);
        if (infoErrors.length > 0) {
          return sep31Error(
            res,
            400,
            infoErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          );
        }
        transaction.receiver_info = {
          ...(transaction.receiver_info ?? {}),
          ...receiver_info,
        };
      }

      if (sender_info) {
        transaction.sender_info = {
          ...(transaction.sender_info ?? {}),
          ...sender_info,
        };
      }

      transaction.updated_at = new Date().toISOString();

      return res.json({ transaction });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
