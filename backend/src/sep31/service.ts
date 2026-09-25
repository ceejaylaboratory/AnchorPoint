import { v4 as uuidv4 } from "uuid";
import {
  Sep31TransactionRequest,
  Sep31TransactionResponse,
  Sep31TransactionRecord,
  Sep31TransactionStatus,
  FeeBreakdownItem,
  Sep31Config,
} from "./types";
import { formatDecimal, toDecimal } from "../utils/decimal";

// ─── In-memory store (replace with DB in production) ──────────────────────
const transactionStore = new Map<string, Sep31TransactionRecord>();

// ─── In-memory quote store (used for short-lived exchange rate locks) ─────
export interface QuoteRecord {
  id: string;
  sellAsset: string;
  buyAsset: string;
  price: string;
  expiresAt: Date;
  /** Set once a transaction has locked this quote's rate; quotes are single-use. */
  usedBy?: string;
}

const quoteStore = new Map<string, QuoteRecord>();

// ─── Anchor configuration (would come from env / config in production) ─────
const ANCHOR_STELLAR_ACCOUNT =
  process.env.ANCHOR_DISTRIBUTION_ACCOUNT ??
  "GDIODQRBHD32QZWTGOHO2UNWSNOQN36AFKYDAJN4TBRTSXQMTZBHZ4R";

/** Default fee configuration used when no SystemConfig is provided. */
const DEFAULT_FEE_PERCENT = 0.005; // 0.5 %
const DEFAULT_FEE_FIXED = 0; // no flat fee

// ─── Helpers ──────────────────────────────────────────────────────────────

function generateMemo(): { memo: string; memo_type: "text" } {
  const memo = uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase();
  return { memo, memo_type: "text" };
}

/** Resolves fee parameters from config or falls back to hardcoded defaults. */
function resolveFeeParams(
  assetCode: string,
  sep31Config?: Sep31Config,
): { feePercent: number; feeFixed: number } {
  if (sep31Config?.assets) {
    const assetCfg = sep31Config.assets[assetCode.toUpperCase()];
    if (assetCfg) {
      return {
        feePercent: assetCfg.fee_percent / 100, // stored as percentage, use as decimal
        feeFixed: assetCfg.fee_fixed,
      };
    }
  }
  return { feePercent: DEFAULT_FEE_PERCENT, feeFixed: DEFAULT_FEE_FIXED };
}

function calculateAmountOut(
  amountIn: string,
  feePercent: number,
  feeFixed: number,
): string {
  const raw = parseFloat(amountIn);
  const fee = raw * feePercent + feeFixed;
  return (raw - fee).toFixed(7);
}

function calculateFee(
  amountIn: string,
  feePercent: number,
  feeFixed: number,
): string {
  const raw = parseFloat(amountIn);
  return (raw * feePercent + feeFixed).toFixed(7);
}

/**
 * Builds a transparent fee breakdown with individual line items.
 */
function buildFeeBreakdown(
  amountIn: string,
  feePercent: number,
  feeFixed: number,
): FeeBreakdownItem[] {
  const items: FeeBreakdownItem[] = [];
  const raw = parseFloat(amountIn);
  const percentageFee = raw * feePercent;

  if (feePercent > 0) {
    items.push({
      name: "percentage_fee",
      amount: percentageFee.toFixed(7),
      description: `Processing fee (${(feePercent * 100).toFixed(2)}% of amount_in)`,
    });
  }

  if (feeFixed > 0) {
    items.push({
      name: "fixed_fee",
      amount: feeFixed.toFixed(7),
      description: "Flat processing fee per transaction",
    });
  }

  if (items.length === 0) {
    items.push({
      name: "no_fee",
      amount: "0.0000000",
      description: "No fees applied to this transaction",
    });
  }

  return items;
}

// ─── Quote helpers ─────────────────────────────────────────────────────────

/**
 * Validates that the given quote_id refers to an existing, non-expired quote.
 * Throws a descriptive error when validation fails so the caller can surface
 * a 400-level response to the client.
 */
function validateQuote(quoteId: string): QuoteRecord {
  const quote = quoteStore.get(quoteId);

  if (!quote) {
    throw new Error(`quote_not_found: quote ${quoteId} does not exist`);
  }

  if (new Date() > quote.expiresAt) {
    throw new Error(
      `quote_expired: quote ${quoteId} expired at ${quote.expiresAt.toISOString()}`,
    );
  }

  if (quote.usedBy) {
    throw new Error(
      `quote_already_used: quote ${quoteId} is bound to transaction ${quote.usedBy}`,
    );
  }

  return quote;
}

/**
 * Creates a short-lived exchange-rate quote.
 * The default TTL is 60 seconds, matching the FX volatility window.
 */
