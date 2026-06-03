import { Sep31TransactionRequest } from "./types";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Supported assets. In production this would be driven by config / DB. */
const SUPPORTED_ASSETS = new Set(["USDC", "EURC", "XLM"]);

/** Minimum and maximum amounts per asset (in the asset's native unit). */
const ASSET_LIMITS: Record<string, { min: number; max: number }> = {
  USDC: { min: 1, max: 1_000_000 },
  EURC: { min: 1, max: 1_000_000 },
  XLM:  { min: 10, max: 10_000_000 },
};

const VALID_MEMO_TYPES = new Set(["text", "id", "hash"]);

/**
 * Validates a SEP-31 POST /transactions request body.
 * Returns a list of field-level errors — an empty array means the request
 * is valid and can proceed.
 */
export function validateTransactionRequest(
  body: Partial<Sep31TransactionRequest>
): ValidationResult {
  const errors: ValidationError[] = [];

  // ── amount ────────────────────────────────────────────────────────────────
  if (!body.amount) {
    errors.push({ field: "amount", message: "amount is required." });
  } else {
    const parsed = parseFloat(body.amount);
    if (isNaN(parsed) || parsed <= 0) {
      errors.push({ field: "amount", message: "amount must be a positive number." });
    }
  }

  // ── asset_code ────────────────────────────────────────────────────────────
  if (!body.asset_code) {
    errors.push({ field: "asset_code", message: "asset_code is required." });
  } else if (!SUPPORTED_ASSETS.has(body.asset_code.toUpperCase())) {
    errors.push({
      field: "asset_code",
      message: `asset_code "${body.asset_code}" is not supported. Supported assets: ${[...SUPPORTED_ASSETS].join(", ")}.`,
    });
  } else if (body.amount) {
    // Range check
    const parsed = parseFloat(body.amount);
    const limits = ASSET_LIMITS[body.asset_code.toUpperCase()];
    if (limits && !isNaN(parsed)) {
      if (parsed < limits.min) {
        errors.push({
          field: "amount",
          message: `Minimum amount for ${body.asset_code} is ${limits.min}.`,
        });
      }
      if (parsed > limits.max) {
        errors.push({
          field: "amount",
          message: `Maximum amount for ${body.asset_code} is ${limits.max}.`,
        });
      }
    }
  }

  // ── sender / receiver identity ─────────────────────────────────────────
  const hasSenderIdentity = body.sender_id || body.sender_info;
  const hasReceiverIdentity = body.receiver_id || body.receiver_info;

  if (!hasSenderIdentity) {
    errors.push({
      field: "sender_id",
      message: "Either sender_id or sender_info is required.",
    });
  }

  if (!hasReceiverIdentity) {
    errors.push({
      field: "receiver_id",
      message: "Either receiver_id or receiver_info is required.",
    });
  }

  // ── memo_type ──────────────────────────────────────────────────────────
  if (body.memo_type && !VALID_MEMO_TYPES.has(body.memo_type)) {
    errors.push({
      field: "memo_type",
      message: `memo_type must be one of: ${[...VALID_MEMO_TYPES].join(", ")}.`,
    });
  }

  // ── memo consistency ───────────────────────────────────────────────────
  if (body.memo && !body.memo_type) {
    errors.push({
      field: "memo_type",
      message: "memo_type is required when memo is provided.",
    });
  }
  if (body.memo_type && !body.memo) {
    errors.push({
      field: "memo",
      message: "memo is required when memo_type is provided.",
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates minimal required fields in receiver_info when receiver_id is
 * not provided. Anchors typically require name + bank routing details.
 */
export function validateReceiverInfo(
  info: Record<string, string> | undefined
): ValidationError[] {
  if (!info) return [];
  const errors: ValidationError[] = [];
  const required = ["first_name", "last_name"];
  for (const field of required) {
    if (!info[field] || info[field].trim() === "") {
      errors.push({
        field: `receiver_info.${field}`,
        message: `receiver_info.${field} is required.`,
      });
    }
  }
  return errors;
}