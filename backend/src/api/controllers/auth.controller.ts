import { Request, Response } from 'express';
import { RedisService } from '../../services/redis.service';
import {
  generateChallenge,
  generateMultiKeyChallenge,
  storeChallenge,
  getChallenge as getChallengeFromRedis,
  removeChallenge,
  signToken,
  verifyToken,
  validateMultiKeySignatures,
  SignerInfo,
  SignatureInfo,
  MultiKeyChallenge,
  MultiKeyVerifiedToken,
  generateSep10ChallengeTransaction,
  storeSep10Challenge,
  verifySep10ChallengeTransaction
} from '../../services/auth.service';
import {
  extractAccountFromSep10Transaction
} from '../../utils/sep10-stellar';
import { config } from '../../config/env';
import { NetworkType } from '../../config/networks';
import logger from '../../utils/logger';

// RFC 1123 compliant hostname: no consecutive dots/hyphens, labels must start/end with alphanumeric
const CLIENT_DOMAIN_REGEX = /^(?!-)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.(?!-)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.(?!-)(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9]+)(?:-[a-zA-Z0-9]+)*$/;

function validateClientDomain(domain: string): boolean {
  const trimmed = domain.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^javascript:/i.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  return CLIENT_DOMAIN_REGEX.test(trimmed);
}

interface ChallengeRequest {
  account: string;
  client_domain?: string;
  signers?: SignerInfo[];
  threshold?: 'low' | 'medium' | 'high';
  multiKey?: boolean;
}

interface ChallengeResponse {
  transaction: string;
  network_passphrase: string;
  multiKeyChallenge?: MultiKeyChallenge;
}

interface TokenRequest {
  transaction: string;
  signatures?: SignatureInfo[];
  threshold?: 'low' | 'medium' | 'high';
}

interface TokenResponse {
  token: string;
  type: 'bearer';
  expires_in: number;
  authLevel?: 'partial' | 'medium' | 'full';
  signers?: string[];
}

/**
 * POST /auth
 * SEP-10 Challenge Endpoint
 * Generates and stores a challenge for the given account
 */
export const getChallenge = async (
  req: Request,
  res: Response,
  redisService: RedisService
): Promise<Response> => {
  const { account, client_domain, signers, threshold, multiKey }: ChallengeRequest = req.body;

  if (!account) {
    return res.status(400).json({
      error: 'account parameter is required'
    });
  }

  if (client_domain !== undefined) {
    if (!validateClientDomain(client_domain)) {
      return res.status(400).json({
        error: 'invalid_client_domain',
        message: 'client_domain must be a valid hostname without scheme'
      });
    }
  }

  try {
    // Generate a new challenge
    const challenge = generateChallenge();

    // Handle multi-key authentication
    let multiKeyChallenge: MultiKeyChallenge | undefined;
    if (multiKey && signers && signers.length > 0) {
      multiKeyChallenge = generateMultiKeyChallenge(signers, threshold || 'medium');
    }

    // Store the challenge in Redis with TTL
    await storeChallenge(redisService, account, challenge);

    const anchorPublicKey = config.ANCHOR_PUBLIC_KEY || 'GBAD_PUBLIC_KEY'; // Default for demo
    const networkType = config.STELLAR_NETWORK === 'public' ? NetworkType.PUBLIC : NetworkType.TESTNET;

    // Generate a SEP-10 challenge transaction
    const sep10Challenge = generateSep10ChallengeTransaction(
      anchorPublicKey,
      account,
      networkType
    );

    // Store the challenge in Redis
    await storeSep10Challenge(redisService, account, sep10Challenge);

    const response: ChallengeResponse = {
      transaction: sep10Challenge.transactionXdr || sep10Challenge.challenge,
      network_passphrase: sep10Challenge.networkPassphrase || config.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
      multiKeyChallenge
    };

    return res.json(response);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to generate challenge'
    });
  }
};

/**
 * POST /auth/token
 * SEP-10 Token Endpoint
 * Verifies the signed challenge and returns a JWT token
 */
