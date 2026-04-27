import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { createAuditLog } from '../../services/audit-log.service';

export interface AuditOptions {
  action: string;
  resourceType: string;
  /** Extract the resource ID from the request */
  getResourceId?: (req: AuthRequest) => string | undefined;
  /** Extract the "before" state — called before the handler runs */
  getBefore?: (req: AuthRequest) => Promise<unknown> | unknown;
}

/**
 * Returns an Express middleware that records an audit log entry after the
 * response is sent. The "after" state is derived from `res.locals.auditAfter`
 * which route handlers can populate before calling next() / res.json().
 */
export const auditLog = (opts: AuditOptions) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const before = opts.getBefore ? await opts.getBefore(req) : undefined;

    res.on('finish', () => {
      // Only log mutating requests that succeeded (2xx)
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const userId = req.user?.publicKey ?? 'anonymous';
      const resourceId = opts.getResourceId?.(req);
      const after = res.locals.auditAfter as unknown;

      void createAuditLog({
        userId,
        action: opts.action,
        resourceType: opts.resourceType,
        resourceId,
        before,
        after,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });

    next();
  };
};
