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
import { 
  generateSep10ChallengeTransaction,
  storeSep10Challenge,
  verifySep10ChallengeTransaction,
  extractAccountFromSep10Transaction
} from '../../utils/sep10-stellar';
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
      network_passphrase: config.STELLAR_NETWORK_PASSPHRASE,
      multiKeyChallenge
    };

    return res.json(response);

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

    // Hardware wallet specific validation
    try {
      // Check if this is a hardware wallet transaction (Trezor/Ledger)
      // Hardware wallets typically use different signing patterns
      const isHardwareWallet = await validateHardwareWalletSignature(transaction, networkType);
      if (isHardwareWallet) {
        logger.info('Hardware wallet signature detected', { account, hardwareWallet: true });
      }
    } catch (error) {
      logger.warn('Hardware wallet validation failed', { 
        account, 
        error: error instanceof Error ? error.message : String(error) 
      });
      // Continue with normal validation even if hardware wallet validation fails
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
 * Validate hardware wallet signature
 * @param transaction Signed transaction XDR
 * @param networkType Stellar network type
 * @returns Promise<boolean> Whether this is a hardware wallet signature
 */
async function validateHardwareWalletSignature(
  transaction: string,
  networkType: NetworkType
): Promise<boolean> {
  try {
    // Hardware wallets typically use different signing patterns
    // Check for common hardware wallet signatures
    const transactionObj = JSON.parse(transaction);
    
    // For Trezor/Ledger, check if the transaction has specific hardware wallet indicators
    // This is a simplified check - real implementation would be more sophisticated
    if (transactionObj && typeof transactionObj === 'object') {
      // Look for hardware wallet specific fields
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
    // If parsing fails, it might be a valid XDR string
    // Try to parse as XDR instead
    try {
      // In real implementation, we'd use Stellar SDK to parse XDR
      // For now, just check if it looks like XDR
      if (transaction.length > 100 && transaction.length < 2000) {
        return true; // Assume hardware wallet for longer transactions
      }
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Validate hardware wallet signature
 * @param transaction Signed transaction XDR
 * @param networkType Stellar network type
 * @returns Promise<boolean> Whether this is a hardware wallet signature
 */
async function validateHardwareWalletSignature(
  transaction: string,
  networkType: NetworkType
): Promise<boolean> {
  try {
    // Hardware wallets typically use different signing patterns
    // Check for common hardware wallet signatures
    const transactionObj = JSON.parse(transaction);
    
    // For Trezor/Ledger, check if the transaction has specific hardware wallet indicators
    // This is a simplified check - real implementation would be more sophisticated
    if (transactionObj && typeof transactionObj === 'object') {
      // Look for hardware wallet specific fields
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
    // If parsing fails, it might be a valid XDR string
    // Try to parse as XDR instead
    try {
      // In real implementation, we'd use Stellar SDK to parse XDR
      // For now, just check if it looks like XDR
      if (transaction.length > 100 && transaction.length < 2000) {
        return true; // Assume hardware wallet for longer transactions
      }
      return false;
    } catch {
      return false;
    }
  }
};