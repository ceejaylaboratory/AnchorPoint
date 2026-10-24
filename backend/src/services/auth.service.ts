import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';

import { RedisService } from './redis.service';
import { redis } from '../lib/redis';
import { revokeToken as blacklistToken, isTokenRevoked } from './jwt-blacklist.service';
import logger from '../utils/logger';

import { traceAsync, traceSync, SpanKind } from '../utils/tracing';
import configService from './config.service';
import {
  generateSep10Challenge,
  verifySep10Challenge,
  type Sep10Challenge
} from '../utils/sep10-stellar';
import { NETWORKS, NetworkType } from '../config/networks';

export interface VerifiedToken {
  sub: string;
}

export interface Challenge {
  challenge: string;
  publicKey: string;
  createdAt: number;
  transactionXdr?: string;
  multiKey?: MultiKeyChallenge;
}

export type AuthThreshold = 'low' | 'medium' | 'high';

export interface MultiKeyChallenge {
  requiredSigners: number;
  threshold: AuthThreshold;
  signers: SignerInfo[];
}

export interface SignerInfo {
  publicKey: string;
  weight: number;
  signed: boolean;
}

export interface MultiKeyTokenRequest {
  transaction: string;
  signatures: SignatureInfo[];
  threshold?: AuthThreshold;
}

export interface SignatureInfo {
  publicKey: string;
  signature: string;
  weight: number;
}

export type AuthLevel = 'partial' | 'medium' | 'full';

export interface MultiKeyVerifiedToken {
  sub: string;
  signers: string[];
  threshold: string;
  authLevel: AuthLevel;
  transactionXdr?: string; // For hardware wallet support
}

export interface RefreshTokenRecord {
  familyId: string;
  publicKey: string;
  multiKeyData?: MultiKeyVerifiedToken;
  status: 'active' | 'rotated';
  createdAt: number;
  expiresAt: number;
}

export interface SessionFamilyRecord {
  familyId: string;
  publicKey: string;
  tokenHashes: string[];
  revoked: boolean;
  createdAt: number;
  revokedAt?: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  familyId: string;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes (900 seconds)
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (604800 seconds)

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_REVOCATION_TTL_SECONDS = 3600; // fallback when token has no exp claim
const REFRESH_TOKEN_PREFIX = 'auth:refresh:';
const REFRESH_FAMILY_PREFIX = 'auth:refresh_family:';
const defaultRedisService = new RedisService(redis as any);

export class RefreshTokenReuseError extends Error {
  public readonly familyId: string;
  public readonly publicKey: string;

  constructor(familyId: string, publicKey: string, message = 'Refresh token reuse detected; session family invalidated') {
    super(message);
    this.name = 'RefreshTokenReuseError';
    this.familyId = familyId;
    this.publicKey = publicKey;
  }
}

export const hashRefreshToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.split(' ')[1];
  return token || null;
};

export const signToken = (
  publicKey: string,
  multiKeyData?: MultiKeyVerifiedToken,
  expiresInSeconds?: number
): string => {
  return traceSync(
    'auth.sign_token',
    (span) => {
      span.setAttribute('auth.public_key', publicKey);
      // SEP-10 convention (and how our middleware uses it):
      // the user's public key is stored in the JWT `sub` claim.
      const payload = multiKeyData ? { 
        sub: publicKey, 
        signers: multiKeyData.signers, 
        threshold: multiKeyData.threshold, 
        authLevel: multiKeyData.authLevel 
      } : { sub: publicKey };
      const secret = configService.getConfig().JWT_SECRET;
      if (typeof expiresInSeconds === 'number') {
        return jwt.sign(payload, secret, { expiresIn: expiresInSeconds });
      }
      return jwt.sign(payload, secret);
    },
    SpanKind.INTERNAL
  );
};

export const signAccessToken = (
  publicKey: string,
  multiKeyData?: MultiKeyVerifiedToken
): string => {
  return signToken(publicKey, multiKeyData, ACCESS_TOKEN_TTL_SECONDS);
};

export const verifyToken = async (
  token: string,
  redisService: RedisService = defaultRedisService
): Promise<VerifiedToken | MultiKeyVerifiedToken> => {
  return traceAsync(
    'auth.verify_token',
    async (span) => {
      span.setAttribute('auth.token_length', token.length);

      if (await isTokenRevoked(redisService, token)) {
        throw new Error('Token has been revoked');
      }

      const decoded = jwt.verify(token, configService.getConfig().JWT_SECRET) as any;
      if (!decoded?.sub) throw new Error('Invalid token payload');
      span.setAttribute('auth.subject', decoded.sub);

      // Return appropriate type based on presence of multi-key fields
      if (decoded.signers && decoded.threshold && decoded.authLevel) {
        return decoded as MultiKeyVerifiedToken;
      }
      return { sub: decoded.sub };
    },
    SpanKind.INTERNAL
  );
};

