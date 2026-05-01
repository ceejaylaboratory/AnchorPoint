import { Request, Response } from 'express';
import { RedisService } from '../../services/redis.service';
import { 
  generateChallenge, 
  generateMultiKeyChallenge,
  storeChallenge, 
  getChallenge as getChallengeFromRedis, 
  removeChallenge,
  signToken,
  validateMultiKeySignatures,
  SignerInfo,
  SignatureInfo,
  MultiKeyChallenge,
  MultiKeyVerifiedToken
import {
  generateSep10ChallengeTransaction,
  storeSep10Challenge,
  getChallenge as getChallengeFromRedis,
  removeChallenge,
  signToken,
  verifySep10ChallengeTransaction,
  extractAccountFromSep10Transaction
} from '../../services/auth.service';
import { config } from '../../config/env';
import { NetworkType } from '../../config/networks';

interface ChallengeRequest {
  account: string;
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
  const { account, signers, threshold, multiKey }: ChallengeRequest = req.body;

  if (!account) {
    return res.status(400).json({
      error: 'account parameter is required'
    });
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

    // In a real implementation, you would create a Stellar transaction
    // with the challenge as a manage_data operation
    const response: ChallengeResponse = {
      transaction: challenge, // Simplified - should be a base64 encoded transaction
      network_passphrase: config.STELLAR_NETWORK_PASSPHRASE
      network_passphrase: process.env?.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
      multiKeyChallenge
    // Use configured anchor key or generate a default one for demo
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
      transaction: sep10Challenge.transactionXdr,
      network_passphrase: sep10Challenge.networkPassphrase
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
    const mockAccount = 'GBAD_PUBLIC_KEY'; // In real implementation, extract from transaction
    const storedChallenge = await getChallengeFromRedis(redisService, mockAccount);

    if (!storedChallenge || storedChallenge.challenge !== transaction) {
    const networkType = config.STELLAR_NETWORK === 'public' ? NetworkType.PUBLIC : NetworkType.TESTNET;

    // Extract the account from the signed transaction
    const account = extractAccountFromSep10Transaction(transaction, networkType);

    if (!account) {
      return res.status(400).json({
        error: 'Invalid transaction format'
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
};