export function createQuote(
  sellAsset: string,
  buyAsset: string,
  price: string,
  ttlSeconds = 60,
): QuoteRecord {
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
  const record: QuoteRecord = { id, sellAsset, buyAsset, price, expiresAt };
  quoteStore.set(id, record);
  return record;
}

/** Retrieves a quote without expiry validation (for read-only inspection). */
export function getQuote(id: string): QuoteRecord | null {
  return quoteStore.get(id) ?? null;
}

// ─── Service ───────────────────────────────────────────────────────────────

/**
 * Creates a new SEP-31 cross-border payment transaction.
 * Returns the data the sending anchor needs to initiate the Stellar payment,
 * including a transparent fee breakdown.
 *
 * When a `quote_id` is supplied the quote must exist and must not have expired;
 * an expired quote causes the function to throw so the caller can return a
 * 400 response to the sending anchor.
 *
 * @param sep31Config - Optional SEP-31 configuration from SystemConfig.
 *                      When provided, fee calculation is driven by the
 *                      dynamic configuration.
 */
export async function createSep31Transaction(
  req: Sep31TransactionRequest,
  sep31Config?: Sep31Config,
): Promise<Sep31TransactionResponse> {
  // ── Quote expiry validation ──────────────────────────────────────────────
  // Throws if quote is missing, expired or already used — caller maps to 400
  const quote = req.quote_id ? validateQuote(req.quote_id) : null;

  const { feePercent, feeFixed } = resolveFeeParams(req.asset_code, sep31Config);

  const id = uuidv4();
  const now = new Date().toISOString();
  const { memo, memo_type } = generateMemo();

  const amountOut = calculateAmountOut(req.amount, feePercent, feeFixed);
  const amountFee = calculateFee(req.amount, feePercent, feeFixed);
  const feeBreakdown = buildFeeBreakdown(req.amount, feePercent, feeFixed);

  const record: Sep31TransactionRecord = {
    id,
    status: "pending_sender",
    amount_in: req.amount,
    amount_out: amountOut,
    amount_fee: amountFee,
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
    quote_id: quote?.id,
    quote_price: quote?.price,
  };

  // Lock the exchange rate: the quote is consumed by this transaction.
  if (quote) {
    quote.usedBy = id;
  }
  transactionStore.set(id, record);

  return {
    id: record.id,
    stellar_account_id: record.stellar_account_id,
    stellar_memo: record.stellar_memo,
    stellar_memo_type: record.stellar_memo_type,
    amount_out: record.amount_out!,
    amount_fee: record.amount_fee!,
    fee_breakdown: feeBreakdown,
  };
}

/**
 * Retrieves a SEP-31 transaction by ID.
 * Returns null when the transaction does not exist.
 */
export async function getSep31Transaction(
  id: string,
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
  } = {},
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
 * When a sep31Config is provided, the asset list and fee values are sourced
 * from the dynamic SystemConfig.
 */
export function getSep31Info(sep31Config?: Sep31Config) {
  const defaultAssets: Sep31Config["assets"] = {
    USDC: {
      enabled: true,
      min_amount: 1,
      max_amount: 1_000_000,
      fee_fixed: 0,
      fee_percent: 0.5,
      quotes_supported: true,
      quotes_required: false,
      sender_sep12_type: "sep31-sender",
      receiver_sep12_type: "sep31-receiver",
    },
    EURC: {
      enabled: true,
      min_amount: 1,
      max_amount: 1_000_000,
      fee_fixed: 0,
      fee_percent: 0.5,
      quotes_supported: true,
      quotes_required: false,
      sender_sep12_type: "sep31-sender",
      receiver_sep12_type: "sep31-receiver",
    },
  };

  const assets = sep31Config?.assets ?? defaultAssets;
  const receive: Record<string, unknown> = {};

  for (const [code, cfg] of Object.entries(assets)) {
    receive[code] = {
      enabled: cfg.enabled,
      quotes_supported: cfg.quotes_supported,
      quotes_required: cfg.quotes_required,
      fee_fixed: cfg.fee_fixed,
      fee_percent: cfg.fee_percent,
      min_amount: cfg.min_amount,
      max_amount: cfg.max_amount,
      sender_sep12_type: cfg.sender_sep12_type,
      receiver_sep12_type: cfg.receiver_sep12_type,
      fields: {
        transaction:
          code === "EURC"
            ? {
                iban: {
                  description: "IBAN of the receiver's bank account",
                },
              }
            : {
                routing_number: {
                  description: "Bank routing number of the receiver",
                },
                account_number: {
                  description: "Bank account number of the receiver",
                },
              },
      },
    };
  }

  return { receive };
}
