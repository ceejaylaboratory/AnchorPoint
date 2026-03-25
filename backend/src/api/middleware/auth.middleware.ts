import { Request, Response, NextFunction } from 'express';
import { extractBearerToken, verifyToken } from '../../services/auth.service';

export interface AuthRequest extends Request {
  user?: {
    publicKey: string;
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
    // In SEP-10, the `sub` claim is the user's public key.
    req.user = { publicKey: decoded.sub };
    return next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.'
    });
  }
};
