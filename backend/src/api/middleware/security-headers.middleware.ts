import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to configure basic HTTP response security headers.
 */
export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 1. Content Security Policy (CSP)
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; object-src 'none';");

  // 2. X-Frame-Options (Clickjacking protection)
  res.setHeader('X-Frame-Options', 'DENY');

  // 3. X-Content-Type-Options (MIME-sniffing protection)
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 4. Referrer-Policy
  res.setHeader('Referrer-Policy', 'no-referrer');

  // 5. X-XSS-Protection (Disable legacy XSS filtering / prevent loading pages when XSS is detected)
  res.setHeader('X-XSS-Protection', '0');

  // 6. Strict-Transport-Security (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // 7. X-Download-Options (IE8+ security header to prevent opening downloads in site context)
  res.setHeader('X-Download-Options', 'noopen');

  // 8. X-Permitted-Cross-Domain-Policies (Restricts Flash/PDF cross-domain requests)
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // 9. Permissions-Policy (Restrict modern browser features)
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  // 10. Hide X-Powered-By
  res.removeHeader('X-Powered-By');

  next();
};
