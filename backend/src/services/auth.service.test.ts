import jwt from 'jsonwebtoken';
import { RedisService } from './redis.service';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn()
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn()
}));

const loadAuthService = () => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwtMock = require('jsonwebtoken') as typeof jwt;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cryptoMock = require('crypto');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./auth.service') as typeof import('./auth.service');
  return { ...mod, jwtMock, cryptoMock };
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

  it('verifyToken returns the `sub` claim when valid', () => {
    process.env.JWT_SECRET = 'test-secret';
    const { verifyToken, jwtMock } = loadAuthService();
    (jwtMock.verify as jest.Mock).mockReturnValue({ sub: 'GVALID_PUBLIC_KEY' });
    const decoded = verifyToken('tok_123');

    expect(decoded).toEqual({ sub: 'GVALID_PUBLIC_KEY' });
    expect(jwtMock.verify).toHaveBeenCalledWith('tok_123', 'test-secret');
  });

  it('verifyToken throws when payload has no sub', () => {
    process.env.JWT_SECRET = 'test-secret';
    const { verifyToken, jwtMock } = loadAuthService();
    (jwtMock.verify as jest.Mock).mockReturnValue({});
    expect(() => verifyToken('tok_123')).toThrow('Invalid token payload');
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
});

