import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { RedisService } from './redis.service';

export interface VerifiedToken {
  sub: string;
}

export interface Challenge {
  challenge: string;
  publicKey: string;
  createdAt: number;
}

const JWT_SECRET = process.env.JWT_SECRET || 'stellar-anchor-secret';
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.split(' ')[1];
  return token || null;
};

export const signToken = (publicKey: string): string => {
  // SEP-10 convention (and how our middleware uses it):
  // the user's public key is stored in the JWT `sub` claim.
  return jwt.sign({ sub: publicKey }, JWT_SECRET);
};

export const verifyToken = (token: string): VerifiedToken => {
  const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
  if (!decoded?.sub) throw new Error('Invalid token payload');
  return { sub: decoded.sub };
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
  return await redisService.getJSON<Challenge>(key);
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

