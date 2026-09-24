import { Request, Response, NextFunction } from 'express';

/**
 * Sets security headers that Helmet does not cover. CSP, HSTS, frame-guard,
 * MIME-sniffing and related headers are configured via Helmet in index.ts.
 */
export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Permissions-Policy (Restrict modern browser features)
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  next();
};
