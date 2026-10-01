import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

import { RedisService } from './redis.service';
import { redis } from '../lib/redis';
import { revokeToken as blacklistToken, isTokenRevoked } from './jwt-blacklist.service';

import { traceAsync, traceSync, SpanKind } from '../utils/tracing';
import configService from './config.service';
import {
  generateSep10Challenge,
  verifySep10Challenge,
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

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_REVOCATION_TTL_SECONDS = 3600; // fallback when token has no exp claim
const JWT_SECRET = configService.getConfig().JWT_SECRET;
const defaultRedisService = new RedisService(redis as any);

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.split(' ')[1];
  return token || null;
};

export const signToken = (publicKey: string, multiKeyData?: MultiKeyVerifiedToken): string => {
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
      return jwt.sign(payload, configService.getConfig().JWT_SECRET);
    },
    SpanKind.INTERNAL
  );
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

/**
 * Verifies a signed SEP-10 challenge transaction.
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
): Promise<{ isValid: boolean; account: string; totalWeight?: number; requiredWeight?: number }> => {
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

