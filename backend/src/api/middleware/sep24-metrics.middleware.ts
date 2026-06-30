import { Request, Response, NextFunction } from 'express';
import { recordSep24InteractionRequest } from '../../services/sep24-metrics.service';

/**
 * Middleware that records SEP-24 interactive endpoint duration and request counts
 * to Prometheus.
 */
export function sep24MetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const method = req.method;
  const endpoint = req.route?.path ?? req.path;

  res.on('finish', () => {
    const durationSeconds = (Date.now() - start) / 1000;
    recordSep24InteractionRequest(endpoint, method, res.statusCode, durationSeconds);
  });

  next();
}
