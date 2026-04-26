import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { RedisService } from './redis.service';
import { traceAsync, traceSync, SpanKind } from '../utils/tracing';
import configService from './config.service';
import {
  generateSep10Challenge,
  verifySep10Challenge,
  extractAccountFromSep10Transaction,
  type Sep10Challenge
} from '../utils/sep10-stellar';
import { NetworkType } from '../config/networks';

export interface VerifiedToken {
  sub: string;
}

export interface Challenge {
  challenge: string;
  publicKey: string;
  createdAt: number;
  transactionXdr?: string; // For hardware wallet support
}

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

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
      return jwt.sign({ sub: publicKey }, configService.getConfig().JWT_SECRET);
    },
    SpanKind.INTERNAL
  );
};

export const verifyToken = (token: string): VerifiedToken => {
  return traceSync(
    'auth.verify_token',
    (span) => {
      span.setAttribute('auth.token_length', token.length);
      const decoded = jwt.verify(token, configService.getConfig().JWT_SECRET) as { sub?: string };
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

/**
 * Generates a SEP-10 challenge transaction for hardware wallet support
 * @param anchorPublicKey The anchor's public key
 * @param clientPublicKey The client's public key
 * @param networkType The Stellar network type
 * @returns SEP-10 challenge with transaction XDR
 */
export const generateSep10ChallengeTransaction = (
  anchorPublicKey: string,
  clientPublicKey: string,
  networkType: NetworkType = NetworkType.TESTNET
): Sep10Challenge => {
  return traceSync(
    'auth.generate_sep10_challenge',
    (span) => {
      span.setAttribute('auth.anchor_public_key', anchorPublicKey);
      span.setAttribute('auth.client_public_key', clientPublicKey);
      span.setAttribute('auth.network_type', networkType);

      const challengeValue = generateChallenge();
      const sep10Challenge = generateSep10Challenge(
        anchorPublicKey,
        clientPublicKey,
        networkType,
        challengeValue
      );

      span.setAttribute('auth.challenge_length', challengeValue.length);
      return sep10Challenge;
    },
    SpanKind.INTERNAL
  );
};

/**
 * Stores a SEP-10 challenge with transaction XDR in Redis
 */
export const storeSep10Challenge = async (
  redisService: RedisService,
  publicKey: string,
  challenge: Sep10Challenge
): Promise<void> => {
  return traceAsync(
    'auth.store_sep10_challenge',
    async (span) => {
      span.setAttribute('auth.public_key', publicKey);
      span.setAttribute('auth.challenge_length', challenge.challenge.length);

      const challengeData: Challenge = {
        challenge: challenge.challenge,
        publicKey,
        createdAt: Date.now(),
        transactionXdr: challenge.transactionXdr
      };

      const key = `sep10:challenge:${publicKey}`;
      await redisService.setJSON(key, challengeData, CHALLENGE_TTL_SECONDS);
    },
    SpanKind.CLIENT,
    {
      'auth.operation': 'store_sep10_challenge',
      'auth.ttl_seconds': CHALLENGE_TTL_SECONDS,
    }
  );
};

/**
 * Verifies a signed SEP-10 challenge transaction
 * @param signedTransactionXdr The signed transaction XDR
 * @param storedChallenge The stored challenge data
 * @param networkType The Stellar network type
 * @returns Verification result with account
 */
export {
  extractAccountFromSep10Transaction
} from '../utils/sep10-stellar';
  signedTransactionXdr: string,
  storedChallenge: Challenge,
  networkType: NetworkType = NetworkType.TESTNET
): { isValid: boolean; account: string } => {
  return traceSync(
    'auth.verify_sep10_challenge',
    (span) => {
      span.setAttribute('auth.expected_challenge_length', storedChallenge.challenge.length);

      const verification = verifySep10Challenge(
        signedTransactionXdr,
        storedChallenge.challenge,
        networkType
      );

      span.setAttribute('auth.verification_valid', verification.isValid);
      if (verification.isValid) {
        span.setAttribute('auth.verified_account', verification.account);
      }

      return {
        isValid: verification.isValid,
        account: verification.account
      };
    },
    SpanKind.INTERNAL
  );
};

// Re-export utility functions
export { extractAccountFromSep10Transaction } from '../utils/sep10-stellar';

