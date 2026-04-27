import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { RedisService } from './redis.service';
import configService from './config.service';

export interface VerifiedToken {
  sub: string;
}

export interface Challenge {
  challenge: string;
  publicKey: string;
  createdAt: number;
  multiKey?: MultiKeyChallenge;
}

export interface MultiKeyChallenge {
  requiredSigners: number;
  threshold: 'low' | 'medium' | 'high';
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
  threshold?: 'low' | 'medium' | 'high';
}

export interface SignatureInfo {
  publicKey: string;
  signature: string;
  weight: number;
}

export interface MultiKeyVerifiedToken {
  sub: string;
  signers: string[];
  threshold: string;
  authLevel: 'partial' | 'medium' | 'full';
}

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.split(' ')[1];
  return token || null;
};

export const signToken = (publicKey: string, multiKeyData?: MultiKeyVerifiedToken): string => {
  // SEP-10 convention (and how our middleware uses it):
  // the user's public key is stored in the JWT `sub` claim.
  const payload = multiKeyData ? { 
    sub: publicKey, 
    signers: multiKeyData.signers, 
    threshold: multiKeyData.threshold, 
    authLevel: multiKeyData.authLevel 
  } : { sub: publicKey };
  return jwt.sign(payload, configService.getConfig().JWT_SECRET);
};

export const verifyToken = (token: string): VerifiedToken | MultiKeyVerifiedToken => {
  const decoded = jwt.verify(token, configService.getConfig().JWT_SECRET) as any;
  if (!decoded?.sub) throw new Error('Invalid token payload');
  
  // Return appropriate type based on presence of multi-key fields
  if (decoded.signers && decoded.threshold && decoded.authLevel) {
    return decoded as MultiKeyVerifiedToken;
  }
  return { sub: decoded.sub };
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
  threshold: 'low' | 'medium' | 'high' = 'medium'
): MultiKeyChallenge => {
  const totalWeight = signers.reduce((sum, signer) => sum + signer.weight, 0);
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
const getRequiredWeight = (threshold: 'low' | 'medium' | 'high'): number => {
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
  threshold: 'low' | 'medium' | 'high'
): { valid: boolean; authLevel: 'partial' | 'medium' | 'full'; signers: string[] } => {
  const requiredWeight = getRequiredWeight(threshold);
  const totalWeight = signatures.reduce((sum, sig) => sum + sig.weight, 0);
  
  let authLevel: 'partial' | 'medium' | 'full';
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
  const challengeData: Challenge = {
    challenge,
    publicKey,
    createdAt: Date.now()
  };
  
  const key = `sep10:challenge:${publicKey}`;
  await redisService.setJSON(key, challengeData, CHALLENGE_TTL_SECONDS);
};

/**
 * Retrieves and validates a challenge from Redis
 */
export const getChallenge = async (
  redisService: RedisService,
  publicKey: string
): Promise<Challenge | null> => {
  const key = `sep10:challenge:${publicKey}`;
  const result = await redisService.getJSON<Challenge>(key);
  return result;
};

/**
 * Removes a challenge from Redis after successful verification
 */
export const removeChallenge = async (
  redisService: RedisService,
  publicKey: string
): Promise<void> => {
  const key = `sep10:challenge:${publicKey}`;
  await redisService.del(key);
};