export const generateRefreshTokenValue = (): string => {
  return randomBytes(32).toString('hex');
};

/**
 * Invalidates an entire refresh token session family in Redis.
 */
export const invalidateSessionFamily = async (
  redisService: RedisService,
  familyId: string
): Promise<void> => {
  return traceAsync(
    'auth.invalidate_session_family',
    async (span) => {
      span.setAttribute('auth.family_id', familyId);
      const familyKey = `${REFRESH_FAMILY_PREFIX}${familyId}`;
      const family = await redisService.getJSON<SessionFamilyRecord>(familyKey);

      if (family && Array.isArray(family.tokenHashes)) {
        for (const tokenHash of family.tokenHashes) {
          await redisService.del(`${REFRESH_TOKEN_PREFIX}${tokenHash}`);
        }
        await redisService.setJSON<SessionFamilyRecord>(
          familyKey,
          {
            ...family,
            tokenHashes: [],
            revoked: true,
            revokedAt: Date.now(),
          },
          REFRESH_TOKEN_TTL_SECONDS
        );
      } else {
        await redisService.del(familyKey);
      }
    },
    SpanKind.CLIENT
  );
};

/**
 * Issues a new access_token (15 min TTL) and refresh_token (7 day TTL) pair,
 * storing the hashed refresh token and session family metadata in Redis.
 */
export const issueTokenPair = async (
  publicKey: string,
  redisService: RedisService = defaultRedisService,
  multiKeyData?: MultiKeyVerifiedToken,
  existingFamilyId?: string
): Promise<TokenPair> => {
  return traceAsync(
    'auth.issue_token_pair',
    async (span) => {
      span.setAttribute('auth.public_key', publicKey);

      const familyId =
        existingFamilyId ||
        (typeof randomUUID === 'function' ? randomUUID() : randomBytes(16).toString('hex'));
      span.setAttribute('auth.family_id', familyId);

      const accessToken = signAccessToken(publicKey, multiKeyData);
      const refreshToken = generateRefreshTokenValue();
      const tokenHash = hashRefreshToken(refreshToken);
      const now = Date.now();

      const tokenRecord: RefreshTokenRecord = {
        familyId,
        publicKey,
        multiKeyData,
        status: 'active',
        createdAt: now,
        expiresAt: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      };

      const tokenKey = `${REFRESH_TOKEN_PREFIX}${tokenHash}`;
      await redisService.setJSON(tokenKey, tokenRecord, REFRESH_TOKEN_TTL_SECONDS);

      const familyKey = `${REFRESH_FAMILY_PREFIX}${familyId}`;
      const existingFamily = existingFamilyId
        ? await redisService.getJSON<SessionFamilyRecord>(familyKey)
        : null;

      const familyRecord: SessionFamilyRecord = {
        familyId,
        publicKey,
        tokenHashes: existingFamily
          ? [...existingFamily.tokenHashes, tokenHash]
          : [tokenHash],
        revoked: false,
        createdAt: existingFamily ? existingFamily.createdAt : now,
      };

      await redisService.setJSON(familyKey, familyRecord, REFRESH_TOKEN_TTL_SECONDS);

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
        familyId,
      };
    },
    SpanKind.CLIENT
  );
};

/**
 * Rotates a refresh token:
 * - Validates the refresh token hash in Redis.
 * - Marks the old token as 'rotated' (invalidated).
 * - If a rotated token is reused, logs a security alert and invalidates the entire session family.
 * - Issues and returns a new access/refresh token pair in the same session family.
 */
