import { Request, Response, NextFunction } from 'express';
import { config } from '../../config/env';
import { extractBearerToken, verifyToken, MultiKeyVerifiedToken } from '../../services/auth.service';

void config.JWT_SECRET;

export interface AuthRequest extends Request {
  user?: {
    publicKey: string;
    signers?: string[];
    threshold?: string;
    authLevel?: 'partial' | 'medium' | 'full';
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required. No token provided.'
    });
  }

  try {
    const decoded = verifyToken(token);
    
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
    
    return next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.'
    });
  }
};

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
