import { Request, Response } from 'express';
import { RedisService } from '../../services/redis.service';
import { 
  generateChallenge, 
  storeChallenge, 
  getChallenge as getChallengeFromRedis, 
  removeChallenge,
  signToken 
} from '../../services/auth.service';
import { config } from '../../config/env';

interface ChallengeRequest {
  account: string;
}

interface ChallengeResponse {
  transaction: string;
  network_passphrase: string;
}

interface TokenRequest {
  transaction: string;
}

interface TokenResponse {
  token: string;
  type: 'bearer';
  expires_in: number;
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
  const { account }: ChallengeRequest = req.body;

  if (!account) {
    return res.status(400).json({
      error: 'account parameter is required'
    });
  }

  try {
    // Generate a new challenge
    const challenge = generateChallenge();
    
    // Store the challenge in Redis with TTL
    await storeChallenge(redisService, account, challenge);

    // In a real implementation, you would create a Stellar transaction
    // with the challenge as a manage_data operation
    const response: ChallengeResponse = {
      transaction: challenge, // Simplified - should be a base64 encoded transaction
      network_passphrase: config.STELLAR_NETWORK_PASSPHRASE
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
  const { transaction }: TokenRequest = req.body;

  if (!transaction) {
    return res.status(400).json({
      error: 'transaction parameter is required'
    });
  }

  try {
    // In a real implementation, you would:
    // 1. Parse the signed transaction
    // 2. Verify the signature
    // 3. Extract the account and challenge from the transaction
    // 4. Verify the challenge matches what's stored in Redis
    
    // For this example, we'll use the transaction as the challenge
    // and assume a fixed account for demonstration
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