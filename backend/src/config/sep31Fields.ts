/**
 * SEP-31 KYC field configuration per asset.
 *
 * Consumed by:
 *  - GET /sep31/info  → advertises required fields and asset limits
 *  - SEP31Service     → validates sender_info / receiver_info on incoming transactions
 */

import { ASSET_MAP } from "./assets";
import type { FeeType } from "./assets";

export interface FieldDefinition {
  description: string;
  optional?: boolean;
}

export interface Sep31AssetFields {
  /** Required (and optional) fields for the sending party. */
  senderInfo: Record<string, FieldDefinition>;
  /** Required (and optional) fields for the receiving party. */
  receiverInfo: Record<string, FieldDefinition>;
}

export interface Sep31AssetConfig extends Sep31AssetFields {
  /** Whether this asset is enabled for SEP-31 cross-border payments. */
  enabled: boolean;
  /** Minimum transaction amount (as a numeric string, same unit as the asset). */
  minAmount: number;
  /** Maximum transaction amount (as a numeric string, same unit as the asset). */
  maxAmount: number;
  /** Strategy used to compute fees for this asset. */
  feeType: FeeType;
  /** Fixed fee charged per transaction. */
  feeFixed: number;
  /** Percentage fee charged per transaction (e.g. 0.005 = 0.5%). */
  feePercent: number;
}

/**
 * SEP-31 asset configuration map.
 *
 * Keys are asset codes (uppercase). Each entry declares:
 *  - enabled / disabled status
 *  - amount bounds and fee structure (re-uses values from `assets.ts` where possible)
 *  - required KYC fields for sender and receiver
 *
 * Add new assets here to expose them via the /sep31/info endpoint and enable
 * validation in SEP31Service.
 */
export const SEP31_ASSET_FIELDS: Record<string, Sep31AssetConfig> = {
  USDC: {
    enabled: true,
    // Inherit bounds and fees from the shared asset config so there is a
    // single source of truth; fall back to sensible defaults if not found.
    minAmount: Number(ASSET_MAP["USDC"]?.minAmount ?? "1"),
    maxAmount: Number(ASSET_MAP["USDC"]?.maxAmount ?? "1000000"),
    feeType: ASSET_MAP["USDC"]?.feeType ?? "tiered",
    feeFixed: ASSET_MAP["USDC"]?.feeFixed ?? 0.5,
    feePercent: ASSET_MAP["USDC"]?.feePercent ?? 0.005,

    senderInfo: {
      first_name: { description: "Sender's first name" },
      last_name: { description: "Sender's last name" },
      email: { description: "Sender's email address" },
    },

    receiverInfo: {
      first_name: { description: "Receiver's first name" },
      last_name: { description: "Receiver's last name" },
      bank_account_no: { description: "Receiver's bank account number" },
    },
  },

  USD: {
    enabled: true,
    minAmount: Number(ASSET_MAP["USD"]?.minAmount ?? "1"),
    maxAmount: Number(ASSET_MAP["USD"]?.maxAmount ?? "1000000"),
    feeType: ASSET_MAP["USD"]?.feeType ?? "tiered",
    feeFixed: ASSET_MAP["USD"]?.feeFixed ?? 0.5,
    feePercent: ASSET_MAP["USD"]?.feePercent ?? 0.005,

    senderInfo: {
      first_name: { description: "Sender's first name" },
      last_name: { description: "Sender's last name" },
      email: { description: "Sender's email address" },
    },

    receiverInfo: {
      first_name: { description: "Receiver's first name" },
      last_name: { description: "Receiver's last name" },
      bank_account_no: { description: "Receiver's bank account number" },
    },
  },
};

/** Ordered list of asset codes supported for SEP-31. */
export const SEP31_SUPPORTED_ASSET_CODES = Object.keys(SEP31_ASSET_FIELDS);

/**
 * Returns the SEP-31 config for a given asset code, or `undefined` if the
 * asset is not configured for SEP-31.
 */
export const getSep31AssetConfig = (
  code: string,
): Sep31AssetConfig | undefined =>
  SEP31_ASSET_FIELDS[code.trim().toUpperCase()];

/**
 * Returns `true` when the asset exists in `SEP31_ASSET_FIELDS` and is enabled.
 */
export const isSep31AssetSupported = (code: string): boolean =>
  getSep31AssetConfig(code)?.enabled === true;
