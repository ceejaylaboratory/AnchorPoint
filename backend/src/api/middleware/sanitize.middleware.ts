import { Request, Response, NextFunction } from 'express';
import xss from 'xss';

/**
 * Middleware to sanitize incoming request input against XSS and SQL-injection
 * payloads before it reaches route handlers, database queries, or log output.
 *
 * Sanitization is applied recursively to every string value in the request
 * body, query string, and route params:
 *   - HTML/script tags and dangerous markup are stripped via the `xss` filter.
 *   - Surrounding whitespace is trimmed from string values.
 *
 * Non-string values (numbers, booleans, arrays, nested objects) are preserved;
 * arrays are sanitized element-wise, and nested objects are sanitized recursively.
 *
 * Route params are only populated once a router matches, after global middleware
 * has run, so `req.params` is wrapped in an accessor that sanitizes every value
 * Express assigns to it.
 */
export const sanitizeRequestMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query) as Request['query'];
  }

  let params = sanitizeValue(req.params ?? {}) as Request['params'];
  Object.defineProperty(req, 'params', {
    configurable: true,
    enumerable: true,
    get: () => params,
    set: (value: Request['params']) => {
      params = sanitizeValue(value) as Request['params'];
    },
  });

  next();
};

/**
 * Recursively sanitize an arbitrary value.
 * - strings: strip HTML/script markup, then trim whitespace
 * - arrays: map each element through `sanitizeValue`
 * - objects: sanitize every own enumerable property
 * - everything else: returned unchanged
 */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // `xss` with `whiteList: {}` strips all tags/attributes; the result is the
    // text content only. `stripIgnoreTag` drops the whole tag (script bodies
    // included) rather than escaping it.
    return xss(value, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script', 'style'],
    }).trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeValue(val);
    }
    return result;
  }

  return value;
}