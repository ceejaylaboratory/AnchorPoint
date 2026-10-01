/**
 * Multi-sig Horizon threshold verification tests for auth.service.ts
 * Closes #1178
 */

// Preserve the real SDK constants (Networks, etc.) while mocking only the
// transaction parsing methods that require a live Stellar network.
jest.mock('@stellar/stellar-sdk', () => {
  const real = jest.requireActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');

  const mockVerify = jest.fn();
  const mockHash = jest.fn().mockReturnValue(Buffer.from('txhash'));

  return {
    ...real,
    TransactionBuilder: {
      ...real.TransactionBuilder,
      fromXDR: jest.fn().mockReturnValue({
        hash: mockHash,
        signatures: [
          {
            signature: jest.fn().mockReturnValue(Buffer.from('sig1')),
          },
        ],
      }),
    },
    Keypair: {
      ...real.Keypair,
      fromPublicKey: jest.fn().mockReturnValue({
        verify: mockVerify,
      }),
    },
  };
});

// Mock sep10-stellar utilities so we don't need real XDR parsing
jest.mock('../utils/sep10-stellar', () => ({
  generateSep10Challenge: jest.fn().mockReturnValue({
    transactionXdr: 'mock-xdr',
    challenge: 'mock-challenge',
    networkPassphrase: 'Test SDF Network ; September 2015',
  }),
  verifySep10Challenge: jest.fn().mockReturnValue({
    isValid: true,
    account: 'GABCDE',
    challenge: 'mock-challenge',
  }),
}));

jest.mock('../utils/tracing', () => ({
  traceAsync: (_name: string, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: jest.fn() }),
  traceSync: (_name: string, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: jest.fn() }),
  SpanKind: { INTERNAL: 0, CLIENT: 1 },
}));

jest.mock('../services/config.service', () => {
  const mockGetConfig = jest.fn().mockReturnValue({
    JWT_SECRET: 'test-secret',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  });
  return {
    __esModule: true,
    default: { getConfig: mockGetConfig },
  };
});

jest.mock('../services/jwt-blacklist.service', () => ({
  revokeToken: jest.fn(),
  isTokenRevoked: jest.fn().mockResolvedValue(false),
}));

jest.mock('../lib/redis', () => ({ redis: {} }));

