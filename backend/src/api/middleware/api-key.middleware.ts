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
    }
  }
}

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

    // Check Redis cache first
    const cacheKey = `apikey:${apiKey}`;
    const cachedTier = await redis.get(cacheKey);

    if (cachedTier) {
      req.apiKey = apiKey;
      req.apiTier = cachedTier;
      return next();
    }

    // Look up in database if not cached
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      select: { tier: true },
    });

    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    // Cache the result in Redis with a 5-minute TTL
    await redis.setex(cacheKey, 300, keyRecord.tier);

    req.apiKey = apiKey;
    req.apiTier = keyRecord.tier;
    
    next();
  } catch (error) {
    logger.error('Error in apiKeyMiddleware:', error);
    // Fail closed or open? Rate limiting failing closed is safer, but returning 500
    res.status(500).json({ error: 'Internal Server Error validating API Key' });
  }
};
