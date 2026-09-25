import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';
import { config } from '../config/env';
import mockPrisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: { transaction: { update: jest.fn().mockResolvedValue({}) } },
}));

// Mock Stellar SDK
jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  const mockHorizonServer = {
    submitTransaction: jest.fn(),
    loadAccount: jest.fn(),
    fetchBaseFee: jest.fn(),
  };

  // A lightweight TransactionBuilder mock that supports the fluent API
  const mockTxInstance = {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({
      sign: jest.fn(),
      toXDR: jest.fn().mockReturnValue('mock-xdr'),
      hash: jest.fn().mockReturnValue(Buffer.from('tx-hash')),
      source: 'G_SENDER',
      operations: [{ type: 'payment' }],
    }),
  };
  const MockTransactionBuilder = jest.fn().mockImplementation(() => mockTxInstance);
  (MockTransactionBuilder as any).fromXDR = jest.fn();
  (MockTransactionBuilder as any).buildFeeBumpTransaction = jest.fn();

  return {
    ...original,
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockHorizonServer),
    },
    TransactionBuilder: MockTransactionBuilder,
    __mockHorizonServer: mockHorizonServer,
    __mockTxInstance: mockTxInstance,
    Keypair: {
      fromSecret: jest.fn().mockImplementation(() => ({
        publicKey: () => 'G_FEE_BUMPER',
        sign: jest.fn(),
      })),
      fromPublicKey: original.Keypair.fromPublicKey,
    },
    Asset: jest.fn().mockImplementation((code: string, issuer: string) => ({ code, issuer })),
    Claimant: jest.fn().mockImplementation((dest: string) => ({ destination: dest })),
    Operation: {
      payment: jest.fn().mockReturnValue({ type: 'payment' }),
      createClaimableBalance: jest.fn().mockReturnValue({ type: 'createClaimableBalance' }),
      manageData: original.Operation.manageData,
      changeTrust: original.Operation.changeTrust,
      setOptions: original.Operation.setOptions,
      manageBuyOffer: original.Operation.manageBuyOffer,
      manageSellOffer: original.Operation.manageSellOffer,
      createAccount: original.Operation.createAccount,
    },
  };
});

describe('StellarService', () => {
  let stellarService: StellarService;

  beforeEach(() => {
    jest.clearAllMocks();
    stellarService = new (StellarService as any)();
  });

  it('should use public network passphrase when configured', () => {
    (config as any).STELLAR_NETWORK = 'public';
    stellarService = new (StellarService as any)();
    expect((stellarService as any).networkPassphrase).toBe(StellarSdk.Networks.PUBLIC);
  });


  it('should successfully submit a whitelisted operation', async () => {
    const mockTx = {
      source: 'G_SOURCE',
      operations: [{ type: 'payment' }],
      hash: jest.fn().mockReturnValue(Buffer.from('tx-hash')),
    };
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);
    (StellarSdk as any).__mockHorizonServer.submitTransaction.mockResolvedValue({ hash: '123', ledger: 456 });

    const result = await stellarService.submitTransaction('mock-xdr');

    expect(result.hash).toBe('123');
    expect((StellarSdk as any).__mockHorizonServer.submitTransaction).toHaveBeenCalled();
  });

  it('should throw error for non-whitelisted operation', async () => {
    const mockTx = {
      source: 'G_SOURCE',
      operations: [{ type: 'allowTrust' }], // Not in whitelist
    };
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);

    await expect(stellarService.submitTransaction('mock-xdr'))
      .rejects.toThrow("Operation type 'allowTrust' is not whitelisted");
  });

  it('should throw error for direct fee-bump submission', async () => {
    const mockFeeBump = Object.create(StellarSdk.FeeBumpTransaction.prototype);
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockFeeBump);

    await expect(stellarService.submitTransaction('mock-xdr'))
      .rejects.toThrow('Direct submission of fee-bump transactions is not allowed');
  });

  it('should handle complex Stellar error responses', async () => {
    const mockTx = {
      source: 'G_SOURCE',
      operations: [{ type: 'payment' }],
      hash: jest.fn().mockReturnValue(Buffer.from('tx-hash')),
    };
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);
    
    const stellarError = new Error('Stellar Error');
    (stellarError as any).response = {
      data: {
        extras: {
          result_codes: {
            operations: ['op_underfunded']
          }
        }
      }
    };
    (StellarSdk as any).__mockHorizonServer.submitTransaction.mockRejectedValue(stellarError);

    await expect(stellarService.submitTransaction('mock-xdr'))
      .rejects.toThrow(/Stellar Error: {"operations":\["op_underfunded"\]}/);
  });


  it('should apply fee-bump if secret is configured', async () => {
    // Re-initialize with secret
    (config as any).STELLAR_FEE_BUMP_SECRET = 'S_MOCK_SECRET';
    stellarService = new (StellarService as any)();

    const mockTx = {
      source: 'G_SOURCE',
      operations: [{ type: 'payment' }],
      hash: jest.fn().mockReturnValue(Buffer.from('tx-hash')),
    };
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);
    (StellarSdk.TransactionBuilder.buildFeeBumpTransaction as jest.Mock).mockReturnValue({ hash: 'bumped' });
    (StellarSdk as any).__mockHorizonServer.submitTransaction.mockResolvedValue({ hash: 'bumped', ledger: 789 });

    await stellarService.submitTransaction('mock-xdr');

    expect(StellarSdk.TransactionBuilder.buildFeeBumpTransaction).toHaveBeenCalled();
  });

  it('should extract source account from XDR', () => {
    const mockTx = { source: 'G_EXPECTED' };
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);

    const source = StellarService.getSourceAccountFromXDR('mock-xdr');
    expect(source).toBe('G_EXPECTED');
  });

  it('should handle FeeBumpTransaction in getSourceAccountFromXDR', () => {
    const mockInner = { source: 'G_INNER' };
    const mockFeeBump = Object.create(StellarSdk.FeeBumpTransaction.prototype);
    Object.defineProperty(mockFeeBump, 'innerTransaction', { value: mockInner });

    
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockFeeBump);

    const source = StellarService.getSourceAccountFromXDR('mock-xdr');
    expect(source).toBe('G_INNER');
  });

  it('should throw error for invalid XDR in getSourceAccountFromXDR', () => {
    (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockImplementation(() => {
      throw new Error('invalid');
    });

    expect(() => StellarService.getSourceAccountFromXDR('invalid'))
      .toThrow('Invalid transaction XDR');
  });
});

