import { Request, Response, NextFunction } from 'express';

/**
 * Partner domains allowed to embed SEP-24 interactive webviews in an iframe.
 * Override via SEP24_FRAME_ANCESTORS (space-separated) if needed.
 */
const DEFAULT_SEP24_FRAME_ANCESTORS = ["'self'"];

const getSep24FrameAncestors = (): string[] => {
  const configured = process.env.SEP24_FRAME_ANCESTORS;
  if (!configured) {
    return DEFAULT_SEP24_FRAME_ANCESTORS;
  }
  const parsed = configured
    .split(/\s+/)
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_SEP24_FRAME_ANCESTORS;
};

const isSep24Route = (req: Request): boolean => {
  const path = (req.path || req.originalUrl || '').toLowerCase();
  return path === '/sep24' || path.startsWith('/sep24/') || path.includes('/sep24/');
};

/**
 * Sets security headers that Helmet does not cover. CSP, HSTS, frame-guard,
 * MIME-sniffing and related headers are configured via Helmet in index.ts.
 *
 * This middleware also enforces strict transport/security headers directly so
 * that responses are protected even when Helmet is not in the request chain.
 */
export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Permissions-Policy (Restrict modern browser features)
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  // HSTS: enforce HTTPS for two years, include subdomains, allow preload list
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy restricting script sources to 'self'
  const scriptSrc = "script-src 'self'";
  const baseCspDirectives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (isSep24Route(req)) {
    // SEP-24 interactive webviews must be embeddable by designated partner domains.
    const frameAncestors = getSep24FrameAncestors().join(' ');
    res.setHeader(
      'Content-Security-Policy',
      [...baseCspDirectives, `frame-ancestors ${frameAncestors}`].join('; ')
    );
    // Do not set X-Frame-Options for SEP-24 routes; frame-ancestors governs embedding.
    res.removeHeader('X-Frame-Options');
  } else {
    // Clickjacking protection for all other routes
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      [...baseCspDirectives, "frame-ancestors 'none'"].join('; ')
    );
  }

  next();
};