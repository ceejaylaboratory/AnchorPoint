import jwt from 'jsonwebtoken';

const tokenSecret = 'sep24-interactive-test-secret';

jest.mock('../config/env', () => ({
  config: {
    SEP24_INTERACTIVE_URL_JWT_SECRET: tokenSecret,
    SEP24_INTERACTIVE_URL_JWT_EXPIRATION_SECONDS: 600,
    JWT_SECRET: tokenSecret,
  },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const loadTokenService = () => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./sep24-interactive-token.service') as typeof import('./sep24-interactive-token.service');
};

describe('SEP-24 Interactive Token Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('signInteractiveToken embeds transaction fields in the JWT payload', () => {
    const { signInteractiveToken } = loadTokenService();
    const token = signInteractiveToken({
      transactionId: 'tx_123',
      account: 'GACCOUNT',
      assetCode: 'USDC',
      amount: '10.00',
      lang: 'fr',
      flow: 'deposit',
    });

    const decoded = jwt.verify(token, tokenSecret) as jwt.JwtPayload & {
      sub: string;
      jti: string;
      data: { asset: string; amount: string; lang: string; flow: string };
    };

    expect(decoded.sub).toBe('GACCOUNT');
    expect(decoded.jti).toBe('tx_123');
    expect(decoded.data).toEqual({
      asset: 'USDC',
      amount: '10.00',
      lang: 'fr',
      flow: 'deposit',
    });
  });

  it('validateInteractiveToken returns decoded claims for a valid token', () => {
    const { signInteractiveToken, validateInteractiveToken } = loadTokenService();
    const token = signInteractiveToken({
      transactionId: 'tx_456',
      assetCode: 'BTC',
      flow: 'withdraw',
    });

    const claims = validateInteractiveToken(token);

    expect(claims.jti).toBe('tx_456');
    expect(claims.data.asset).toBe('BTC');
    expect(claims.data.flow).toBe('withdraw');
    expect(claims.data.lang).toBe('en');
  });

  it('validateInteractiveToken rejects expired tokens', () => {
    const { validateInteractiveToken, InteractiveTokenError } = loadTokenService();
    const expiredToken = jwt.sign(
      {
        sub: 'GACCOUNT',
        jti: 'tx_expired',
        data: { asset: 'USDC', lang: 'en', flow: 'deposit' },
      },
      tokenSecret,
      { algorithm: 'HS256', expiresIn: -1 },
    );

    expect(() => validateInteractiveToken(expiredToken)).toThrow(InteractiveTokenError);
    expect(() => validateInteractiveToken(expiredToken)).toThrow('Token has expired');
  });

  it('validateInteractiveToken rejects tampered tokens', () => {
    const { validateInteractiveToken, InteractiveTokenError } = loadTokenService();

    expect(() => validateInteractiveToken('not-a-valid-token')).toThrow(InteractiveTokenError);
    expect(() => validateInteractiveToken('not-a-valid-token')).toThrow('Invalid token');
  });

  it('validateInteractiveToken rejects tokens signed with a different secret', () => {
    const { validateInteractiveToken, InteractiveTokenError } = loadTokenService();
    const token = jwt.sign(
      {
        sub: 'GACCOUNT',
        jti: 'tx_other',
        data: { asset: 'USDC', lang: 'en', flow: 'deposit' },
      },
      'different-secret-value',
      { algorithm: 'HS256', expiresIn: 600 },
    );

    expect(() => validateInteractiveToken(token)).toThrow(InteractiveTokenError);
  });
});
