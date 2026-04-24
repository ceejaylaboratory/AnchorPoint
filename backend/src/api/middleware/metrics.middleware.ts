import { Request, Response, NextFunction } from 'express';
import { metricsService } from '../../services/metrics.service';

/**
 * Middleware to track HTTP requests metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const method = req.method;
  const path = req.route?.path || req.path;

  // Increment request counter
  metricsService.incrementRequestCount(method, path);

  // Track when response finishes
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    const statusCode = res.statusCode;

    // Record request with status code
    metricsService.recordHttpRequest(method, path, statusCode);

    // Record request duration
    metricsService.observeRequestDuration(method, path, duration);
  });

  next();
}

/**
 * Middleware to track active connections
 */
let activeConnections = 0;

export function connectionTracker(req: Request, res: Response, next: NextFunction): void {
  activeConnections++;
  metricsService.setActiveConnections(activeConnections);

  res.on('finish', () => {
    activeConnections--;
    metricsService.setActiveConnections(activeConnections);
  });

  next();
}