export const rotateRefreshToken = async (
  refreshToken: string,
  redisService: RedisService = defaultRedisService
): Promise<TokenPair & { multiKeyData?: MultiKeyVerifiedToken; publicKey: string }> => {
  return traceAsync(
    'auth.rotate_refresh_token',
    async (span) => {
      if (!refreshToken || typeof refreshToken !== 'string') {
        throw new Error('Invalid or expired refresh token');
      }

      const tokenHash = hashRefreshToken(refreshToken);
      const tokenKey = `${REFRESH_TOKEN_PREFIX}${tokenHash}`;
      const record = await redisService.getJSON<RefreshTokenRecord>(tokenKey);

      if (!record) {
        span.setAttribute('auth.refresh_valid', false);
        throw new Error('Invalid or expired refresh token');
      }

      span.setAttribute('auth.family_id', record.familyId);
      span.setAttribute('auth.public_key', record.publicKey);

      const familyKey = `${REFRESH_FAMILY_PREFIX}${record.familyId}`;
      const family = await redisService.getJSON<SessionFamilyRecord>(familyKey);

      if (family?.revoked) {
        span.setAttribute('auth.family_revoked', true);
        throw new Error('Session family has been invalidated');
      }

      // Reuse detection: token was already rotated
      if (record.status === 'rotated') {
        span.setAttribute('auth.refresh_reuse_detected', true);
        logger.error('SECURITY ALERT: Refresh token reuse detected. Invalidating session family.', {
          alertType: 'REFRESH_TOKEN_REUSE',
          severity: 'critical',
          familyId: record.familyId,
          publicKey: record.publicKey,
        });

        await invalidateSessionFamily(redisService, record.familyId);
        throw new RefreshTokenReuseError(record.familyId, record.publicKey);
      }

      if (record.expiresAt && Date.now() > record.expiresAt) {
        await redisService.del(tokenKey);
        throw new Error('Refresh token has expired');
      }

      // Mark old token as rotated (keep in Redis for remaining TTL to detect reuse)
      const remainingTtl = record.expiresAt
        ? Math.max(Math.floor((record.expiresAt - Date.now()) / 1000), 1)
        : REFRESH_TOKEN_TTL_SECONDS;

      await redisService.setJSON<RefreshTokenRecord>(
        tokenKey,
        {
          ...record,
          status: 'rotated',
        },
        remainingTtl
      );

      // Issue new pair within the same session family
      const newPair = await issueTokenPair(
        record.publicKey,
        redisService,
        record.multiKeyData,
        record.familyId
      );

      return {
        ...newPair,
        publicKey: record.publicKey,
        multiKeyData: record.multiKeyData,
      };
    },
    SpanKind.CLIENT
  );
};

/**
 * Revokes a JWT so it can no longer be used for authentication.
 * Stores the token in the Redis blacklist for its remaining lifetime.
 */
export const revokeToken = async (
  token: string,
  redisService: RedisService = defaultRedisService
): Promise<void> => {
  return traceAsync(
    'auth.revoke_token',
    async (span) => {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const ttlSeconds = decoded?.exp
        ? Math.max(decoded.exp - Math.floor(Date.now() / 1000), 1)
        : DEFAULT_REVOCATION_TTL_SECONDS;
      span.setAttribute('auth.ttl_seconds', ttlSeconds);
      await blacklistToken(redisService, token, ttlSeconds);
    },
    SpanKind.CLIENT
  );
};

/**
 * Generates a random challenge for SEP-10 authentication
 */
export const generateChallenge = (): string => {
  return randomBytes(32).toString('base64');
};

/**
 * Generates a multi-key challenge with signer requirements
 */
export const generateMultiKeyChallenge = (
  signers: SignerInfo[],
  threshold: AuthThreshold = 'medium'
): MultiKeyChallenge => {

  const requiredWeight = getRequiredWeight(threshold);
  
  return {
    requiredSigners: Math.ceil(requiredWeight / Math.max(...signers.map(s => s.weight))),
    threshold,
    signers: signers.map(s => ({ ...s, signed: false }))
  };
};

/**
 * Gets the required weight for a given threshold level
 */
const getRequiredWeight = (threshold: AuthThreshold): number => {
  switch (threshold) {
    case 'low': return 1;
    case 'medium': return 2;
    case 'high': return 3;
    default: return 2;
  }
};

/**
 * Validates multi-key signature weights against threshold
 */
