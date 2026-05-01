import { Request, Response, NextFunction } from 'express';
import { FeatureFlagService, FeatureFlagContext } from '../services/feature-flag.service';

declare global {
  namespace Express {
    interface Request {
      featureFlagService?: FeatureFlagService;
      userId?: string;
      account?: string;
    }
  }
}

/**
 * Middleware to inject feature flag service into request context
 */
export function featureFlagMiddleware(featureFlagService: FeatureFlagService) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.featureFlagService = featureFlagService;

    // Extract user context from JWT or headers if available
    // This assumes authentication middleware runs before this
    if (req.body?.user_id) {
      req.userId = req.body.user_id;
    } else if (req.query.user_id) {
      req.userId = String(req.query.user_id);
    } else if (req.headers['x-user-id']) {
      req.userId = String(req.headers['x-user-id']);
    }

    if (req.body?.account) {
      req.account = req.body.account;
    } else if (req.query.account) {
      req.account = String(req.query.account);
    } else if (req.headers['x-account']) {
      req.account = String(req.headers['x-account']);
    }

    next();
  };
}

/**
 * Middleware to check if a specific feature is enabled
 * Usage: router.get('/endpoint', checkFeatureFlag('sep6.deposit'), handler);
 */
export function checkFeatureFlag(flagName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.featureFlagService) {
        // If feature flag service is not available, allow the request
        console.warn('Feature flag service not available, allowing request');
        return next();
      }

      const context: FeatureFlagContext = {
        userId: req.userId,
        account: req.account,
      };

      const isEnabled = await req.featureFlagService.isEnabled(flagName, context);

      if (!isEnabled) {
        return res.status(403).json({
          error: 'Feature not available',
          message: `The ${flagName} feature is currently unavailable. Please try again later.`,
          statusCode: 403,
        });
      }

      next();
    } catch (error) {
      console.error(`Error checking feature flag '${flagName}':`, error);
      // On error, allow the request to proceed (fail open)
      next();
    }
  };
}

/**
 * Helper function to add feature flag checks to a router
 * Usage: addFeatureFlagToRoute(router, 'get', '/deposit', 'sep6.deposit', handler);
 */
export function addFeatureFlagToRoute(
  router: any,
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  path: string,
  flagName: string,
  ...handlers: any[]
) {
  return router[method](path, checkFeatureFlag(flagName), ...handlers);
}
