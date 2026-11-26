// @vitest-environment node
// Hashing goes through @noble, whose Uint8Array check fails across jsdom's realm.
import {
  Account,
  Asset,
  Claimant,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  decodeContractReturnValue,
  decodeEnvelope,
  decodeResult,
  stroopsToXlm,
  treeToJson,
  xdrToPlain,
} from './receiptXdr';

// Fixed public keys: signing under jsdom trips @noble's cross-realm
// Uint8Array check, and the decoder never needs a secret anyway.
const sourceKey = 'GDLYNIYJNNGXGKNKDPPBWELTNBRGLIQOIUQ6XEMFWOWOUPAILRL67TV3';
const source = { publicKey: () => sourceKey };
const destination = 'GC2I5JAWAGDP4MMKZ6VO3F6D5ZSVPUBUXQURXYRXJ7VQS7TFZADYZGJQ';

function buildEnvelope() {
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '12.5' }))
    .addOperation(
      Operation.createClaimableBalance({
        asset: new Asset('USDC', destination),
        amount: '1',
        claimants: [new Claimant(source.publicKey())],
      }),
    )
    .addMemo(Memo.text('invoice-42'))
    .setTimeout(0)
    .build();
  return { tx, xdr: tx.toEnvelope().toXDR('base64') };
}

const balanceId = xdr.ClaimableBalanceId.claimableBalanceIdTypeV0(Buffer.alloc(32, 7));

function buildResult() {
  return new xdr.TransactionResult({
    feeCharged: new xdr.Int64(200),
    result: xdr.TransactionResultResult.txSuccess([
      xdr.OperationResult.opInner(xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess())),
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.createClaimableBalance(
          xdr.CreateClaimableBalanceResult.createClaimableBalanceSuccess(balanceId),
        ),
      ),
    ]),
    ext: new xdr.TransactionResultExt(0),
  }).toXDR('base64');
}

describe('stroopsToXlm', () => {
  it('formats without float rounding', () => {
    expect(stroopsToXlm('200')).toBe('0.00002 XLM');
    expect(stroopsToXlm(125_000_000)).toBe('12.5 XLM');
    expect(stroopsToXlm('92233720368547758070')).toBe('9223372036854.775807 XLM');
    expect(stroopsToXlm('0')).toBe('0 XLM');
  });
});

describe('decodeEnvelope', () => {
  it('summarises source, fee, sequence, memo, hash and operations', () => {
    const { tx, xdr: envelope } = buildEnvelope();
    const decoded = decodeEnvelope(envelope, Networks.TESTNET);
    if (!decoded.ok) throw new Error(decoded.error);

    expect(decoded.summary.hash).toBe(tx.hash().toString('hex'));
    expect(decoded.summary.source).toBe(source.publicKey());
    expect(decoded.summary.fee).toBe('200');
    expect(decoded.summary.sequence).toBe('101');
    expect(decoded.summary.memo).toBe('invoice-42');
    expect(decoded.summary.signatures).toBe(0);
    expect(decoded.summary.isFeeBump).toBe(false);

    const [payment, claimable] = decoded.summary.operations;
    expect(payment.type).toBe('payment');
    expect(payment.details).toMatchObject({ destination, asset: 'XLM', amount: '12.5000000' });
    expect(claimable.type).toBe('createClaimableBalance');
    expect(claimable.details.asset).toBe(`USDC:${destination}`);
  });

  it('produces a plain tree with strkeys and readable enums', () => {
    const decoded = decodeEnvelope(buildEnvelope().xdr, Networks.TESTNET);
    if (!decoded.ok) throw new Error(decoded.error);

    const json = treeToJson(decoded.tree);
    expect(json).toContain(source.publicKey());
    expect(json).toContain('"envelopeTypeTx"');
    expect(json).toContain('"invoice-42"');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('unwraps fee-bump envelopes', () => {
    const { tx } = buildEnvelope();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(sourceKey, '500', tx, Networks.TESTNET);

    const decoded = decodeEnvelope(feeBump.toEnvelope().toXDR('base64'), Networks.TESTNET);
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.summary.isFeeBump).toBe(true);
    expect(decoded.summary.feeSource).toBe(source.publicKey());
    expect(decoded.summary.operations).toHaveLength(2);
  });

  it('reports invalid input instead of throwing', () => {
    expect(decodeEnvelope('not-xdr', Networks.TESTNET).ok).toBe(false);
    expect(decodeEnvelope('', Networks.TESTNET)).toEqual({ ok: false, error: 'Empty envelope XDR' });
  });
});

describe('decodeResult', () => {
  it('decodes fee charged, codes and the claimable balance ID', () => {
    const decoded = decodeResult(buildResult());
    if (!decoded.ok) throw new Error(decoded.error);

    expect(decoded.summary.feeCharged).toBe('200');
    expect(decoded.summary.code).toBe('txSuccess');
    expect(decoded.summary.success).toBe(true);
    expect(decoded.summary.operations[0]).toMatchObject({ type: 'payment', code: 'paymentSuccess', success: true });
    expect(decoded.summary.operations[1].details['Claimable balance ID']).toBe(
      `00000000${'07'.repeat(32)}`,
    );
  });

  it('marks failed operations', () => {
    const failed = new xdr.TransactionResult({
      feeCharged: new xdr.Int64(100),
      result: xdr.TransactionResultResult.txFailed([
        xdr.OperationResult.opInner(xdr.OperationResultTr.payment(xdr.PaymentResult.paymentUnderfunded())),
        xdr.OperationResult.opNoAccount(),
      ]),
      ext: new xdr.TransactionResultExt(0),
    }).toXDR('base64');

    const decoded = decodeResult(failed);
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.summary.success).toBe(false);
    expect(decoded.summary.operations.map((op) => op.code)).toEqual(['paymentUnderfunded', 'opNoAccount']);
    expect(decoded.summary.operations[1].type).toBeNull();
  });

  it('reports invalid input instead of throwing', () => {
    expect(decodeResult('AAAA').ok).toBe(false);
  });
});

describe('decodeContractReturnValue', () => {
  it('reads the Soroban return value from v3 meta', () => {
    const meta = xdr.TransactionMeta.fromXDR(
      new xdr.TransactionMeta(
        3,
        new xdr.TransactionMetaV3({
          ext: new xdr.ExtensionPoint(0),
          txChangesBefore: [],
          operations: [],
          txChangesAfter: [],
          sorobanMeta: new xdr.SorobanTransactionMeta({
            ext: new xdr.SorobanTransactionMetaExt(0),
            events: [],
            returnValue: nativeToScVal(42, { type: 'u32' }),
            diagnosticEvents: [],
          }),
        }),
      ).toXDR(),
    ).toXDR('base64');

    expect(decodeContractReturnValue(meta)).toEqual({ type: 'scvU32', value: 42 });
  });

  it('returns null for missing or invalid meta', () => {
    expect(decodeContractReturnValue(undefined)).toBeNull();
    expect(decodeContractReturnValue('garbage')).toBeNull();
  });
});

describe('xdrToPlain', () => {
  it('renders 64-bit ints as decimal strings', () => {
    expect(xdrToPlain(new xdr.Int64(5))).toBe('5');
  });
});
