import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { RedisService } from './redis.service';
import { traceAsync, traceSync, SpanKind } from '../utils/tracing';
import configService from './config.service';

export interface VerifiedToken {
  sub: string;
}

export interface Challenge {
  challenge: string;
  publicKey: string;
  createdAt: number;
}

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const JWT_SECRET = configService.getConfig().JWT_SECRET;

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.split(' ')[1];
  return token || null;
};

export const signToken = (publicKey: string): string => {
  return traceSync(
    'auth.sign_token',
    (span) => {
      span.setAttribute('auth.public_key', publicKey);
      // SEP-10 convention (and how our middleware uses it):
      // the user's public key is stored in the JWT `sub` claim.
      return jwt.sign({ sub: publicKey }, JWT_SECRET);
    },
    SpanKind.INTERNAL
  );
};

export const verifyToken = (token: string): VerifiedToken => {
  return traceSync(
    'auth.verify_token',
    (span) => {
      span.setAttribute('auth.token_length', token.length);
      const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
      if (!decoded?.sub) throw new Error('Invalid token payload');
      span.setAttribute('auth.subject', decoded.sub);
      return { sub: decoded.sub };
    },
    SpanKind.INTERNAL
  );
};

/**
 * Generates a random challenge for SEP-10 authentication
 */
export const generateChallenge = (): string => {
  return randomBytes(32).toString('base64');
};

/**
 * Stores a challenge in Redis with TTL
 */
export const storeChallenge = async (
  redisService: RedisService,
  publicKey: string,
  challenge: string
): Promise<void> => {
  return traceAsync(
    'auth.store_challenge',
    async (span) => {
      span.setAttribute('auth.public_key', publicKey);
      span.setAttribute('auth.challenge_length', challenge.length);
      
      const challengeData: Challenge = {
        challenge,
        publicKey,
        createdAt: Date.now()
      };
      
      const key = `sep10:challenge:${publicKey}`;
      await redisService.setJSON(key, challengeData, CHALLENGE_TTL_SECONDS);
    },
    SpanKind.CLIENT,
    {
      'auth.operation': 'store_challenge',
      'auth.ttl_seconds': CHALLENGE_TTL_SECONDS,
    }
  );
};

/**
 * Retrieves and validates a challenge from Redis
 */
export const getChallenge = async (
  redisService: RedisService,
  publicKey: string
): Promise<Challenge | null> => {
  return traceAsync(
    'auth.get_challenge',
    async (span) => {
      span.setAttribute('auth.public_key', publicKey);
      const key = `sep10:challenge:${publicKey}`;
      const result = await redisService.getJSON<Challenge>(key);
      if (result) {
        span.setAttribute('auth.challenge_found', true);
        span.setAttribute('auth.challenge_age_ms', Date.now() - result.createdAt);
      } else {
        span.setAttribute('auth.challenge_found', false);
      }
      return result;
    },
    SpanKind.CLIENT,
    {
      'auth.operation': 'get_challenge',
    }
  );
};

/**
 * Removes a challenge from Redis after successful verification
 */
export const removeChallenge = async (
  redisService: RedisService,
  publicKey: string
): Promise<void> => {
  return traceAsync(
    'auth.remove_challenge',
    async (span) => {
      span.setAttribute('auth.public_key', publicKey);
      const key = `sep10:challenge:${publicKey}`;
      await redisService.del(key);
    },
    SpanKind.CLIENT,
    {
      'auth.operation': 'remove_challenge',
    }
  );
};

