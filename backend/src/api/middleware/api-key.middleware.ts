import { Request, Response, NextFunction } from 'express';
import prisma from '../../lib/prisma';
import { redis } from '../../lib/redis';
import logger from '../../utils/logger';

// Extend Express Request interface to include apiKey and apiTier
declare global {
  namespace Express {
    interface Request {
      apiKey?: string;
      apiTier?: string;
      apiKeyScopes?: string[];
    }
  }
}

/**
 * Available API key scopes for granular permission control
 */
export const API_KEY_SCOPES = {
  READ_TRANSACTIONS: 'read:transactions',
  WRITE_TRANSACTIONS: 'write:transactions',
  READ_PAYMENTS: 'read:payments',
  WRITE_PAYMENTS: 'write:payments',
  READ_KYC: 'read:kyc',
  WRITE_KYC: 'write:kyc',
  READ_ANALYTICS: 'read:analytics',
  WEBHOOK_DELIVERY: 'webhook',
  ADMIN: 'admin',
} as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[keyof typeof API_KEY_SCOPES];

/**
 * Middleware to validate API keys and attach user tier to the request.
 */
export const apiKeyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.header('X-API-Key');

    if (!apiKey) {
      // Default to FREE tier if no API key is provided
      req.apiTier = 'FREE';
      return next();
    }

    // Check Redis cache first (includes tier and scopes as JSON)
    const cacheKey = `apikey:${apiKey}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        req.apiKey = apiKey;
        req.apiTier = parsed.tier;
        req.apiKeyScopes = parsed.scopes || [];
        return next();
      } catch {
        // Legacy cache format (just tier string), handle gracefully
        req.apiKey = apiKey;
        req.apiTier = cachedData;
        req.apiKeyScopes = [];
        return next();
      }
    }

    // Look up in database if not cached
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      select: { tier: true, scopes: true, isActive: true },
    });

    if (!keyRecord || !keyRecord.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive API Key' });
    }

    const scopes = keyRecord.scopes || [];

    // Cache the result in Redis with a 5-minute TTL
    await redis.setex(cacheKey, 300, JSON.stringify({ tier: keyRecord.tier, scopes }));

    req.apiKey = apiKey;
    req.apiTier = keyRecord.tier;
    req.apiKeyScopes = scopes;
    
    next();
  } catch (error) {
    logger.error('Error in apiKeyMiddleware:', error);
    // Fail closed or open? Rate limiting failing closed is safer, but returning 500
    res.status(500).json({ error: 'Internal Server Error validating API Key' });
  }
};

/**
 * Middleware factory to require specific API key scopes.
 * @param requiredScopes - One or more scopes required to access the endpoint
 */
export const requireScope = (...requiredScopes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // If no API key provided, use default FREE tier - apply scope restrictions
    const scopes = req.apiKeyScopes || [];
    
    const hasAllRequired = requiredScopes.every((scope) => scopes.includes(scope));
    
    if (!hasAllRequired) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: requiredScopes,
        current: scopes,
      });
    }
    
    next();
  };
};

/**
 * Invalidate API key cache (call on key revocation or scope update)
 */
export const invalidateApiKeyCache = async (apiKey: string): Promise<void> => {
  const cacheKey = `apikey:${apiKey}`;
  await redis.del(cacheKey);
  logger.info(`API key cache invalidated for key prefix: ${apiKey.slice(0, 8)}...`);
};
