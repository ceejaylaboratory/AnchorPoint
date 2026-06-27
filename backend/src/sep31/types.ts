// ─── SEP-31 Field Descriptor ──────────────────────────────────────────────

export interface Sep31Field {
  description: string;
  choices?: string[];
  optional?: boolean;
}

export interface Sep31FieldMap {
  [fieldName: string]: Sep31Field;
}

// ─── POST /transactions — Request ─────────────────────────────────────────

export interface Sep31TransactionRequest {
  /** Amount of the asset to send (as a string to preserve decimal precision). */
  amount: string;
  /** Asset code (e.g. "USDC"). */
  asset_code: string;
  /** Optional asset issuer public key. */
  asset_issuer?: string;
  /** Required KYC fields for the sender (collected via SEP-12). */
  sender_id?: string;
  /** Required KYC fields for the receiver (collected via SEP-12). */
  receiver_id?: string;
  /** Fields describing the sender (used when sender_id is not provided). */
  sender_info?: Record<string, string>;
  /** Fields describing the receiver (used when receiver_id is not provided). */
  receiver_info?: Record<string, string>;
  /** Optional memo for the on-chain payment. */
  memo?: string;
  /** Optional memo type: "text" | "id" | "hash". Defaults to "text". */
  memo_type?: "text" | "id" | "hash";
  /** Lang for error messages / fields. Defaults to "en". */
  lang?: string;
}

// ─── POST /transactions — Success Response ─────────────────────────────────

export interface Sep31TransactionResponse {
  /** Unique transaction ID (UUID). */
  id: string;
  /** Stellar account to send the payment to. */
  stellar_account_id: string;
  /** Memo value the sender must attach to the Stellar payment. */
  stellar_memo: string;
  /** Memo type: "text" | "id" | "hash". */
  stellar_memo_type: "text" | "id" | "hash";
}

// ─── GET /transaction/:id — Transaction Detail ─────────────────────────────

export type Sep31TransactionStatus =
  | "pending_sender"       // Waiting for the sending anchor to initiate the Stellar payment
  | "pending_stellar"      // Payment submitted; waiting for network confirmation
  | "pending_customer_info_update" // Receiver KYC needs updating
  | "pending_receiver"     // Stellar payment received; waiting for receiving anchor to disburse
  | "pending_external"     // Fiat disbursement in progress
  | "completed"            // Funds delivered to receiver
  | "refunded"             // Funds returned to sender
  | "expired"              // Transaction timed out
  | "error";               // Unrecoverable error

export interface Sep31TransactionRecord {
  id: string;
  status: Sep31TransactionStatus;
  status_message?: string;
  amount_in: string;
  amount_out?: string;
  amount_fee?: string;
  asset_code: string;
  asset_issuer?: string;
  stellar_account_id: string;
  stellar_memo: string;
  stellar_memo_type: "text" | "id" | "hash";
  sender_id?: string;
  receiver_id?: string;
  sender_info?: Record<string, string>;
  receiver_info?: Record<string, string>;
  /** ISO-8601 timestamp when the transaction was created. */
  started_at: string;
  /** ISO-8601 timestamp when the transaction reached a final state. */
  completed_at?: string;
  /** URL for the sender to get more info (e.g. when KYC is needed). */
  more_info_url?: string;
  /** On-chain transaction hash (once confirmed). */
  stellar_transaction_id?: string;
  /** External payment reference (once disbursed). */
  external_transaction_id?: string;
  /** ISO-8601 timestamp of the last status change. */
  updated_at: string;
}

// ─── GET /info — Anchor capabilities ──────────────────────────────────────

export interface Sep31AssetInfo {
  enabled: boolean;
  quotes_supported: boolean;
  quotes_required: boolean;
  fee_fixed: number;
  fee_percent: number;
  min_amount: number;
  max_amount: number;
  sender_sep12_type: string;
  receiver_sep12_type: string;
  fields: {
    transaction: Sep31FieldMap;
  };
}

export interface Sep31InfoResponse {
  receive: {
    [assetCode: string]: Sep31AssetInfo;
  };
}

// ─── SEP-31 Error codes (spec §4.3) ──────────────────────────────────────

export type Sep31ErrorCode =
  | "transaction_not_found"
  | "invalid_field"
  | "missing_field"
  | "customer_info_needed"
  | "asset_not_supported"
  | "amount_out_of_range"
  | "unauthorized"
  | "not_found";

export interface Sep31ErrorResponse {
  error: string;
  id?: string;
}