import {
  Address,
  Asset,
  FeeBumpTransaction,
  Memo,
  StrKey,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { jsonReplacer } from '../xdrEvents';

/**
 * Decoders behind the transaction receipt's technical details: envelope,
 * result and meta XDR become a human-readable summary plus a plain JSON tree
 * for the raw viewer. Nothing here throws; bad input yields `{ ok: false }`.
 */

const STROOPS_PER_XLM = 10_000_000n;

/** Formats a stroop amount as XLM without floating-point rounding. */
export function stroopsToXlm(stroops: string | number | bigint): string {
  let value: bigint;
  try {
    value = BigInt(stroops);
  } catch {
    return String(stroops);
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / STROOPS_PER_XLM;
  const fraction = (abs % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''} XLM`;
}

// ── Generic XDR → plain JSON ────────────────────────────────────────────────

type XdrLike = {
  _switch?: unknown;
  _arm?: unknown;
  _value?: unknown;
  _attributes?: Record<string, unknown>;
  name?: unknown;
};

const MAX_TREE_DEPTH = 40;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Walks a js-xdr value (struct / union / enum / hyper / opaque) into plain
 * JSON. Account and contract ids are rendered as strkeys, which is how users
 * recognise them; other opaque data becomes hex.
 */
export function xdrToPlain(value: unknown, depth = 0): unknown {
  if (depth > MAX_TREE_DEPTH) return '…';
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    // Short ASCII payloads (asset codes, memo text, symbols) read better as text.
    const text = new TextDecoder('utf-8', { fatal: false }).decode(value).replace(/\0+$/, '');
    if (value.length > 0 && value.length <= 64 && /^[\x20-\x7e]+$/.test(text)) return text;
    return toHex(value);
  }
  if (Array.isArray(value)) return value.map((item) => xdrToPlain(item, depth + 1));

  if (value instanceof xdr.PublicKey) {
    return StrKey.encodeEd25519PublicKey(value.ed25519());
  }
  if (value instanceof xdr.MuxedAccount) {
    try {
      return value.switch().name === 'keyTypeEd25519'
        ? StrKey.encodeEd25519PublicKey(value.ed25519())
        : StrKey.encodeMed25519PublicKey(value.med25519().toXDR());
    } catch {
      // fall through to the generic walker
    }
  }
  if (value instanceof xdr.ScAddress) {
    try {
      return Address.fromScAddress(value).toString();
    } catch {
      // fall through
    }
  }

  const node = value as XdrLike;

  // Hyper / UnsignedHyper (64-bit ints) carry their value as a bigint.
  if (typeof node._value === 'bigint' && node._switch === undefined) return node._value.toString();

  // Enum: a named constant.
  if (typeof node.name === 'string' && 'value' in (value as object) && node._attributes === undefined) {
    return node.name;
  }

  // Union: { armName: value } or just the discriminant name for void arms.
  if (node._switch !== undefined) {
    const discriminant = node._switch as { name?: string } | number;
    const key = typeof discriminant === 'object' && discriminant?.name ? discriminant.name : String(discriminant);
    if (node._value === undefined || node._arm === undefined) return key;
    return { [key]: xdrToPlain(node._value, depth + 1) };
  }

  // Struct: its named attributes.
  if (node._attributes) {
    const out: Record<string, unknown> = {};
    Object.entries(node._attributes).forEach(([field, inner]) => {
      out[field] = xdrToPlain(inner, depth + 1);
    });
    return out;
  }

  const stringified = String(value);
  return stringified === '[object Object]' ? null : stringified;
}

/** Pretty JSON for the copy action of a decoded tree. */
export const treeToJson = (tree: unknown): string => JSON.stringify(tree, jsonReplacer, 2);

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// ── Envelope ────────────────────────────────────────────────────────────────

export interface DecodedOperation {
  index: number;
  type: string;
  source?: string;
  /** Flattened, display-ready fields of the operation. */
  details: Record<string, string>;
}

export interface EnvelopeSummary {
  /** Null only if hashing is unavailable in the current runtime. */
  hash: string | null;
  source: string;
  /** Max fee bid, in stroops. */
  fee: string;
  sequence: string;
  memo: string | null;
  isFeeBump: boolean;
  feeSource?: string;
  operations: DecodedOperation[];
  signatures: number;
}

export type DecodeResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const formatAsset = (asset: Asset) => (asset.isNative() ? 'XLM' : `${asset.getCode()}:${asset.getIssuer()}`);

/** Turns an SDK operation field into a short display string. */
function formatField(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Asset) return formatAsset(value);
  if (Array.isArray(value)) {
    if (value.every((item) => item instanceof Asset)) return value.map(formatAsset).join(' → ') || '—';
    return JSON.stringify(xdrToPlain(value), jsonReplacer);
  }
  if (typeof value === 'object') {
    const plain = (value as { toXDR?: unknown }).toXDR ? xdrToPlain(value) : value;
    return JSON.stringify(plain, jsonReplacer);
  }
  return String(value);
}

function formatMemo(memo: Memo): string | null {
  switch (memo.type) {
    case 'none':
      return null;
    case 'text': {
      const raw = memo.value as unknown;
      return raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
    }
    case 'id':
      return `ID ${String(memo.value)}`;
    case 'hash':
    case 'return': {
      const raw = memo.value as unknown;
      return `${memo.type.toUpperCase()} ${raw instanceof Uint8Array ? toHex(raw) : String(raw)}`;
    }
    default:
      return String(memo.value);
  }
}

function safeHash(tx: Transaction | FeeBumpTransaction): string | null {
  try {
    return toHex(tx.hash());
  } catch {
    // The hash is a convenience; a crypto hiccup must not hide the decode.
    return null;
  }
}

/**
 * Decodes a base64 TransactionEnvelope. The network passphrase is needed to
 * compute the hash, so the receipt passes the active network's passphrase.
 */
export function decodeEnvelope(
  envelopeXdr: string,
  networkPassphrase: string,
): DecodeResult<{ summary: EnvelopeSummary; tree: unknown }> {
  if (typeof envelopeXdr !== 'string' || envelopeXdr.trim() === '') {
    return { ok: false, error: 'Empty envelope XDR' };
  }

  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdr.trim(), 'base64');
    const parsed = TransactionBuilder.fromXDR(envelope, networkPassphrase);
    const isFeeBump = parsed instanceof FeeBumpTransaction;
    const inner: Transaction = isFeeBump ? (parsed as FeeBumpTransaction).innerTransaction : (parsed as Transaction);

    const operations: DecodedOperation[] = inner.operations.map((operation, index) => {
      const { type, source, ...fields } = operation as unknown as Record<string, unknown> & {
        type: string;
        source?: string;
      };
      const details: Record<string, string> = {};
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) details[key] = formatField(value);
      });
      return { index, type, source, details };
    });

    return {
      ok: true,
      summary: {
        hash: safeHash(parsed),
        source: inner.source,
        fee: isFeeBump ? (parsed as FeeBumpTransaction).fee : inner.fee,
        sequence: inner.sequence,
        memo: formatMemo(inner.memo),
        isFeeBump,
        feeSource: isFeeBump ? (parsed as FeeBumpTransaction).feeSource : undefined,
        operations,
        signatures: parsed.signatures.length,
      },
      tree: xdrToPlain(envelope),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Invalid envelope XDR') };
  }
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface DecodedOperationResult {
  index: number;
  /** Operation type, e.g. `payment`; null when the op failed before running. */
  type: string | null;
  /** Result code, e.g. `paymentSuccess` or `opNoAccount`. */
  code: string;
  success: boolean;
  /** Notable return data, e.g. the claimable balance ID. */
  details: Record<string, string>;
}

export interface ResultSummary {
  /** Fee actually charged, in stroops. */
  feeCharged: string;
  code: string;
  success: boolean;
  operations: DecodedOperationResult[];
}

const OP_DETAIL_EXTRACTORS: Record<string, (value: xdr.OperationResultTr) => Record<string, string>> = {
  createClaimableBalance: (tr) => {
    const result = tr.createClaimableBalanceResult();
    if (result.switch().name !== 'createClaimableBalanceSuccess') return {} as Record<string, string>;
    // Horizon/StellarExpert format: hex of the full ClaimableBalanceID XDR.
    return { 'Claimable balance ID': result.balanceId().toXDR('hex') };
  },
  invokeHostFunction: (tr) => {
    const result = tr.invokeHostFunctionResult();
    if (result.switch().name !== 'invokeHostFunctionSuccess') return {} as Record<string, string>;
    return { 'Return value hash': toHex(result.success()) };
  },
  manageSellOffer: (tr) => offerDetails(tr.manageSellOfferResult()),
  manageBuyOffer: (tr) => offerDetails(tr.manageBuyOfferResult()),
  createPassiveSellOffer: (tr) => offerDetails(tr.createPassiveSellOfferResult()),
};

function offerDetails(result: xdr.ManageSellOfferResult | xdr.ManageBuyOfferResult): Record<string, string> {
  try {
    const success = result.success();
    const offer = success.offer();
    const out: Record<string, string> = { 'Offer effect': offer.switch().name };
    if (offer.switch().name !== 'manageOfferDeleted') out['Offer ID'] = offer.offer().offerId().toString();
    out['Offers claimed'] = String(success.offersClaimed().length);
    return out;
  } catch {
    return {};
  }
}

function decodeOperationResult(result: xdr.OperationResult, index: number): DecodedOperationResult {
  const outer = result.switch().name;
  if (outer !== 'opInner') {
    return { index, type: null, code: outer, success: false, details: {} };
  }

  const tr = result.tr();
  const type = tr.switch().name;
  const inner = tr.value() as { switch: () => { name: string } };
  const code = inner.switch().name;
  let details: Record<string, string> = {};
  try {
    details = OP_DETAIL_EXTRACTORS[type]?.(tr) ?? {};
  } catch {
    details = {};
  }
  return { index, type, code, success: /Success$/.test(code), details };
}

/** Decodes a base64 TransactionResult (fee-bump wrappers included). */
export function decodeResult(resultXdr: string): DecodeResult<{ summary: ResultSummary; tree: unknown }> {
  if (typeof resultXdr !== 'string' || resultXdr.trim() === '') {
    return { ok: false, error: 'Empty result XDR' };
  }

  try {
    const result = xdr.TransactionResult.fromXDR(resultXdr.trim(), 'base64');
    let body = result.result();
    let code: string = body.switch().name;

    if (code === 'txFeeBumpInnerSuccess' || code === 'txFeeBumpInnerFailed') {
      body = body.innerResultPair().result().result() as unknown as typeof body;
      code = `${code} (${body.switch().name})`;
    }

    const innerCode = body.switch().name;
    const opResults =
      innerCode === 'txSuccess' || innerCode === 'txFailed' ? (body.results() as xdr.OperationResult[]) : [];

    return {
      ok: true,
      summary: {
        feeCharged: result.feeCharged().toString(),
        code,
        success: innerCode === 'txSuccess',
        operations: opResults.map(decodeOperationResult),
      },
      tree: xdrToPlain(result),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Invalid result XDR') };
  }
}

// ── Meta (Soroban return value) ─────────────────────────────────────────────

/** Decodes a base64 TransactionMeta into a plain tree for the raw viewer. */
export function decodeMetaTree(resultMetaXdr: string): DecodeResult<{ tree: unknown }> {
  try {
    return { ok: true, tree: xdrToPlain(xdr.TransactionMeta.fromXDR(resultMetaXdr.trim(), 'base64')) };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Invalid result meta XDR') };
  }
}

export interface DecodedReturnValue {
  type: string;
  value: unknown;
}

/**
 * Extracts a Soroban contract's return value from TransactionMeta (v3 or v4).
 * Returns null for classic transactions or undecodable meta.
 */
export function decodeContractReturnValue(resultMetaXdr: string | undefined | null): DecodedReturnValue | null {
  if (!resultMetaXdr) return null;
  try {
    const meta = xdr.TransactionMeta.fromXDR(resultMetaXdr.trim(), 'base64');
    const version = meta.switch() as unknown as number;
    let returnValue: xdr.ScVal | undefined;
    if (version === 3) {
      returnValue = meta.v3().sorobanMeta()?.returnValue();
    } else if (version === 4) {
      const v4 = (meta as unknown as { v4: () => { sorobanMeta: () => { returnValue: () => xdr.ScVal | undefined } | null } }).v4();
      returnValue = v4.sorobanMeta()?.returnValue() ?? undefined;
    }
    if (!returnValue) return null;
    const type = returnValue.switch().name;
    const value =
      type === 'scvAddress' ? Address.fromScAddress(returnValue.address()).toString() : scValToNative(returnValue);
    return { type, value };
  } catch {
    return null;
  }
}
