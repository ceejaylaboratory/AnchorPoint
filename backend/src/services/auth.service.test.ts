import jwt from 'jsonwebtoken';
import { RedisService } from './redis.service';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
  decode: jest.fn()
}));

jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto');
  return {
    ...actual,
    randomBytes: jest.fn((size: number) => actual.randomBytes(size)),
    randomUUID: jest.fn(() => actual.randomUUID())
  };
});

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const loadAuthService = () => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwtMock = require('jsonwebtoken') as typeof jwt;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cryptoMock = require('node:crypto');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loggerMock = require('../utils/logger').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./auth.service') as typeof import('./auth.service');
  return { ...mod, jwtMock, cryptoMock, loggerMock };
};

describe('Auth Service', () => {
  afterEach(() => {
    delete process.env.JWT_SECRET;
    jest.clearAllMocks();
  });

  it('extractBearerToken returns null when header is missing', () => {
    const { extractBearerToken } = loadAuthService();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('extractBearerToken returns null for non-bearer authorization', () => {
    const { extractBearerToken } = loadAuthService();
    expect(extractBearerToken('Basic abc')).toBeNull();
  });

  it('extractBearerToken extracts token from Bearer header', () => {
    const { extractBearerToken } = loadAuthService();
    expect(extractBearerToken('Bearer tok_123')).toBe('tok_123');
  });

  it('extractBearerToken returns null when Bearer token is empty', () => {
    const { extractBearerToken } = loadAuthService();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });

  it('signToken signs with {sub: publicKey} and the configured secret', () => {
    process.env.JWT_SECRET = 'test-secret';
    const { signToken, jwtMock } = loadAuthService();
    (jwtMock.sign as jest.Mock).mockReturnValue('signed-token');
    const token = signToken('GBAD_PUBLIC_KEY');

    expect(token).toBe('signed-token');
    expect(jwtMock.sign).toHaveBeenCalledWith({ sub: 'GBAD_PUBLIC_KEY' }, 'test-secret');
  });

  it('signAccessToken signs with 15 min TTL (900s)', () => {
    process.env.JWT_SECRET = 'test-secret';
    const { signAccessToken, ACCESS_TOKEN_TTL_SECONDS, jwtMock } = loadAuthService();
    (jwtMock.sign as jest.Mock).mockReturnValue('signed-access-token');

    const token = signAccessToken('GBAD_PUBLIC_KEY');

    expect(token).toBe('signed-access-token');
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(jwtMock.sign).toHaveBeenCalledWith(
      { sub: 'GBAD_PUBLIC_KEY' },
      'test-secret',
      { expiresIn: 900 }
    );
  });

  it('verifyToken returns the `sub` claim when valid', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { verifyToken, jwtMock } = loadAuthService();
    (jwtMock.verify as jest.Mock).mockReturnValue({ sub: 'GVALID_PUBLIC_KEY' });
    const decoded = await verifyToken('tok_123');

    expect(decoded).toEqual({ sub: 'GVALID_PUBLIC_KEY' });
    expect(jwtMock.verify).toHaveBeenCalledWith('tok_123', 'test-secret');
  });

  it('verifyToken throws when payload has no sub', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { verifyToken, jwtMock } = loadAuthService();
    (jwtMock.verify as jest.Mock).mockReturnValue({});
    await expect(verifyToken('tok_123')).rejects.toThrow('Invalid token payload');
  });

  describe('Challenge Management', () => {
    let mockRedisService: Partial<RedisService>;

    beforeEach(() => {
      mockRedisService = {
        getJSON: jest.fn(),
        setJSON: jest.fn(),
        del: jest.fn()
      };
    });

    it('generateChallenge returns base64 encoded random bytes', () => {
      const { generateChallenge, cryptoMock } = loadAuthService();
      const mockBuffer = Buffer.from('random-bytes');
      cryptoMock.randomBytes.mockReturnValue(mockBuffer);

      const challenge = generateChallenge();

      expect(challenge).toBe(mockBuffer.toString('base64'));
      expect(cryptoMock.randomBytes).toHaveBeenCalledWith(32);
    });

    it('storeChallenge stores challenge data in Redis with TTL', async () => {
      const { storeChallenge } = loadAuthService();
      const publicKey = 'GBAD_PUBLIC_KEY';
      const challenge = 'test-challenge';
      const mockTimestamp = 1640995200000;
      
      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

      await storeChallenge(mockRedisService as RedisService, publicKey, challenge);

      expect(mockRedisService.setJSON).toHaveBeenCalledWith(
        'sep10:challenge:GBAD_PUBLIC_KEY',
        {
          challenge: 'test-challenge',
          publicKey: 'GBAD_PUBLIC_KEY',
          createdAt: mockTimestamp
        },
        300 // 5 minutes TTL
      );

      jest.restoreAllMocks();
    });

    it('getChallenge retrieves challenge data from Redis', async () => {
      const { getChallenge } = loadAuthService();
      const publicKey = 'GBAD_PUBLIC_KEY';
      const expectedChallenge = {
        challenge: 'test-challenge',
        publicKey: 'GBAD_PUBLIC_KEY',
        createdAt: 1640995200000
      };

      (mockRedisService.getJSON as jest.Mock).mockResolvedValue(expectedChallenge);

      const result = await getChallenge(mockRedisService as RedisService, publicKey);

      expect(result).toEqual(expectedChallenge);
      expect(mockRedisService.getJSON).toHaveBeenCalledWith('sep10:challenge:GBAD_PUBLIC_KEY');
    });

    it('getChallenge returns null when challenge not found', async () => {
      const { getChallenge } = loadAuthService();
      const publicKey = 'GBAD_PUBLIC_KEY';

      (mockRedisService.getJSON as jest.Mock).mockResolvedValue(null);

      const result = await getChallenge(mockRedisService as RedisService, publicKey);

      expect(result).toBeNull();
      expect(mockRedisService.getJSON).toHaveBeenCalledWith('sep10:challenge:GBAD_PUBLIC_KEY');
    });

    it('removeChallenge deletes challenge from Redis', async () => {
      const { removeChallenge } = loadAuthService();
      const publicKey = 'GBAD_PUBLIC_KEY';

      (mockRedisService.del as jest.Mock).mockResolvedValue(1);

      await removeChallenge(mockRedisService as RedisService, publicKey);

      expect(mockRedisService.del).toHaveBeenCalledWith('sep10:challenge:GBAD_PUBLIC_KEY');
    });
  });

  describe('Refresh Token Issuance, Rotation, and Reuse Detection', () => {
    let store: Map<string, string>;
    let redisService: RedisService;

    beforeEach(() => {
      store = new Map<string, string>();
      redisService = new RedisService({
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, value: string) => {
          store.set(key, value);
          return 'OK';
        },
        del: async (key: string) => (store.delete(key) ? 1 : 0),
        expire: async () => 1
      });
    });

    it('issues access_token (15m TTL) and refresh_token (7d TTL) and stores hashed refresh token in Redis', async () => {
      process.env.JWT_SECRET = 'test-secret';
      const {
        issueTokenPair,
        hashRefreshToken,
        ACCESS_TOKEN_TTL_SECONDS,
        REFRESH_TOKEN_TTL_SECONDS,
        jwtMock
      } = loadAuthService();
      (jwtMock.sign as jest.Mock).mockReturnValue('access-jwt-1');

      const setJSONSpy = jest.spyOn(redisService, 'setJSON');
      const pair = await issueTokenPair('GUSER_PUBLIC_KEY', redisService);

      expect(pair.access_token).toBe('access-jwt-1');
      expect(typeof pair.refresh_token).toBe('string');
      expect(pair.refresh_token.length).toBeGreaterThanOrEqual(64);
      expect(pair.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
      expect(pair.expires_in).toBe(900);
      expect(pair.refresh_expires_in).toBe(REFRESH_TOKEN_TTL_SECONDS);
      expect(pair.refresh_expires_in).toBe(7 * 24 * 60 * 60);

      // Verify raw refresh token is NOT used as Redis key; hashed token is used
      const tokenHash = hashRefreshToken(pair.refresh_token);
      expect(tokenHash).not.toBe(pair.refresh_token);
      expect(store.has(`auth:refresh:${pair.refresh_token}`)).toBe(false);
      expect(store.has(`auth:refresh:${tokenHash}`)).toBe(true);

      const storedRecord = await redisService.getJSON<any>(`auth:refresh:${tokenHash}`);
      expect(storedRecord).toMatchObject({
        familyId: pair.familyId,
        publicKey: 'GUSER_PUBLIC_KEY',
        status: 'active'
      });

      expect(setJSONSpy).toHaveBeenCalledWith(
        `auth:refresh:${tokenHash}`,
        expect.objectContaining({ status: 'active', publicKey: 'GUSER_PUBLIC_KEY' }),
        REFRESH_TOKEN_TTL_SECONDS
      );
    });

    it('rotates a valid refresh token, returns a new pair, and marks the old token as rotated', async () => {
      process.env.JWT_SECRET = 'test-secret';
      const {
        issueTokenPair,
        rotateRefreshToken,
        hashRefreshToken,
        jwtMock
      } = loadAuthService();
      (jwtMock.sign as jest.Mock)
        .mockReturnValueOnce('access-jwt-initial')
        .mockReturnValueOnce('access-jwt-rotated');

      const initialPair = await issueTokenPair('GUSER_PUBLIC_KEY', redisService);
      const rotatedPair = await rotateRefreshToken(initialPair.refresh_token, redisService);

      expect(rotatedPair.access_token).toBe('access-jwt-rotated');
      expect(rotatedPair.refresh_token).not.toBe(initialPair.refresh_token);
      expect(rotatedPair.familyId).toBe(initialPair.familyId);
      expect(rotatedPair.publicKey).toBe('GUSER_PUBLIC_KEY');

      const oldHash = hashRefreshToken(initialPair.refresh_token);
      const newHash = hashRefreshToken(rotatedPair.refresh_token);

      const oldRecord = await redisService.getJSON<any>(`auth:refresh:${oldHash}`);
      const newRecord = await redisService.getJSON<any>(`auth:refresh:${newHash}`);

      expect(oldRecord?.status).toBe('rotated');
      expect(newRecord?.status).toBe('active');
    });

    it('triggers a security alert and invalidates the entire session family when a rotated token is reused', async () => {
      process.env.JWT_SECRET = 'test-secret';
      const {
        issueTokenPair,
        rotateRefreshToken,
        hashRefreshToken,
        RefreshTokenReuseError,
        jwtMock,
        loggerMock
      } = loadAuthService();
      (jwtMock.sign as jest.Mock).mockReturnValue('access-jwt');

      // 1. Issue initial token pair (token 1)
      const pair1 = await issueTokenPair('GUSER_PUBLIC_KEY', redisService);

      // 2. Rotate token 1 -> issues token 2
      const pair2 = await rotateRefreshToken(pair1.refresh_token, redisService);

      // 3. Rotate token 2 -> issues token 3
      const pair3 = await rotateRefreshToken(pair2.refresh_token, redisService);

      // 4. Attempt to reuse already-rotated token 1
      await expect(rotateRefreshToken(pair1.refresh_token, redisService)).rejects.toThrow(
        RefreshTokenReuseError
      );

      // Security alert must be logged
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY ALERT: Refresh token reuse detected'),
        expect.objectContaining({
          alertType: 'REFRESH_TOKEN_REUSE',
          severity: 'critical',
          familyId: pair1.familyId,
          publicKey: 'GUSER_PUBLIC_KEY'
        })
      );

      // Entire session family must be invalidated (including the latest active token 3)
      const hash3 = hashRefreshToken(pair3.refresh_token);
      expect(await redisService.getJSON(`auth:refresh:${hash3}`)).toBeNull();

      const familyRecord = await redisService.getJSON<any>(`auth:refresh_family:${pair1.familyId}`);
      expect(familyRecord?.revoked).toBe(true);

      // Subsequent attempt to use token 3 must fail
      await expect(rotateRefreshToken(pair3.refresh_token, redisService)).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });

    it('rejects unknown or expired refresh tokens', async () => {
      const { rotateRefreshToken } = loadAuthService();

      await expect(rotateRefreshToken('non-existent-token', redisService)).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });
  });

  describe('SEP-10 challenge timeBounds validation', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const StellarSdk = require('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NetworkType } = require('../config/networks') as typeof import('../config/networks');
    type StellarTransaction = import('@stellar/stellar-sdk').Transaction;

    const anchor = StellarSdk.Keypair.random();
    const client = StellarSdk.Keypair.random();

    const parse = (xdr: string): StellarTransaction =>
      StellarSdk.TransactionBuilder.fromXDR(xdr, StellarSdk.Networks.TESTNET) as StellarTransaction;

    const signChallenge = (xdr: string): string => {
      const tx = parse(xdr);
      tx.sign(client);
      return tx.toXDR();
    };

    const issueSignedChallenge = () => {
      const { generateSep10ChallengeTransaction } = loadAuthService();
      const challenge = generateSep10ChallengeTransaction(
        anchor.publicKey(),
        client.publicKey(),
        NetworkType.TESTNET
      );
      const signedXdr = signChallenge(challenge.transactionXdr);
      const stored = {
        challenge: challenge.challenge,
        publicKey: client.publicKey(),
        createdAt: Date.now(),
        transactionXdr: challenge.transactionXdr
      };
      const maxTime = Number(parse(signedXdr).timeBounds!.maxTime);
      return { signedXdr, stored, maxTime };
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('accepts a signed challenge before timeBounds.maxTime', () => {
      const { signedXdr, stored } = issueSignedChallenge();
      const { verifySep10ChallengeTransaction } = loadAuthService();

      expect(verifySep10ChallengeTransaction(signedXdr, stored, NetworkType.TESTNET)).toEqual({
        isValid: true,
        account: client.publicKey()
      });
    });

    it('rejects a correctly signed challenge once timeBounds.maxTime has passed', () => {
      const { signedXdr, stored, maxTime } = issueSignedChallenge();
      const { verifySep10ChallengeTransaction } = loadAuthService();

      jest.spyOn(Date, 'now').mockReturnValue((maxTime + 1) * 1000);

      expect(verifySep10ChallengeTransaction(signedXdr, stored, NetworkType.TESTNET)).toEqual({
        isValid: false,
        account: client.publicKey(),
        error: 'challenge_expired'
      });
    });

    it('does not report challenge_expired for a mismatched challenge', () => {
      const { stored, maxTime } = issueSignedChallenge();
      const { verifySep10ChallengeTransaction, generateSep10ChallengeTransaction } = loadAuthService();
      // A different challenge value signed by the same client must still fail
      // as an ordinary invalid challenge, even after expiry.
      const other = generateSep10ChallengeTransaction(anchor.publicKey(), client.publicKey(), NetworkType.TESTNET);
      const otherSigned = signChallenge(other.transactionXdr);

      jest.spyOn(Date, 'now').mockReturnValue((maxTime + 1) * 1000);

      const result = verifySep10ChallengeTransaction(otherSigned, stored, NetworkType.TESTNET);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('isSep10ChallengeExpired treats maxTime as an exclusive upper bound', () => {
      const { signedXdr, maxTime } = issueSignedChallenge();
      const { isSep10ChallengeExpired } = loadAuthService();

      expect(isSep10ChallengeExpired(signedXdr, NetworkType.TESTNET, (maxTime - 1) * 1000)).toBe(false);
      expect(isSep10ChallengeExpired(signedXdr, NetworkType.TESTNET, maxTime * 1000)).toBe(true);
      expect(isSep10ChallengeExpired(signedXdr, NetworkType.TESTNET, (maxTime + 60) * 1000)).toBe(true);
    });

    it('isSep10ChallengeExpired rejects challenges without a finite maxTime', () => {
      const { isSep10ChallengeExpired } = loadAuthService();
      const unbounded = new StellarSdk.TransactionBuilder(new StellarSdk.Account(anchor.publicKey(), '0'), {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET
      })
        .addOperation(
          StellarSdk.Operation.manageData({
            name: 'stellar.sep10.challenge',
            value: 'value',
            source: client.publicKey()
          })
        )
        .setTimeout(StellarSdk.TimeoutInfinite)
        .build();

      expect(isSep10ChallengeExpired(unbounded.toXDR(), NetworkType.TESTNET)).toBe(true);
      expect(isSep10ChallengeExpired('not-xdr', NetworkType.TESTNET)).toBe(true);
    });
  });
});

