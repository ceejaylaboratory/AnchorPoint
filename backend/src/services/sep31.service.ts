import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import {
  getSep31AssetConfig,
  isSep31AssetSupported,
} from "../config/sep31Fields";
import logger from "../utils/logger";
import { notificationService } from "./notification.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Sep31Status =
  | "pending_sender"
  | "pending_stellar"
  | "pending_info_update"
  | "pending_receiver"
  | "pending_external"
  | "completed"
  | "error"
  | "refunded";

export const VALID_SEP31_STATUSES: readonly Sep31Status[] = [
  "pending_sender",
  "pending_stellar",
  "pending_info_update",
  "pending_receiver",
  "pending_external",
  "completed",
  "error",
  "refunded",
] as const;

export interface CreateTransactionInput {
  assetCode: string;
  amount: string;
  senderInfo: Record<string, string>;
  receiverInfo: Record<string, string>;
  callbackUrl?: string;
  userPublicKey?: string;
}

export interface Sep31Transaction {
  id: string;
  status: Sep31Status;
  assetCode: string;
  amount: string;
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  stellarTransactionId?: string;
  externalTransactionId?: string;
  senderInfo: Record<string, string>;
  receiverInfo: Record<string, string>;
  callbackUrl?: string;
  requiredInfoMessage?: string;
  refunded: boolean;
  startedAt: string;
  completedAt?: string;
  // Additional status tracking fields
  lastStatusUpdate?: string;
  statusHistory?: Array<{
    status: Sep31Status;
    timestamp: string;
    message?: string;
  }>;
}

// ─── Callback Notifier Interface ──────────────────────────────────────────────

