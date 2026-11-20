import { Request, Response, NextFunction } from 'express';
import { config } from '../../config/env';
import { extractBearerToken, verifyToken, MultiKeyVerifiedToken } from '../../services/auth.service';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { redis } from '../../lib/redis';
import { horizonWebhookMiddleware } from './horizon-webhook.middleware';

void config.JWT_SECRET;

export type Tier = 'Free' | 'Pro' | 'Enterprise';

export interface AuthRequest extends Request {
  user?: {
    publicKey: string;
    signers?: string[];
    threshold?: string;
    authLevel?: 'partial' | 'medium' | 'full';
    tier?: Tier;
  };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required. No token provided.'
    });
  }

  try {
    const decoded = await verifyToken(token);
    
    // Handle both single-key and multi-key tokens
    if ((decoded as MultiKeyVerifiedToken).signers) {
      const multiKeyDecoded = decoded as MultiKeyVerifiedToken;
      req.user = { 
        publicKey: multiKeyDecoded.sub,
        signers: multiKeyDecoded.signers,
        threshold: multiKeyDecoded.threshold,
        authLevel: multiKeyDecoded.authLevel
      };
    } else {
      // Single-key authentication
      req.user = { publicKey: decoded.sub };
    }

    // Attach tier from X-API-Key header if present
    attachTierFromApiKey(req).catch(() => {});

    return next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.'
    });
  }
};

export const apiKeyAuthMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const apiKeyHeader = req.headers['x-api-key'];
  if (!apiKeyHeader || typeof apiKeyHeader !== 'string') {
    return res.status(401).json({ status: 'error', message: 'API key required' });
  }

  try {
    const { default: prisma } = await import('../../lib/prisma');
    const record = await prisma.apiKey.findUnique({
      where: { key: apiKeyHeader },
    });

    if (!record || !record.isActive) {
      return res.status(401).json({ status: 'error', message: 'Invalid or inactive API key' });
    }

    if (record.expiresAt && record.expiresAt <= new Date()) {
      return res.status(401).json({ status: 'error', message: 'API key has expired' });
    }

    // Rate Limiting
    const limit = record.tier === 'Pro' ? 10000 : record.tier === 'Enterprise' ? 100000 : 100;
    const rateLimitKey = `rate-limit:apikey:${record.key}`;
    const currentCount = await (redis as any).incr(rateLimitKey);
    
    if (currentCount === 1) {
      await (redis as any).expire(rateLimitKey, 3600); // 1 hour window
    }

    if (currentCount > limit) {
      return res.status(429).json({ status: 'error', message: 'Rate limit exceeded' });
    }

    // Usage Tracking
    await prisma.apiKey.update({
      where: { id: record.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });

    req.user = { publicKey: record.ownerId, tier: record.tier as Tier };

    return next();
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Internal server error validating API Key' });
  }
};

async function attachTierFromApiKey(req: AuthRequest): Promise<void> {
  const apiKeyHeader = req.headers['x-api-key'];
  if (!apiKeyHeader || typeof apiKeyHeader !== 'string') return;

  try {
    const { default: prisma } = await import('../../lib/prisma');
    const record = await prisma.apiKey.findUnique({
      where: { key: apiKeyHeader },
      select: { tier: true },
    });

    if (record && req.user) {
      req.user.tier = record.tier as Tier;
    }
  } catch {
    // Swallow DB errors — tier is optional metadata
  }
}

// Middleware for requiring specific authentication levels
export const requireAuthLevel = (requiredLevel: 'partial' | 'medium' | 'full') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required.'
      });
    }

    // For single-key auth, assume full authority
    if (!req.user.authLevel) {
      return next();
    }

    const authLevels = { partial: 1, medium: 2, full: 3 };
    const userLevel = authLevels[req.user.authLevel];
    const requiredLevelValue = authLevels[requiredLevel];

    if (userLevel < requiredLevelValue) {
      return res.status(403).json({
        status: 'error',
        message: `Insufficient authentication level. Required: ${requiredLevel}, Current: ${req.user.authLevel}`
      });
    }

    return next();
  };
};

export type AdminRole = 'SUPER_ADMIN' | 'OPS' | 'READ_ONLY';

export interface AdminRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: AdminRole;
  };
}

// Middleware restricting a route to admins holding one of the given roles
export const requireRole = (...roles: AdminRole[]) => {
  return async (req: AdminRequest, res: Response, next: NextFunction) => {
    if (!req.admin) {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required. No token provided.'
        });
      }

      let subject: string;
      try {
        subject = (await verifyToken(token)).sub;
      } catch (error) {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid or expired token.'
        });
      }

      try {
        const { default: prisma } = await import('../../lib/prisma');
        const admin = await prisma.adminUser.findFirst({
          where: { OR: [{ id: subject }, { email: subject }] },
          select: { id: true, email: true, role: true },
        });

        if (!admin) {
          return res.status(403).json({
            status: 'error',
            message: 'Admin access required.'
          });
        }

        req.admin = { id: admin.id, email: admin.email, role: admin.role as AdminRole };
      } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Internal server error validating admin role' });
      }
    }

    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        status: 'error',
        message: `Insufficient role. Required one of: ${roles.join(', ')}, Current: ${req.admin.role}`
      });
    }

    return next();
  };
};

export const webhookSignatureMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const stellarSignature = req.headers['x-stellar-signature'] as string | undefined;
  if (stellarSignature || process.env.HORIZON_WEBHOOK_SECRET || config.HORIZON_WEBHOOK_SECRET) {
    if (stellarSignature || (!req.headers['x-anchorpoint-signature'] && (process.env.HORIZON_WEBHOOK_SECRET || config.HORIZON_WEBHOOK_SECRET))) {
      return horizonWebhookMiddleware(req, res, next);
    }
  }

  const signature = req.headers['x-anchorpoint-signature'] as string | undefined;
  const timestamp = req.headers['x-anchorpoint-timestamp'] as string | undefined;
  const secret = config.WEBHOOK_SECRET;

  if (!signature || !timestamp || !secret) {
    return res.status(401).json({ error: 'Missing webhook signature, timestamp, or secret' });
  }

  const requestTs = Number.isNaN(Number(timestamp))
    ? Math.floor(Date.parse(timestamp) / 1000)
    : parseInt(timestamp, 10);
  if (Number.isNaN(requestTs) || Math.abs(Math.floor(Date.now() / 1000) - requestTs) > 300) {
    return res.status(401).json({ error: 'Webhook timestamp outside acceptable 5-minute window' });
  }

  const rawBody =
    (req as Request & { rawBody?: string }).rawBody ??
    (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(`sha256=${expectedSignature}`);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
};
