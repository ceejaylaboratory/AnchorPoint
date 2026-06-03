import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import logger from '../utils/logger';

export type InteractiveFlow = 'deposit' | 'withdraw';

export interface InteractiveTokenData {
  asset: string;
  amount?: string;
  lang: string;
  flow: InteractiveFlow;
}

export interface InteractiveTokenClaims {
  sub: string;
  jti: string;
  data: InteractiveTokenData;
}

export interface ValidatedInteractiveToken extends InteractiveTokenClaims {
  exp: number;
  iat: number;
}

export class InteractiveTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveTokenError';
  }
}

export interface SignInteractiveTokenParams {
  transactionId: string;
  account?: string;
  assetCode: string;
  amount?: string;
  lang?: string;
  flow: InteractiveFlow;
}

const getSecret = (): string =>
  config.SEP24_INTERACTIVE_URL_JWT_SECRET ?? config.JWT_SECRET;

const getExpirationSeconds = (): number => config.SEP24_INTERACTIVE_URL_JWT_EXPIRATION_SECONDS;

export const signInteractiveToken = ({
  transactionId,
  account,
  assetCode,
  amount,
  lang = 'en',
  flow,
}: SignInteractiveTokenParams): string => {
  const payload: InteractiveTokenClaims = {
    sub: account ?? '',
    jti: transactionId,
    data: {
      asset: assetCode,
      ...(amount ? { amount } : {}),
      lang,
      flow,
    },
  };

  return jwt.sign(payload, getSecret(), {
    algorithm: 'HS256',
    expiresIn: getExpirationSeconds(),
  });
};

export const validateInteractiveToken = (token: string): ValidatedInteractiveToken => {
  try {
    const decoded = jwt.verify(token, getSecret(), {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload & InteractiveTokenClaims;

    if (!decoded.jti || !decoded.data?.asset || !decoded.data?.flow) {
      throw new InteractiveTokenError('Invalid token payload');
    }

    if (decoded.data.flow !== 'deposit' && decoded.data.flow !== 'withdraw') {
      throw new InteractiveTokenError('Invalid token flow');
    }

    return decoded as ValidatedInteractiveToken;
  } catch (error) {
    if (error instanceof InteractiveTokenError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('SEP-24 interactive token expired');
      throw new InteractiveTokenError('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('SEP-24 interactive token validation failed', { error: error.message });
      throw new InteractiveTokenError('Invalid token');
    }
    throw error;
  }
};