describe('verifySep10ChallengeTransactionMultiSig', () => {
  let verifySep10ChallengeTransactionMultiSig: (
    xdr: string,
    challenge: import('../services/auth.service').Challenge,
    networkType?: import('../config/networks').NetworkType,
    thresholdLevel?: 'low' | 'med' | 'high',
    horizonUrl?: string
  ) => Promise<{ isValid: boolean; account: string; totalWeight?: number; requiredWeight?: number }>;

  let verifySep10ChallengeUtilMock: jest.Mock;
  let StellarSdkMock: typeof import('@stellar/stellar-sdk');
  let mockChallenge: import('../services/auth.service').Challenge;

  const originalFetch = global.fetch;

  beforeAll(async () => {
    const mod = await import('../services/auth.service');
    verifySep10ChallengeTransactionMultiSig = (mod as unknown as Record<string, unknown>)
      .verifySep10ChallengeTransactionMultiSig as typeof verifySep10ChallengeTransactionMultiSig;
    const utilMod = await import('../utils/sep10-stellar');
    verifySep10ChallengeUtilMock = utilMod.verifySep10Challenge as jest.Mock;
    StellarSdkMock = await import('@stellar/stellar-sdk');
  });

  beforeEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
    verifySep10ChallengeUtilMock.mockReturnValue({
      isValid: true,
      account: 'GABCDE',
      challenge: 'mock-challenge',
    });

    mockChallenge = {
      challenge: 'mock-challenge',
      publicKey: 'GABCDE',
      createdAt: Date.now(),
    };
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns isValid=false when basic challenge verification fails', async () => {
    verifySep10ChallengeUtilMock.mockReturnValueOnce({
      isValid: false,
      account: '',
      challenge: '',
    });

    const result = await verifySep10ChallengeTransactionMultiSig(
      'bad-xdr',
      mockChallenge
    );

    expect(result.isValid).toBe(false);
  });

  it('falls back to single-sig acceptance when Horizon returns 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    const result = await verifySep10ChallengeTransactionMultiSig(
      'signed-xdr',
      mockChallenge,
      undefined,
      'med',
      'https://horizon-testnet.stellar.org'
    );

    expect(result.isValid).toBe(true);
    expect(result.account).toBe('GABCDE');
  });

  it('accepts when account has only one signer with weight meeting medium threshold', async () => {
    const mockAccountData = {
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      signers: [
        { key: 'GABCDE', weight: 2, type: 'ed25519_public_key' },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockAccountData),
    }) as unknown as typeof fetch;

    (StellarSdkMock.Keypair.fromPublicKey as jest.Mock).mockReturnValue({
      verify: jest.fn().mockReturnValue(true),
    });

    const result = await verifySep10ChallengeTransactionMultiSig(
      'signed-xdr',
      mockChallenge,
      undefined,
      'med',
      'https://horizon-testnet.stellar.org'
    );

    expect(result.isValid).toBe(true);
    expect(result.totalWeight).toBe(2);
    expect(result.requiredWeight).toBe(2);
  });

  it('rejects when combined signer weight is below medium threshold', async () => {
    const mockAccountData = {
      thresholds: { low_threshold: 1, med_threshold: 5, high_threshold: 10 },
      signers: [
        { key: 'GABCDE', weight: 2, type: 'ed25519_public_key' },
        { key: 'GBSIGNER2', weight: 2, type: 'ed25519_public_key' },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockAccountData),
    }) as unknown as typeof fetch;

    (StellarSdkMock.Keypair.fromPublicKey as jest.Mock)
      .mockReturnValueOnce({ verify: jest.fn().mockReturnValue(true) })   // first signer: signed
      .mockReturnValueOnce({ verify: jest.fn().mockReturnValue(false) }); // second signer: not signed

    const result = await verifySep10ChallengeTransactionMultiSig(
      'signed-xdr',
      mockChallenge,
      undefined,
      'med',
      'https://horizon-testnet.stellar.org'
    );

    expect(result.isValid).toBe(false);
    expect(result.totalWeight).toBe(2);
    expect(result.requiredWeight).toBe(5);
  });

  it('accepts multi-sig when combined weight meets high threshold', async () => {
    const mockAccountData = {
      thresholds: { low_threshold: 1, med_threshold: 3, high_threshold: 5 },
      signers: [
        { key: 'GABCDE', weight: 3, type: 'ed25519_public_key' },
        { key: 'GBSIGNER2', weight: 2, type: 'ed25519_public_key' },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockAccountData),
    }) as unknown as typeof fetch;

    (StellarSdkMock.Keypair.fromPublicKey as jest.Mock)
      .mockReturnValueOnce({ verify: jest.fn().mockReturnValue(true) })
      .mockReturnValueOnce({ verify: jest.fn().mockReturnValue(true) });

    const result = await verifySep10ChallengeTransactionMultiSig(
      'signed-xdr',
      mockChallenge,
      undefined,
      'high',
      'https://horizon-testnet.stellar.org'
    );

    expect(result.isValid).toBe(true);
    expect(result.totalWeight).toBe(5);
    expect(result.requiredWeight).toBe(5);
  });

  it('accepts single-sig account (all thresholds 0) without weight validation', async () => {
    const mockAccountData = {
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      signers: [{ key: 'GABCDE', weight: 1, type: 'ed25519_public_key' }],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockAccountData),
    }) as unknown as typeof fetch;

    const result = await verifySep10ChallengeTransactionMultiSig(
      'signed-xdr',
      mockChallenge
    );

    expect(result.isValid).toBe(true);
  });

  it('degrades gracefully when Horizon is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    const result = await verifySep10ChallengeTransactionMultiSig(
      'signed-xdr',
      mockChallenge,
      undefined,
      'med',
      'https://horizon-testnet.stellar.org'
    );

    // Basic signature was valid, so we accept despite Horizon failure
    expect(result.isValid).toBe(true);
    expect(result.account).toBe('GABCDE');
  });
});