export const validateMultiKeySignatures = (
  signatures: SignatureInfo[],
  threshold: AuthThreshold
): { valid: boolean; authLevel: AuthLevel; signers: string[] } => {
  const requiredWeight = getRequiredWeight(threshold);
  const totalWeight = signatures.reduce((sum, sig) => sum + sig.weight, 0);
  
  let authLevel: AuthLevel;
  if (totalWeight >= getRequiredWeight('high')) {
    authLevel = 'full';
  } else if (totalWeight >= getRequiredWeight('medium')) {
    authLevel = 'medium';
  } else if (totalWeight >= getRequiredWeight('low')) {
    authLevel = 'partial';
  } else {
    authLevel = 'partial';
  }
  
  return {
    valid: totalWeight >= requiredWeight,
    authLevel,
    signers: signatures.map(s => s.publicKey)
  };
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
        createdAt: Date.now(),
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

export const removeChallenge = async (
  redisService: RedisService,
  publicKey: string
): Promise<void> => {
  const key = `sep10:challenge:${publicKey}`;
  await redisService.del(key);
};

/**
 * Generates a SEP-10 challenge transaction for hardware wallet support.
 * When client_domain is provided it is embedded as a second manage_data
 * operation keyed `<anchorName> client_domain` per the SEP-10 spec so
 * downstream validators can verify domain ownership.
 *
 * @param anchorPublicKey The anchor's public key
 * @param clientPublicKey The client's public key
 * @param networkType The Stellar network type
 * @param clientDomain Optional validated hostname of the requesting wallet app
 * @returns SEP-10 challenge with transaction XDR
 */
export const generateSep10ChallengeTransaction = (
  anchorPublicKey: string,
  clientPublicKey: string,
  networkType: NetworkType = NetworkType.TESTNET,
  clientDomain?: string
): Sep10Challenge => {
  return traceSync(
    'auth.generate_sep10_challenge',
    (span) => {
      span.setAttribute('auth.anchor_public_key', anchorPublicKey);
      span.setAttribute('auth.client_public_key', clientPublicKey);
      span.setAttribute('auth.network_type', networkType);
      if (clientDomain) {
        span.setAttribute('auth.client_domain', clientDomain);
      }

      const challengeValue = generateChallenge();
      const sep10Challenge = generateSep10Challenge(
        anchorPublicKey,
        clientPublicKey,
        networkType,
        challengeValue,
        clientDomain
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

/** Error code returned when a signed challenge is past its `timeBounds.maxTime`. */
export const SEP10_CHALLENGE_EXPIRED = 'challenge_expired' as const;

export interface Sep10VerificationResult {
  isValid: boolean;
  account: string;
  error?: typeof SEP10_CHALLENGE_EXPIRED;
}

/**
 * Returns true when the challenge transaction's `timeBounds.maxTime` is not
 * strictly in the future. A challenge without a finite upper bound (absent
 * time bounds, or `maxTime` of 0 which Stellar treats as "no limit") cannot
 * be proven fresh and is treated as expired, as is unparseable XDR.
 */
export const isSep10ChallengeExpired = (
  signedTransactionXdr: string,
  networkType: NetworkType = NetworkType.TESTNET,
  nowMs: number = Date.now()
): boolean => {
  try {
    const tx = TransactionBuilder.fromXDR(
      signedTransactionXdr,
      NETWORKS[networkType].passphrase
    ) as Transaction;
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
    return !(maxTime > 0 && maxTime > nowMs / 1000);
  } catch {
    return true;
  }
};

/**
 * Verifies a signed SEP-10 challenge transaction.
 *
 * After the signature and challenge value check, the transaction's
 * `timeBounds.maxTime` must still be in the future; otherwise the result is
 * invalid with `error: 'challenge_expired'` so expired challenges cannot be
 * replayed for a JWT.
 *
 * For accounts with multiple signers the function fetches the account's live
 * threshold data from Stellar Horizon and validates that the combined weight of
 * the signatures present on the challenge transaction meets the requested
 * threshold level (defaults to 'med' / medium_threshold).
 *
 * @param signedTransactionXdr The signed transaction XDR
 * @param storedChallenge The stored challenge data
 * @param networkType The Stellar network type
 * @param thresholdLevel Which Stellar threshold to require (defaults to 'med')
 * @returns Verification result with account
 */
export const verifySep10ChallengeTransaction = (
  signedTransactionXdr: string,
  storedChallenge: Challenge,
  networkType: NetworkType = NetworkType.TESTNET,
  thresholdLevel: 'low' | 'med' | 'high' = 'med'
): Sep10VerificationResult => {
  return traceSync(
    'auth.verify_sep10_challenge',
    (span) => {
      span.setAttribute('auth.expected_challenge_length', storedChallenge.challenge.length);

      const verification = verifySep10Challenge(
        signedTransactionXdr,
        storedChallenge.challenge,
        networkType
      );

      if (verification.isValid && isSep10ChallengeExpired(signedTransactionXdr, networkType)) {
        span.setAttribute('auth.verification_valid', false);
        span.setAttribute('auth.challenge_expired', true);
        return {
          isValid: false,
          account: verification.account,
          error: SEP10_CHALLENGE_EXPIRED
        };
      }

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

/**
 * Verifies a signed SEP-10 challenge transaction against the on-chain
 * multi-signature thresholds for the given Stellar account.
 *
 * Steps:
 *  1. Load account from Horizon to get thresholds and signer weights.
 *  2. Parse the signed transaction and collect its signatures.
 *  3. For each on-chain signer whose signature appears in the transaction,
 *     accumulate that signer's weight.
 *  4. Compare accumulated weight against the requested threshold level.
 *
 * @param signedTransactionXdr The signed transaction XDR
 * @param storedChallenge The stored challenge data
 * @param networkType The Stellar network type
 * @param thresholdLevel Which Stellar threshold to require (defaults to 'med')
 * @param horizonUrl Optional override for the Horizon RPC URL
 * @returns Promise resolving to verification result
 */
export const verifySep10ChallengeTransactionMultiSig = async (
  signedTransactionXdr: string,
  storedChallenge: Challenge,
  networkType: NetworkType = NetworkType.TESTNET,
  thresholdLevel: 'low' | 'med' | 'high' = 'med',
  horizonUrl?: string
): Promise<Sep10VerificationResult & { totalWeight?: number; requiredWeight?: number }> => {
  return traceAsync(
    'auth.verify_sep10_challenge_multisig',
    async (span) => {
      span.setAttribute('auth.threshold_level', thresholdLevel);
      span.setAttribute('auth.network_type', networkType);

      // First run the basic signature / challenge-value check
      const basicVerification = verifySep10Challenge(
        signedTransactionXdr,
        storedChallenge.challenge,
        networkType
      );

      if (!basicVerification.isValid || !basicVerification.account) {
        span.setAttribute('auth.multisig_basic_check', false);
        return { isValid: false, account: basicVerification.account };
      }

      const account = basicVerification.account;

      if (isSep10ChallengeExpired(signedTransactionXdr, networkType)) {
        span.setAttribute('auth.challenge_expired', true);
        return { isValid: false, account, error: SEP10_CHALLENGE_EXPIRED };
      }

      span.setAttribute('auth.verified_account', account);

      try {
        // ── 1. Fetch account details from Horizon ──────────────────────────
        const { NETWORKS } = await import('../config/networks');
        const networkConfig = NETWORKS[networkType];
        const baseHorizonUrl = horizonUrl ?? networkConfig.horizonUrl;

        const accountResponse = await fetch(
          `${baseHorizonUrl}/accounts/${encodeURIComponent(account)}`
        );

        if (!accountResponse.ok) {
          // Account not found on Horizon – fall back to single-sig acceptance
          span.setAttribute('auth.horizon_fetch_ok', false);
          return { isValid: true, account };
        }

        const accountData = await accountResponse.json() as {
          thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
          signers: Array<{ key: string; weight: number; type: string }>;
        };

        const { thresholds, signers } = accountData;

        const requiredWeight =
          thresholdLevel === 'low'
            ? thresholds.low_threshold
            : thresholdLevel === 'high'
              ? thresholds.high_threshold
              : thresholds.med_threshold;

        span.setAttribute('auth.required_weight', requiredWeight);
        span.setAttribute('auth.signers_count', signers.length);

        // If all thresholds are 0 (single-sig account), skip weight check
        if (requiredWeight === 0) {
          return { isValid: true, account, totalWeight: 1, requiredWeight: 0 };
        }

        // ── 2. Parse the transaction to get the actual signatures ──────────
        const { NETWORKS: nets } = await import('../config/networks');
        const passphrase = nets[networkType].passphrase;
        const { TransactionBuilder, Keypair } = await import('@stellar/stellar-sdk');

        const tx = TransactionBuilder.fromXDR(signedTransactionXdr, passphrase) as import('@stellar/stellar-sdk').Transaction;
        const txHash = tx.hash();

        // ── 3. Accumulate weight from valid signers ────────────────────────
        let totalWeight = 0;
        for (const signer of signers) {
          if (signer.weight <= 0) continue;
          try {
            const keypair = Keypair.fromPublicKey(signer.key);
            const signerSigned = tx.signatures.some((sig) => {
              try {
                return keypair.verify(txHash, sig.signature());
              } catch {
                return false;
              }
            });
            if (signerSigned) {
              totalWeight += signer.weight;
            }
          } catch {
            // Not a valid Ed25519 key – skip
          }
        }

        span.setAttribute('auth.total_weight', totalWeight);
        const isValid = totalWeight >= requiredWeight;
        span.setAttribute('auth.multisig_threshold_met', isValid);

        return { isValid, account, totalWeight, requiredWeight };
      } catch (horizonError) {
        // Horizon unreachable – degrade gracefully to basic signature check
        span.setAttribute('auth.horizon_error', String(horizonError));
        return { isValid: true, account };
      }
    },
    SpanKind.INTERNAL
  );
};

// Re-export utility functions
export { extractAccountFromSep10Transaction } from '../utils/sep10-stellar';

