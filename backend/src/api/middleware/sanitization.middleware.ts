import { NextFunction, Request, Response } from 'express';

export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface SanitizationOptions {
  /** Reject the request with HTTP 400 instead of stripping forbidden keys. */
  rejectForbiddenKeys?: boolean;
  /** Maximum recursion depth. Deeply nested structures are left untouched past this point. */
  maxDepth?: number;
}

export interface SanitizationResult {
  value: unknown;
  removedKeys: string[];
}

/**
 * Recursively strip prototype-pollution keys from an arbitrary JSON-like value.
 *
 * Objects are rebuilt rather than mutated so that a `__proto__` key parsed from
 * JSON cannot reach an object's prototype setter. Arrays are rebuilt element
 * by element. Cyclic references are guarded against with a WeakSet.
 */
export function sanitizeForPrototypePollution(
  value: unknown,
  options: SanitizationOptions = {}
): SanitizationResult {
  const removedKeys: string[] = [];
  const seen = new WeakSet<object>();
  const maxDepth = options.maxDepth ?? 100;

  const visit = (input: unknown, depth: number): unknown => {
    if (depth > maxDepth) return input;

    if (Array.isArray(input)) {
      if (seen.has(input)) return input;
      seen.add(input);
      return input.map((item) => visit(item, depth + 1));
    }

    if (input !== null && typeof input === 'object' && !(input instanceof Date) && !(input instanceof Buffer)) {
      if (seen.has(input)) return input;
      seen.add(input);

      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input)) {
        if (FORBIDDEN_KEYS.has(key)) {
          removedKeys.push(key);
          continue;
        }
        result[key] = visit(child, depth + 1);
      }
      return result;
    }

    return input;
  };

  return { value: visit(value, 0), removedKeys };
}

/** True when any own enumerable property uses a forbidden prototype-pollution key. */
export function containsForbiddenKey(value: unknown): boolean {
  return sanitizeForPrototypePollution(value).removedKeys.length > 0;
}

/**
 * Express middleware that sanitizes `req.body`, `req.query` and `req.params`.
 *
 * By default forbidden keys are removed and the request continues. With
 * `rejectForbiddenKeys: true` the request is answered with HTTP 400 instead.
 * `req.params` is wrapped in an accessor because Express populates it after
 * global middleware has run.
 */
export const sanitizationMiddleware = (options: SanitizationOptions = {}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const segments: Array<keyof Pick<Request, 'body' | 'query' | 'params'>> = ['body', 'query', 'params'];
    const removed: string[] = [];

    for (const segment of segments) {
      const current = req[segment];
      if (!current || typeof current !== 'object') continue;
      const result = sanitizeForPrototypePollution(current, options);
      removed.push(...result.removedKeys);
      if (options.rejectForbiddenKeys && result.removedKeys.length > 0) continue;
      (req as unknown as Record<string, unknown>)[segment] = result.value;
    }

    if (options.rejectForbiddenKeys && removed.length > 0) {
      res.status(400).json({
        error: {
          code: 'UNSAFE_INPUT',
          message: 'Request contains forbidden prototype pollution keys',
        },
      });
      return;
    }

    let params = (req.params ?? {}) as Request['params'];
    if (!options.rejectForbiddenKeys) {
      Object.defineProperty(req, 'params', {
        configurable: true,
        enumerable: true,
        get: () => params,
        set: (value: Request['params']) => {
          params = sanitizeForPrototypePollution(value ?? {}, options).value as Request['params'];
        },
      });
    }

    next();
  };
};

export default sanitizationMiddleware;
