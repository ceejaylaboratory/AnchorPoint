import { v4 as uuidv4 } from "uuid";
import {
  Sep31TransactionRequest,
  Sep31TransactionResponse,
  Sep31TransactionRecord,
  Sep31TransactionStatus,
} from "./types";

// ─── In-memory store (replace with DB in production) ──────────────────────
// In the AnchorPoint backend this would be backed by the existing
// transaction tracking system (SQLite via the docker-compose setup).
const transactionStore = new Map<string, Sep31TransactionRecord>();

// ─── Anchor configuration (would come from env / config in production) ─────
const ANCHOR_STELLAR_ACCOUNT =
  process.env.ANCHOR_DISTRIBUTION_ACCOUNT ??
  "GDIODQRBHD32QZWTGOHO2UNWSNOQN36AFKYDAJN4TBRTSXQMTZBHZ4R";

const FEE_PERCENT = 0.005; // 0.5 %
const FEE_FIXED  = 0;      // no flat fee

// ─── Helpers ──────────────────────────────────────────────────────────────

function generateMemo(): { memo: string; memo_type: "text" } {
  // Short alphanumeric memo that the sending anchor attaches to the payment
  const memo = uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase();
  return { memo, memo_type: "text" };
}

function calculateAmountOut(amountIn: string): string {
  const raw = parseFloat(amountIn);
  const fee = raw * FEE_PERCENT + FEE_FIXED;
  return (raw - fee).toFixed(7);
}

function calculateFee(amountIn: string): string {
  const raw = parseFloat(amountIn);
  return (raw * FEE_PERCENT + FEE_FIXED).toFixed(7);
}

// ─── Service ───────────────────────────────────────────────────────────────

/**
 * Creates a new SEP-31 cross-border payment transaction.
 * Returns the data the sending anchor needs to initiate the Stellar payment.
 */
export async function createSep31Transaction(
  req: Sep31TransactionRequest
): Promise<Sep31TransactionResponse> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const { memo, memo_type } = generateMemo();

  const record: Sep31TransactionRecord = {
    id,
    status: "pending_sender",
    amount_in: req.amount,
    amount_out: calculateAmountOut(req.amount),
    amount_fee: calculateFee(req.amount),
    asset_code: req.asset_code.toUpperCase(),
    asset_issuer: req.asset_issuer,
    stellar_account_id: ANCHOR_STELLAR_ACCOUNT,
    stellar_memo: req.memo ?? memo,
    stellar_memo_type: req.memo_type ?? memo_type,
    sender_id: req.sender_id,
    receiver_id: req.receiver_id,
    sender_info: req.sender_info,
    receiver_info: req.receiver_info,
    started_at: now,
    updated_at: now,
  };

  transactionStore.set(id, record);

  return {
    id: record.id,
    stellar_account_id: record.stellar_account_id,
    stellar_memo: record.stellar_memo,
    stellar_memo_type: record.stellar_memo_type,
  };
}

/**
 * Retrieves a SEP-31 transaction by ID.
 * Returns null when the transaction does not exist.
 */
export async function getSep31Transaction(
  id: string
): Promise<Sep31TransactionRecord | null> {
  return transactionStore.get(id) ?? null;
}

/**
 * Updates the status of a SEP-31 transaction.
 * Used internally when Stellar payment events arrive.
 */
export async function updateSep31TransactionStatus(
  id: string,
  status: Sep31TransactionStatus,
  options: {
    status_message?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
  } = {}
): Promise<Sep31TransactionRecord | null> {
  const record = transactionStore.get(id);
  if (!record) return null;

  record.status = status;
  record.updated_at = new Date().toISOString();

  if (options.status_message !== undefined) {
    record.status_message = options.status_message;
  }
  if (options.stellar_transaction_id) {
    record.stellar_transaction_id = options.stellar_transaction_id;
  }
  if (options.external_transaction_id) {
    record.external_transaction_id = options.external_transaction_id;
  }
  if (status === "completed" || status === "refunded" || status === "error") {
    record.completed_at = new Date().toISOString();
  }

  transactionStore.set(id, record);
  return record;
}

/**
 * Returns SEP-31 /info payload describing supported assets and required fields.
 */
export function getSep31Info() {
  return {
    receive: {
      USDC: {
        enabled: true,
        quotes_supported: false,
        quotes_required: false,
        fee_fixed: FEE_FIXED,
        fee_percent: FEE_PERCENT * 100,
        min_amount: 1,
        max_amount: 1_000_000,
        sender_sep12_type: "sep31-sender",
        receiver_sep12_type: "sep31-receiver",
        fields: {
          transaction: {
            routing_number: {
              description: "Bank routing number of the receiver",
            },
            account_number: {
              description: "Bank account number of the receiver",
            },
          },
        },
      },
      EURC: {
        enabled: true,
        quotes_supported: false,
        quotes_required: false,
        fee_fixed: FEE_FIXED,
        fee_percent: FEE_PERCENT * 100,
        min_amount: 1,
        max_amount: 1_000_000,
        sender_sep12_type: "sep31-sender",
        receiver_sep12_type: "sep31-receiver",
        fields: {
          transaction: {
            iban: {
              description: "IBAN of the receiver's bank account",
            },
          },
        },
      },
    },
  };
}