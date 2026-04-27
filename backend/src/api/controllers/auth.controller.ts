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
} from '../../services/auth.service';

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
      network_passphrase: process.env?.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
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
    const mockAccount = 'GBAD_PUBLIC_KEY'; // In real implementation, extract from transaction
    const storedChallenge = await getChallengeFromRedis(redisService, mockAccount);

    if (!storedChallenge || storedChallenge.challenge !== transaction) {
      return res.status(400).json({
        error: 'Invalid or expired challenge'
      });
    }

    // Remove the challenge to prevent replay attacks
    await removeChallenge(redisService, mockAccount);

    // Generate JWT token
    const token = signToken(mockAccount);

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