export const getToken = async (
  req: Request,
  res: Response,
  redisService: RedisService
): Promise<Response> => {
  const { transaction, signatures, threshold }: TokenRequest = req.body;

  if (!transaction) {
    return res.status(400).json({
      error: 'transaction parameter is required'
    });
  }

  try {
    // Handle multi-key authentication
    if (signatures && signatures.length > 0) {
      const validation = validateMultiKeySignatures(signatures, threshold || 'medium');

      if (!validation.valid) {
        return res.status(400).json({
          error: 'Insufficient signature weight for required threshold'
        });
      }

      // For multi-key, extract the primary account from first signature
      const mockAccount = signatures[0].publicKey;
      const storedChallenge = await getChallengeFromRedis(redisService, mockAccount);

      if (!storedChallenge || storedChallenge.challenge !== transaction) {
        return res.status(400).json({
          error: 'Invalid or expired challenge'
        });
      }

      // Remove the challenge to prevent replay attacks
      await removeChallenge(redisService, mockAccount);

      // Create multi-key verified token data
      const multiKeyData: MultiKeyVerifiedToken = {
        sub: mockAccount,
        signers: validation.signers,
        threshold: threshold || 'medium',
        authLevel: validation.authLevel
      };

      // Generate JWT token with multi-key data
      const token = signToken(mockAccount, multiKeyData);

      const response: TokenResponse = {
        token,
        type: 'bearer',
        expires_in: 3600, // 1 hour
        authLevel: validation.authLevel,
        signers: validation.signers
      };

      return res.json(response);
    }

    // Single-key authentication (existing logic)
    const networkType = config.STELLAR_NETWORK === 'public' ? NetworkType.PUBLIC : NetworkType.TESTNET;

    // Extract the account from the signed transaction
    const account = extractAccountFromSep10Transaction(transaction, networkType);

    if (!account) {
      return res.status(400).json({
        error: 'Invalid transaction format'
      });
    }

    // Hardware wallet specific validation
    try {
      const isHardwareWallet = await validateHardwareWalletSignature(transaction);
      if (isHardwareWallet) {
        logger.info('Hardware wallet signature detected', { account, hardwareWallet: true });
      }
    } catch (error) {
      logger.warn('Hardware wallet validation failed', {
        account,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Get the stored challenge
    const storedChallenge = await getChallengeFromRedis(redisService, account);

    if (!storedChallenge) {
      return res.status(400).json({
        error: 'Challenge not found or expired'
      });
    }

    // Verify the signed transaction
    const verification = verifySep10ChallengeTransaction(
      transaction,
      storedChallenge,
      networkType
    );

    if (!verification.isValid) {
      return res.status(400).json({
        error: 'Invalid signature or challenge'
      });
    }

    // Remove the challenge to prevent replay attacks
    await removeChallenge(redisService, account);

    // Generate JWT token
    const token = signToken(account);

    const response: TokenResponse = {
      token,
      type: 'bearer',
      expires_in: 3600 // 1 hour
    };

    return res.json(response);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to verify challenge'
    });
  }
}

/**
 * POST /auth/refresh
 * SEP-10 Token Refresh Endpoint
 * Refreshes an existing valid JWT token
 */
export const refreshToken = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);

    let multiKeyData: MultiKeyVerifiedToken | undefined;
    if ('signers' in decoded) {
      multiKeyData = decoded as MultiKeyVerifiedToken;
    }

    // Issue a new token
    const newToken = signToken(decoded.sub, multiKeyData);

    const response: TokenResponse = {
      token: newToken,
      type: 'bearer',
      expires_in: 3600,
      authLevel: multiKeyData?.authLevel,
      signers: multiKeyData?.signers
    };

    return res.json(response);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Validate hardware wallet signature
 * @param transaction Signed transaction XDR
 * @returns Promise<boolean> Whether this is a hardware wallet signature
 */
async function validateHardwareWalletSignature(
  transaction: string,
): Promise<boolean> {
  try {
    const transactionObj = JSON.parse(transaction);

    if (transactionObj && typeof transactionObj === 'object') {
      const hasHardwareIndicators = (
        transactionObj.hardwareWallet ||
        transactionObj.trezor ||
        transactionObj.ledger ||
        transactionObj.signerType === 'hardware'
      );

      return hasHardwareIndicators;
    }

    return false;
  } catch (error) {
    try {
      if (transaction.length > 100 && transaction.length < 2000) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