// ─── Claimable Balance fallback (closes #1187) ────────────────────────────────

describe('StellarService.sendPaymentWithClaimableFallback', () => {
  let service: StellarService;
  const mockServer = (StellarSdk as any).__mockHorizonServer;

  const SENDER_SECRET = 'SCZANGBA5RLGO6LRBL2N6BX4BNKSMNOY4ZAHBNHCFNLVLZ52JBFSCPCK' as const;
  const RECIPIENT = 'GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN' as const;

  const validOptions = {
    senderSecret: SENDER_SECRET,
    recipientPublicKey: RECIPIENT,
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '100',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new (StellarService as any)();

    // Default: loadAccount returns a minimal account with no trustlines
    mockServer.loadAccount.mockResolvedValue({
      id: 'G_SENDER',
      sequence: '1',
      balances: [],
      signers: [],
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      incrementSequenceNumber: jest.fn(),
    });

    // Successful submission response
    mockServer.submitTransaction.mockResolvedValue({ hash: 'tx-hash-cb' });
  });

  it('uses Payment when recipient has a trustline', async () => {
    // loadAccount for sender (first call) has no balances;
    // loadAccount for recipient (second call) has the trustline
    mockServer.loadAccount
      .mockResolvedValueOnce({
        id: 'G_SENDER',
        sequence: '1',
        balances: [],
        signers: [],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        incrementSequenceNumber: jest.fn(),
      })
      .mockResolvedValueOnce({
        id: RECIPIENT,
        balances: [{ asset_code: 'USDC', asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', balance: '0' }],
        signers: [],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      });

    const result = await service.sendPaymentWithClaimableFallback(validOptions);

    expect(result.usedClaimableBalance).toBe(false);
    expect(result.hash).toBe('tx-hash-cb');
    expect(result.claimableBalanceId).toBeUndefined();
  });

  it('falls back to CreateClaimableBalance when recipient has no trustline', async () => {
    // Both loadAccount calls return accounts with empty balances (no trustlines)
    mockServer.loadAccount.mockResolvedValue({
      id: 'G_ANY',
      sequence: '1',
      balances: [],
      signers: [],
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      incrementSequenceNumber: jest.fn(),
    });

    const result = await service.sendPaymentWithClaimableFallback(validOptions);

    expect(result.usedClaimableBalance).toBe(true);
    expect(result.hash).toBe('tx-hash-cb');
  });

  it('falls back to claimable balance when recipient account does not exist (loadAccount throws)', async () => {
    // Sender loads fine; recipient throws (unfunded account)
    mockServer.loadAccount
      .mockResolvedValueOnce({
        id: 'G_SENDER',
        sequence: '1',
        balances: [],
        signers: [],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        incrementSequenceNumber: jest.fn(),
      })
      .mockRejectedValueOnce(Object.assign(new Error('Account not found'), { response: { status: 404 } }));

    const result = await service.sendPaymentWithClaimableFallback(validOptions);

    expect(result.usedClaimableBalance).toBe(true);
  });

  it('propagates non-404 Horizon errors instead of falling back', async () => {
    mockServer.loadAccount
      .mockResolvedValueOnce({
        id: 'G_SENDER',
        sequence: '1',
        balances: [],
        signers: [],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        incrementSequenceNumber: jest.fn(),
      })
      .mockRejectedValueOnce(Object.assign(new Error('Bad request'), { response: { status: 400 } }));

    await expect(service.sendPaymentWithClaimableFallback(validOptions)).rejects.toThrow('Bad request');
    expect(mockServer.submitTransaction).not.toHaveBeenCalled();
  });

  it('records the claimable balance ID on the transaction when transactionId is given', async () => {
    const { xdr: realXdr } = jest.requireActual('@stellar/stellar-sdk');
    const balanceId = realXdr.ClaimableBalanceId.claimableBalanceIdTypeV0(Buffer.alloc(32, 7));
    const resultXdr = new realXdr.TransactionResult({
      feeCharged: realXdr.Int64.fromString('100'),
      result: realXdr.TransactionResultResult.txSuccess([
        realXdr.OperationResult.opInner(
          realXdr.OperationResultTr.createClaimableBalance(
            realXdr.CreateClaimableBalanceResult.createClaimableBalanceSuccess(balanceId),
          ),
        ),
      ]),
      ext: new realXdr.TransactionResultExt(0),
    }).toXDR('base64');
    mockServer.submitTransaction.mockResolvedValue({ hash: 'tx-hash-cb', result_xdr: resultXdr });

    const result = await service.sendPaymentWithClaimableFallback({ ...validOptions, transactionId: 'tx-1' });

    expect(result.claimableBalanceId).toBe(balanceId.toXDR('hex'));
    expect((mockPrisma as any).transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { claimableBalanceId: balanceId.toXDR('hex'), stellarTxId: 'tx-hash-cb' },
    });
  });
});
