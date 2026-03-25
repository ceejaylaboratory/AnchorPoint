import jwt from 'jsonwebtoken';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn()
}));

const loadAuthService = () => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwtMock = require('jsonwebtoken') as typeof jwt;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./auth.service') as typeof import('./auth.service');
  return { ...mod, jwtMock };
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
});