export interface CallbackNotifier {
  notify(transaction: Sep31Transaction): Promise<void>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SEP31Service {
  private readonly notifier: CallbackNotifier | null;

  constructor(notifier?: CallbackNotifier) {
    this.notifier = notifier ?? null;
  }

  // ── createTransaction ──────────────────────────────────────────────────────

  async createTransaction(
    input: CreateTransactionInput,
  ): Promise<{ id: string; stellarAccountId: string }> {
    const { assetCode, amount, senderInfo, receiverInfo, callbackUrl, userPublicKey } = input;

    // 1. Validate asset
    if (!isSep31AssetSupported(assetCode)) {
      throw new Error("unsupported asset");
    }

    const assetConfig = getSep31AssetConfig(assetCode)!;

    // 2. Validate amount bounds
    const numericAmount = parseFloat(amount);
    if (
      isNaN(numericAmount) ||
      numericAmount < assetConfig.minAmount ||
      numericAmount > assetConfig.maxAmount
    ) {
      throw new Error(
        `amount out of range: ${assetConfig.minAmount} to ${assetConfig.maxAmount}`,
      );
    }

    // 3. Validate required senderInfo fields
    const missingSender = this.collectMissingFields(
      senderInfo,
      assetConfig.senderInfo,
    );
    if (missingSender.length > 0) {
      throw new Error(
        `Missing sender_info fields: ${missingSender.join(", ")}`,
      );
    }

    // 4. Validate required receiverInfo fields
    const missingReceiver = this.collectMissingFields(
      receiverInfo,
      assetConfig.receiverInfo,
    );
    if (missingReceiver.length > 0) {
      throw new Error(
        `Missing receiver_info fields: ${missingReceiver.join(", ")}`,
      );
    }

    // 5. Persist
    const id = randomUUID();

    // We need a userId for the relation
    const targetPublicKey = userPublicKey || "SEP31_SYSTEM";
    const systemUser = await prisma.user.upsert({
      where: { publicKey: targetPublicKey },
      update: {},
      create: {
        publicKey: targetPublicKey,
        email: targetPublicKey === "SEP31_SYSTEM" ? "sep31@system.internal" : `${targetPublicKey.toLowerCase()}@system.internal`,
      },
    });

    await prisma.transaction.create({
      data: {
        id,
        userId: systemUser.id,
        assetCode: assetCode.toUpperCase(),
        amount,
        type: "SEP31",
        status: "pending_sender",
        sep31Status: "pending_sender",
        senderInfo: senderInfo as object,
        receiverInfo: receiverInfo as object,
        callbackUrl: callbackUrl ?? null,
      },
    });

    const stellarAccountId =
      process.env.STELLAR_ACCOUNT_ID ||
      "GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K";

    return { id, stellarAccountId };
  }

  // ── getTransaction ─────────────────────────────────────────────────────────

  async getTransaction(id: string): Promise<Sep31Transaction | null> {
    const record = await prisma.transaction.findFirst({
      where: { id, type: "SEP31" },
    });

    if (!record) return null;

    return this.mapToSep31Transaction(record);
  }

  // ── updateStatus ───────────────────────────────────────────────────────────

  async updateStatus(
    id: string,
    status: Sep31Status,
    message?: string,
    extraFields?: {
      stellarTxId?: string;
      externalId?: string;
      feeAmount?: string;
    },
  ): Promise<Sep31Transaction> {
    // Validate status
    if (!(VALID_SEP31_STATUSES as readonly string[]).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    // When status=error, require a non-empty message
    if (status === "error") {
      if (!message || message.trim() === "") {
        throw new Error(
          'A non-empty message is required when setting status to "error"',
        );
      }
    }

    const updateData: Record<string, unknown> = {
      sep31Status: status,
      status,
    };

    if (status === "completed") {
      updateData.completedAt = new Date();
    }

    if (status === "error" && message) {
      updateData.requiredInfoMessage = message;
    }

    if (extraFields) {
      if (extraFields.stellarTxId) updateData.stellarTxId = extraFields.stellarTxId;
      if (extraFields.externalId) updateData.externalId = extraFields.externalId;
      if (extraFields.feeAmount) updateData.feeAmount = extraFields.feeAmount;
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: updateData,
    });

    const tx = this.mapToSep31Transaction(updated);

    // Notify user of status change
    const notificationMessage = `Your transaction ${id} status updated to: ${status.replace("_", " ")}`;
    notificationService.notify(updated.userId, notificationMessage, id).catch((err) => {
      logger.error("Failed to trigger notification", { 
        transactionId: id, 
        userId: updated.userId,
        error: err instanceof Error ? err.message : String(err)
      });
    });
    
    // Fire callback if configured
    if (tx.callbackUrl && this.notifier) {
      this.notifier.notify(tx).catch((err: unknown) => {
        logger.error("Callback notifier threw unexpectedly", {
          transactionId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return tx;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private collectMissingFields(
    provided: Record<string, string>,
    required: Record<string, { description: string; optional?: boolean }>,
  ): string[] {
    return Object.entries(required)
      .filter(([key, def]) => {
        if (def.optional) return false;
        const value = provided[key];
        return value === undefined || value === null || value.trim() === "";
      })
      .map(([key]) => key);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapToSep31Transaction(record: any): Sep31Transaction {
    return {
      id: record.id,
      status: (record.sep31Status ?? record.status) as Sep31Status,
      assetCode: record.assetCode,
      amount: record.amount,
      amountIn: record.amount,
      amountOut: record.amount && record.feeAmount ? (parseFloat(record.amount) - parseFloat(record.feeAmount)).toFixed(2) : undefined,
      amountFee: record.feeAmount ?? undefined,
      stellarTransactionId: record.stellarTxId ?? undefined,
      externalTransactionId: record.externalId ?? undefined,
      senderInfo: (record.senderInfo as Record<string, string>) ?? {},
      receiverInfo: (record.receiverInfo as Record<string, string>) ?? {},
      callbackUrl: record.callbackUrl ?? undefined,
      requiredInfoMessage: record.requiredInfoMessage ?? undefined,
      refunded: record.refunded ?? false,
      startedAt:
        record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : String(record.createdAt),
      completedAt:
        record.completedAt instanceof Date
          ? record.completedAt.toISOString()
          : record.completedAt
            ? String(record.completedAt)
            : undefined,
      // Additional status tracking fields
      lastStatusUpdate:
        record.updatedAt instanceof Date
          ? record.updatedAt.toISOString()
          : record.updatedAt
            ? String(record.updatedAt)
            : undefined,
      statusHistory: [],
    };
  }
}
