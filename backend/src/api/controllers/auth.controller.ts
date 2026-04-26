import { Request, Response } from 'express';
import { RedisService } from '../../services/redis.service';
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
  const { transaction }: TokenRequest = req.body;

  if (!transaction) {
    return res.status(400).json({
      error: 'transaction parameter is required'
    });
  }

  try {
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