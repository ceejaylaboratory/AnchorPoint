import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';
import { config } from '../config/env';

// Mock Stellar SDK
jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  const mockHorizonServer = {
    submitTransaction: jest.fn(),
    loadAccount: jest.fn(),
  };
  return {
    ...original,
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockHorizonServer),
    },
    TransactionBuilder: {
      ...original.TransactionBuilder,
      fromXDR: jest.fn(),
      buildFeeBumpTransaction: jest.fn(),
    },
    __mockHorizonServer: mockHorizonServer,
    Keypair: {
      fromSecret: jest.fn().mockImplementation(() => ({
        publicKey: () => 'G_FEE_BUMPER',
      })),
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
