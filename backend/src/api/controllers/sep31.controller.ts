import { Request, Response } from "express";
import { SEP31Service } from "../../services/sep31.service";
import { createCallbackNotifier } from "../../services/sep31CallbackNotifier";
import { SEP31_ASSET_FIELDS } from "../../config/sep31Fields";
import logger from "../../utils/logger";
import type { AuthRequest } from "../middleware/auth.middleware";

// Singleton service instance (callback notifier wired in)
const sep31Service = new SEP31Service(createCallbackNotifier());

// ─── GET /sep31/info ──────────────────────────────────────────────────────────

/**
 * Returns the SEP-31 info response listing supported assets and their
 * required sender/receiver KYC fields.
 */
export const getInfo = (_req: Request, res: Response): Response => {
  try {
    const receive: Record<string, unknown> = {};

    for (const [code, config] of Object.entries(SEP31_ASSET_FIELDS)) {
      if (!config.enabled) {
        receive[code] = { enabled: false };
        continue;
      }

      receive[code] = {
        enabled: true,
        min_amount: config.minAmount,
        max_amount: config.maxAmount,
        fee_fixed: config.feeFixed,
        fee_percent: config.feePercent,
        sender_info_needed: { fields: config.senderInfo },
        receiver_info_needed: { fields: config.receiverInfo },
      };
    }

    return res.status(200).json({ receive });
  } catch (err) {
    logger.error("SEP-31 getInfo unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── POST /sep31/transactions ─────────────────────────────────────────────────

/**
 * Initiates a new SEP-31 cross-border payment transaction.
 */
export const createTransaction = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { asset_code, amount, sender_info, receiver_info, callback } =
      req.body as {
        asset_code?: string;
        amount?: string;
        sender_info?: Record<string, string>;
        receiver_info?: Record<string, string>;
        callback?: string;
      };

    if (!asset_code) {
      return res.status(400).json({ error: "asset_code is required" });
    }
    if (!amount) {
      return res.status(400).json({ error: "amount is required" });
    }
    if (!sender_info || typeof sender_info !== "object") {
      return res.status(400).json({ error: "sender_info is required" });
    }
    if (!receiver_info || typeof receiver_info !== "object") {
      return res.status(400).json({ error: "receiver_info is required" });
    }

    const result = await sep31Service.createTransaction({
      assetCode: asset_code,
      amount,
      senderInfo: sender_info,
      receiverInfo: receiver_info,
      callbackUrl: callback,
    });

    return res.status(201).json({
      id: result.id,
      stellar_account_id: result.stellarAccountId,
    });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;

      // Map known service errors to 400
      if (
        msg === "unsupported asset" ||
        msg.startsWith("amount out of range") ||
        msg.startsWith("Missing sender_info") ||
        msg.startsWith("Missing receiver_info")
      ) {
        return res.status(400).json({ error: msg });
      }

      // Auth errors → 403
      if (
        msg.toLowerCase().includes("forbidden") ||
        msg.toLowerCase().includes("unauthorized")
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    logger.error("SEP-31 createTransaction unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── GET /sep31/transactions/:id ──────────────────────────────────────────────

/**
 * Retrieves a SEP-31 transaction by ID.
 */
export const getTransaction = async (
  req: AuthRequest,
  res: Response,
): Promise<Response> => {
  try {
    const { id } = req.params;

    const tx = await sep31Service.getTransaction(id);

    if (!tx) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    return res.status(200).json({
      transaction: {
        id: tx.id,
        status: tx.status,
        amount_in: tx.amountIn ?? tx.amount,
        amount_out: tx.amountOut ?? null,
        amount_fee: tx.amountFee ?? null,
        asset_code: tx.assetCode,
        stellar_transaction_id: tx.stellarTransactionId ?? null,
        external_transaction_id: tx.externalTransactionId ?? null,
        started_at: tx.startedAt,
        completed_at: tx.completedAt ?? null,
        refunded: tx.refunded,
        required_info_message: tx.requiredInfoMessage ?? null,
      },
    });
  } catch (err) {
    logger.error("SEP-31 getTransaction unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "internal server error" });
  }
};
