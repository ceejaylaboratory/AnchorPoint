import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { metricsService } from '../../services/metrics.service';

const router = Router();

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/, '');
}

/**
 * Restricts metrics scraping. When METRICS_AUTH_TOKEN and/or METRICS_IP_WHITELIST
 * (comma-separated IPs) are set, a request must present `Authorization: Bearer <token>`
 * or come from a whitelisted IP. With neither set, the endpoint is open.
 */
export function metricsAccessGuard(req: Request, res: Response, next: NextFunction) {
  const token = process.env.METRICS_AUTH_TOKEN;
  const whitelist = (process.env.METRICS_IP_WHITELIST ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (!token && whitelist.length === 0) {
    return next();
  }

  if (whitelist.includes(normalizeIp(req.ip))) {
    return next();
  }

  const auth = req.get('authorization') ?? '';
  if (token && auth.startsWith('Bearer ') && tokenMatches(auth.slice(7), token)) {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden' });
}

router.use(metricsAccessGuard);

/**
 * GET /metrics
 * 
 * Prometheus metrics endpoint - returns metrics in Prometheus format
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', metricsService.getRegistry().contentType);
    res.send(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /metrics/json
 * 
 * Returns metrics in JSON format for easier debugging
 */
router.get('/json', async (req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getRegistry().getMetricsAsJSON();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
